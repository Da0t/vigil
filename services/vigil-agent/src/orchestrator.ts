import { audit, computeProgress, setStep, stamp, store } from "./state";
import { clearTraffic, errorRate, startTraffic, stopTraffic } from "./traffic";
import {
  PAYMENTS_URL, applyRemediation, diagnose, getJson, getText, newCorrelationId, parseLogs, postForm, requestGrant,
} from "./clients";
import { hypothesize } from "./hypothesis";
import { env } from "./env";
import { createLogger } from "../../shared/observability";
import { incidentOutcome, incidentsTotal } from "./metrics";

const log = createLogger("vigil-agent");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until cond() holds or the timeout elapses; aborts promptly on signal. */
async function until(cond: () => boolean, timeoutMs = 20000, pollMs = 250, signal?: AbortSignal): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (signal?.aborted) return false;
    if (cond()) return true;
    await sleep(pollMs);
  }
  return false;
}

let running = false;
let currentRun: AbortController | null = null;
let thrashing = false;

/** Emit a terminal FAILED state — the loop did not reach resolution. */
function failIncident(reason: string) {
  incidentOutcome.inc({ outcome: "failed" });
  log.warn({ reason }, "incident failed");
  store.mutate((s) => {
    s.incidentStatus = "failed";
    s.finished = true;
    s.playing = false;
    audit(s, "Incident not auto-resolved", "agent", "alert", reason);
    s.progress = computeProgress(s);
  });
}

export async function startIncident() {
  if (running) return;
  running = true;
  const ac = new AbortController();
  currentRun = ac;
  const { signal } = ac;
  const correlationId = newCorrelationId();
  incidentsTotal.inc();
  log.info({ correlationId }, "incident started");
  try {
    store.begin();
    startTraffic(PAYMENTS_URL);
    await sleep(1500); // clean baseline on the chart
    if (signal.aborted) return;

    // Induce the incident (dev scaffolding; /admin/break is compiled out in prod).
    if (!(await postForm(`${PAYMENTS_URL}/admin/break`))) {
      failIncident("could not induce the incident (admin/break unavailable)");
      return;
    }

    // DETECT — honor the timeout: if error never climbs, do not pretend we detected.
    if (!(await until(() => errorRate() > 10, 20000, 250, signal))) {
      if (!signal.aborted) failIncident("no 5xx signal detected within timeout");
      return;
    }
    store.mutate((s) => {
      setStep(s, "detect", "active");
      audit(s, "Alert raised · 5xx over threshold", "agent", "signal", `${errorRate().toFixed(1)}% 5xx on payments-api`);
    });
    await sleep(1200);
    if (signal.aborted) return;

    // CONTEXT — real deploy history from the service (guarded).
    let deploys: { id: string; note: string; current: boolean }[];
    try {
      deploys = await getJson(`${PAYMENTS_URL}/deploys`);
    } catch (e) {
      failIncident(`could not pull deploy history (${(e as Error).message})`);
      return;
    }
    const bad = deploys.find((d) => d.current) ?? deploys[deploys.length - 1];
    store.mutate((s) => {
      setStep(s, "detect", "done");
      setStep(s, "context", "active", `${bad.id} · ${bad.note}`);
      audit(s, `Recent deploy ${bad.id} pulled`, "agent", "neutral", bad.note);
    });
    await sleep(1000);
    if (signal.aborted) return;

    // CAPABILITY — logs are unreadable, buy a parse from Zero (or fall back).
    let raw: string;
    try {
      raw = await getText(`${PAYMENTS_URL}/logs`);
    } catch (e) {
      failIncident(`could not read logs (${(e as Error).message})`);
      return;
    }
    store.mutate((s) => {
      setStep(s, "context", "done");
      setStep(s, "capability", "active");
      audit(s, "Logs unreadable · shopping Zero for a parser", "zero", "neutral", "capability the loop lacked");
    });
    const parsed = await parseLogs(raw);
    store.mutate((s) => {
      s.budgetUsed = Number((s.budgetUsed + (parsed.costUsd ?? 0.04)).toFixed(2));
      audit(s, `Capability called · $${(parsed.costUsd ?? 0.04).toFixed(2)} · ${parsed.parserSource}`, "zero", "neutral", `${parsed.errorSignature} in ${parsed.suspectComponent}`);
    });
    const hypo = await hypothesize(parsed, bad.note);
    if (hypo) store.mutate((s) => audit(s, "Hypothesis formed", "agent", "neutral", hypo));
    await sleep(600);
    if (signal.aborted) return;

    // SANDBOX — disposable diagnostic evidence before any prod ask.
    store.mutate((s) => {
      setStep(s, "capability", "done");
      setStep(s, "sandbox", "active");
      s.sandbox = { ...s.sandbox, lifecycle: "provisioning" };
      audit(s, env.WORKER_URL ? "Dispatching Akash diagnostic worker" : "Dispatching local diagnostic (fallback)", "akash", "neutral", "ephemeral · no prod credentials aboard");
    });
    store.mutate((s) => { s.sandbox = { ...s.sandbox, lifecycle: "running" }; });
    const diag = await diagnose({ service: "payments-api", deployId: bad.id, candidateAction: "rollback", rawLogs: raw });
    if (signal.aborted) return;
    store.mutate((s) => {
      s.sandbox = { ...s.sandbox, lifecycle: "done", sandboxPassed: diag.sandboxPassed, recommendedAction: diag.recommendedAction };
      setStep(s, "sandbox", diag.sandboxPassed ? "done" : "failed", `sandbox_passed=${diag.sandboxPassed} · recommended_action=${diag.recommendedAction}`);
      audit(s, `Sandbox ${diag.sandboxPassed ? "passed" : "failed"}`, "akash", diag.sandboxPassed ? "ok" : "alert", diag.rootCause);
    });
    await sleep(700);
    store.mutate((s) => {
      s.sandbox = { ...s.sandbox, lifecycle: "torn_down" };
      audit(s, "Diagnostic worker released · no residue", "akash", "neutral");
    });
    if (signal.aborted) return;

    // GATE — request the one scoped permission.
    store.mutate((s) => {
      setStep(s, "remediation", "active");
      s.gateState = "pending";
      audit(s, "Requesting rollback at the gate", "pomerium", "signal", "no standing credential held");
    });
    const grant = await requestGrant({
      action: "rollback", service: "payments-api", servicesAffected: 1,
      sandboxPassed: diag.sandboxPassed, budgetUsed: store.state.budgetUsed,
      consecutiveFailures: 0, requestedBy: "vigil-agent",
      deployId: bad.id, attestation: diag.attestation,
    });

    if (grant.verdict === "denied" || !grant.token) {
      incidentOutcome.inc({ outcome: "denied" });
      store.mutate((s) => {
        s.gateState = "denied";
        s.denial = { action: "rollback payments-api", verdict: "denied", scope: grant.scope, reason: grant.reason, budgetOk: true, attributedTo: "vigil-agent", at: stamp(s.clock) };
        audit(s, "Gate denied rollback", "pomerium", "alert", grant.reason);
        s.finished = true; s.playing = false;
      });
      return;
    }

    store.mutate((s) => {
      s.gateState = "allowed";
      s.blastRadius = 1;
      s.grantWindow = 1;
      s.grantConsumed = false;
      s.gate = {
        action: "rollback payments-api", verdict: "allowed", scope: grant.scope,
        credential: { singleUse: grant.singleUse ?? true, ttlSeconds: grant.ttlSeconds ?? 60 },
        budgetOk: true, attributedTo: "vigil-agent", at: stamp(s.clock),
      };
      setStep(s, "remediation", "done");
      s.incidentStatus = "resolving";
      audit(s, `Gate allowed · scoped, single-use, ${grant.ttlSeconds ?? 60}s TTL`, "pomerium", "ok", grant.scope);
    });

    // APPLY — through Pomerium when POMERIUM_URL is set (guarded in clients).
    const applied = await applyRemediation("rollback", grant.token);
    store.mutate((s) => {
      audit(s, applied.ok ? "Rollback applied through the gate" : `Rollback failed (${applied.status})`, "agent", applied.ok ? "signal" : "alert", applied.ok ? "deploy #4821 reverted" : JSON.stringify(applied.body));
      if (applied.ok) { s.grantConsumed = true; s.grantWindow = 0; }
    });
    store.mutate((s) => audit(s, "Single-use credential consumed", "pomerium", "ok", "0 standing credentials held"));

    // RECOVERY — honor the timeout: only claim resolved if error really recovered.
    const recovered = await until(() => errorRate(3000) < 1, 20000, 250, signal);
    if (signal.aborted) return;
    if (!recovered) {
      failIncident("error rate did not recover after rollback");
      return;
    }
    incidentOutcome.inc({ outcome: "resolved" });
    store.mutate((s) => {
      s.incidentStatus = "resolved";
      audit(s, "Error rate recovered · incident resolved", "agent", "ok");
    });

    // THE CLAMP — auto demo beat.
    await sleep(2000);
    if (signal.aborted) return;
    await runThrash();

    store.mutate((s) => {
      audit(s, "Vigil re-planned around the denial", "agent", "neutral", "held scope to a single service");
      s.finished = true;
      s.playing = false;
      s.progress = computeProgress(s);
    });
  } finally {
    running = false;
    if (currentRun === ac) currentRun = null;
  }
}

