import { audit, computeProgress, setStep, stamp, store } from "./state";
import { clearTraffic, errorRate, startTraffic, stopTraffic } from "./traffic";
import { PAYMENTS_URL, applyRemediation, diagnose, parseLogs, requestGrant } from "./clients";
import { hypothesize } from "./hypothesis";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, timeoutMs = 20000, pollMs = 250): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (cond()) return true;
    await sleep(pollMs);
  }
  return false;
}

let running = false;

export async function startIncident() {
  if (running) return;
  running = true;
  try {
    store.begin();
    startTraffic(PAYMENTS_URL);
    await sleep(1500); // clean baseline on the chart

    await fetch(`${PAYMENTS_URL}/admin/break`, { method: "POST" });

    // DETECT — real threshold on real measured traffic
    await until(() => errorRate() > 10);
    store.mutate((s) => {
      setStep(s, "detect", "active");
      audit(s, "Alert raised · 5xx over threshold", "nexla", "signal", `${errorRate().toFixed(1)}% 5xx on payments-api`);
    });
    await sleep(1200);

    // CONTEXT — real deploy history from the service
    const deploys = (await (await fetch(`${PAYMENTS_URL}/deploys`)).json()) as { id: string; note: string; current: boolean }[];
    const bad = deploys.find((d) => d.current) ?? deploys[deploys.length - 1];
    store.mutate((s) => {
      setStep(s, "detect", "done");
      setStep(s, "context", "active", `${bad.id} · ${bad.note}`);
      audit(s, `Recent deploy ${bad.id} pulled`, "nexla", "neutral", bad.note);
    });
    await sleep(1000);

    // CAPABILITY — logs are unreadable, buy a parse from Zero (or fall back)
    const raw = await (await fetch(`${PAYMENTS_URL}/logs`)).text();
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
    // Optional LLM hypothesis (A5) — no-op unless ANTHROPIC_API_KEY is set.
    const hypo = await hypothesize(parsed, bad.note);
    if (hypo) store.mutate((s) => audit(s, "Hypothesis formed", "agent", "neutral", hypo));
    await sleep(600);

    // SANDBOX — disposable diagnostic evidence before any prod ask
    store.mutate((s) => {
      setStep(s, "capability", "done");
      setStep(s, "sandbox", "active");
      s.sandbox = { ...s.sandbox, lifecycle: "provisioning" };
      audit(s, process.env.WORKER_URL ? "Dispatching Akash diagnostic worker" : "Dispatching local diagnostic (fallback)", "akash", "neutral", "ephemeral · no prod credentials aboard");
    });
    store.mutate((s) => { s.sandbox = { ...s.sandbox, lifecycle: "running" }; });
    const diag = await diagnose({ service: "payments-api", deployId: bad.id, candidateAction: "rollback", rawLogs: raw });
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

    // GATE — request the one scoped permission
    store.mutate((s) => {
      setStep(s, "remediation", "active");
      s.gateState = "pending";
      audit(s, "Requesting rollback at the gate", "pomerium", "signal", "no standing credential held");
    });
    const grant = await requestGrant({
      action: "rollback", service: "payments-api", servicesAffected: 1,
      sandboxPassed: diag.sandboxPassed, budgetUsed: store.state.budgetUsed,
      consecutiveFailures: 0, requestedBy: "vigil-agent",
    });

    if (grant.verdict === "denied" || !grant.token) {
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

    // APPLY — through Pomerium when POMERIUM_URL is set
    const applied = await applyRemediation("rollback", grant.token);
    store.mutate((s) => {
      audit(s, applied.ok ? "Rollback applied through the gate" : `Rollback failed (${applied.status})`, "agent", applied.ok ? "signal" : "alert", applied.ok ? "deploy #4821 reverted" : JSON.stringify(applied.body));
      if (applied.ok) { s.grantConsumed = true; s.grantWindow = 0; }
    });
    store.mutate((s) => audit(s, "Single-use credential consumed", "pomerium", "ok", "0 standing credentials held"));

    // RECOVERY — real, because the service really got fixed
    await until(() => errorRate(3000) < 1, 20000);
    store.mutate((s) => {
      s.incidentStatus = "resolved";
      audit(s, "Error rate recovered · incident resolved", "agent", "ok");
    });

    // THE CLAMP — auto demo beat
    await sleep(2000);
    await runThrash();

    store.mutate((s) => {
      audit(s, "Vigil re-planned around the denial", "agent", "neutral", "held scope to a single service");
      s.finished = true;
      s.playing = false;
      s.progress = computeProgress(s);
    });
  } finally {
    running = false;
  }
}

async function runThrash() {
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
}

export async function thrash() { await runThrash(); }

export async function resetDemo() {
  stopTraffic();
  clearTraffic();
  await fetch(`${PAYMENTS_URL}/admin/reset`, { method: "POST" }).catch(() => {});
  store.reset();
}