async function runThrash() {
  if (thrashing) return; // guard against double-fire (auto beat + manual button)
  thrashing = true;
  try {
    store.mutate((s) => {
      s.gateState = "pending";
      s.blastRadius = 12;
      audit(s, "Agent attempts escalation", "agent", "signal", "mass-restart across 12 services");
    });
    const denial = await requestGrant({
      action: "mass-restart", service: "all-services", servicesAffected: 12,
      sandboxPassed: false, budgetUsed: store.state.budgetUsed,
      consecutiveFailures: 2, requestedBy: "vigil-agent",
    });
    store.mutate((s) => {
      s.gateState = denial.verdict === "denied" ? "denied" : "allowed";
      s.consecutiveFailures = 2;
      s.denial = {
        action: "mass-restart across 12 services", verdict: denial.verdict,
        scope: denial.scope, reason: denial.reason, budgetOk: true,
        attributedTo: "vigil-agent", at: stamp(s.clock),
      };
      audit(s, `Gate ${denial.verdict} · ${denial.reason ?? "escalation"}`, "pomerium", "alert", denial.scope);
      audit(s, "Policy tightened · escalation refused", "pomerium", "alert");
    });
  } finally {
    thrashing = false;
  }
}

export async function thrash() { await runThrash(); }

export async function resetDemo() {
  // Abort any running loop BEFORE mutating shared state, so reset can't interleave.
  currentRun?.abort();
  await sleep(60); // let the loop observe the abort and unwind
  stopTraffic();
  clearTraffic();
  await postForm(`${PAYMENTS_URL}/admin/reset`);
  store.reset();
}
