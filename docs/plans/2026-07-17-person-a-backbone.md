# Person A — Backbone: mock prod + orchestrator (branch `person-a-backbone`)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans if
> available; otherwise execute top-to-bottom, one todo per task. Commit after
> every task. You own `services/payments-api/**` and `services/vigil-agent/**`
> EXCEPT `services/vigil-agent/src/integrations/zero-live.ts` (Person C's file —
> never edit it). Do not touch `src/**` (frontend) or `src/lib/contract.ts`.

**Goal:** A real payments-api that really breaks, and a vigil-agent orchestrator
that detects it from live traffic, diagnoses, requests a grant, rolls back, and
streams `LoopState` snapshots over SSE — with local fallbacks for every
integration so the demo works before any other branch merges.

**Read first:** `src/lib/contract.ts` (all types/routes used below come from it)
and `src/lib/use-incident-sim.ts` (the scripted loop you are making real — reuse
its audit copy/tone so the UI reads the same).

**Runtime:** Node + `tsx` (no build step), Express. All services import contract
types via relative path, e.g. `../../../src/lib/contract`.

---

### Task A1: payments-api (mock prod that really breaks)

**Files:**
- Create: `services/payments-api/package.json`
- Create: `services/payments-api/src/index.ts`

**Produces (consumed by A2, B, C):** HTTP on :4100 —
`GET /health /pay /metrics /logs /deploys`, `POST /admin/break /admin/reset`
(safe), `POST /rollback /restart` (destructive — grant-checked when `GATE_URL`
is set, per `VerifyRequest/Response` in the contract).

- [ ] **Step 1: scaffold**

```bash
mkdir -p services/payments-api/src && cd services/payments-api
npm init -y && npm i express@4 cors && npm i -D tsx @types/express @types/cors typescript
```

- [ ] **Step 2: implement `src/index.ts`** (complete file):

```ts
import express from "express";
import cors from "cors";
import type { VerifyResponse } from "../../../src/lib/contract";

const PORT = Number(process.env.PORT ?? 4100);
const GATE_URL = process.env.GATE_URL;

interface Deploy { id: string; at: string; status: "healthy" | "bad" | "rolled_back"; note: string }

let deploys: Deploy[] = [];
let current = "#4821";
let broken = false;
const requests: { ts: number; ok: boolean }[] = [];
const vlog: string[] = [];

function seed() {
  deploys = [
    { id: "#4820", at: new Date(Date.now() - 86_400_000).toISOString(), status: "healthy", note: "baseline" },
    { id: "#4821", at: new Date().toISOString(), status: "healthy", note: "stripe_adapter timeout handling rework" },
  ];
  current = "#4821";
  broken = false;
  requests.length = 0;
  vlog.length = 0;
}
seed();

function log(lvl: "E" | "W" | "I", component: string, code: string, kv: Record<string, string | number>) {
  const rest = Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("|");
  vlog.push(`|${lvl}|${Math.floor(Date.now() / 1000)}|${component}|${code}|${rest}`);
  if (vlog.length > 500) vlog.shift();
}

async function grantValid(token: string | undefined, action: string): Promise<{ ok: boolean; reason?: string }> {
  if (!GATE_URL) {
    console.warn(`[payments-api] GATE_URL unset — ${action} allowed ungated (pre-merge dev only)`);
    return { ok: true };
  }
  if (!token) return { ok: false, reason: "no grant presented" };
  const r = await fetch(`${GATE_URL}/grants/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, action, service: "payments-api" }),
  });
  const v = (await r.json()) as VerifyResponse;
  return v.valid ? { ok: true } : { ok: false, reason: v.reason };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => { res.json({ ok: !broken, deploy: current }); });

app.get("/pay", (_req, res) => {
  const ok = !broken;
  requests.push({ ts: Date.now(), ok });
  if (requests.length > 2000) requests.shift();
  if (!ok) {
    log("E", "stripe_adapter", "ERR_TIMEOUT_CFG", { txn: `pay_${Math.random().toString(36).slice(2, 6)}`, lat_ms: 5000 + Math.floor(Math.random() * 4), deploy: current });
    res.status(500).json({ error: "upstream timeout", deploy: current });
    return;
  }
  if (Math.random() < 0.2) log("I", "router", "OK_CHARGE", { txn: `pay_${Math.random().toString(36).slice(2, 6)}`, lat_ms: 40 + Math.floor(Math.random() * 30) });
  res.json({ ok: true, deploy: current });
});

app.get("/metrics", (_req, res) => {
  const cut = Date.now() - 9000;
  const w = requests.filter((r) => r.ts >= cut);
  const errorRate = w.length ? (100 * w.filter((r) => !r.ok).length) / w.length : 0;
  res.json({ service: "payments-api", errorRate, windowSeconds: 9, samples: w.length });
});

app.get("/logs", (_req, res) => { res.type("text/plain").send(vlog.join("\n")); });

app.get("/deploys", (_req, res) => {
  res.json(deploys.map((d) => ({ ...d, current: d.id === current })));
});

app.post("/admin/break", (_req, res) => {
  broken = true;
  const bad = deploys.find((d) => d.id === "#4821");
  if (bad) bad.status = "bad";
  log("I", "deployer", "DEPLOY_APPLIED", { deploy: "#4821", files: "stripe_adapter.ts" });
  res.json({ ok: true, broken });
});

app.post("/admin/reset", (_req, res) => { seed(); res.json({ ok: true }); });

app.post("/rollback", async (req, res) => {
  const g = await grantValid(req.header("x-vigil-grant"), "rollback");
  if (!g.ok) { res.status(403).json({ error: "grant rejected", reason: g.reason }); return; }
  broken = false;
  current = "#4820";
  const bad = deploys.find((d) => d.id === "#4821");
  if (bad) bad.status = "rolled_back";
  log("I", "deployer", "ROLLBACK_OK", { to: "#4820" });
  res.json({ ok: true, deploy: current });
});

app.post("/restart", async (req, res) => {
  const g = await grantValid(req.header("x-vigil-grant"), "restart");
  if (!g.ok) { res.status(403).json({ error: "grant rejected", reason: g.reason }); return; }
  log("I", "supervisor", "RESTART_OK", { deploy: current });
  res.json({ ok: true, restarted: true, note: "restart does not fix a bad deploy" });
});

app.listen(PORT, () => console.log(`[payments-api] :${PORT}`));
```

- [ ] **Step 3: verify**

```bash
npx tsx src/index.ts &   # from services/payments-api
curl -s localhost:4100/pay                     # {"ok":true,"deploy":"#4821"}
curl -s -X POST localhost:4100/admin/break     # {"ok":true,"broken":true}
curl -s -o /dev/null -w '%{http_code}\n' localhost:4100/pay   # 500
curl -s localhost:4100/logs | tail -2          # |E|...|stripe_adapter|ERR_TIMEOUT_CFG|...
curl -s -X POST localhost:4100/rollback        # warns ungated; {"ok":true,"deploy":"#4820"}
curl -s localhost:4100/pay                     # {"ok":true,"deploy":"#4820"}
kill %1
```

- [ ] **Step 4: commit** — `git add services/payments-api && git commit -m "feat: payments-api mock prod with grant-checked destructive routes"`

---

### Task A2: vigil-agent state store + traffic loop + SSE server

**Files:**
- Create: `services/vigil-agent/package.json` (same deps as A1)
- Create: `services/vigil-agent/src/state.ts`
- Create: `services/vigil-agent/src/traffic.ts`
- Create: `services/vigil-agent/src/server.ts`

**Produces:** `store` (EventEmitter of `LoopState`), `audit()/setStep()` helpers
(same semantics as use-incident-sim.ts), traffic measurement (`errorRate()`,
`series()`), HTTP surface per `AGENT_ROUTES` on :4000.

- [ ] **Step 1: `src/state.ts`** (complete file):

```ts
import { EventEmitter } from "node:events";
import type { LoopState } from "../../../src/lib/contract";
import type { AgentStep, AuditEntry } from "../../../src/lib/types";

export const STEP_DEFS: Omit<AgentStep, "state">[] = [
  { id: "detect", label: "Detected from live traffic", source: "nexla", detail: "5xx over threshold · no page raised" },
  { id: "context", label: "Pulled incident context", source: "nexla", detail: "deploy #4821 · recent change set" },
  { id: "capability", label: "Found a capability it lacked", source: "zero", detail: "log-parser · called per use", cost: 0.04 },
  { id: "sandbox", label: "Verified in disposable diagnostic", source: "akash", detail: "awaiting result" },
  { id: "remediation", label: "Requesting remediation", source: "pomerium", detail: "rollback payments-api" },
];

export function freshState(): LoopState {
  return {
    clock: 0, playing: false, started: false, finished: false, progress: 0,
    incidentStatus: "active", errorRate: 0, series: new Array(54).fill(0),
    steps: STEP_DEFS.map((s) => ({ ...s, state: "pending" as const })),
    sandbox: { provider: "akash", lifecycle: "provisioning", sandboxPassed: false, recommendedAction: "rollback", region: process.env.WORKER_URL ? "akash · deployed" : "local fallback" },
    gateState: "idle", gate: null, denial: null,
    grantWindow: 1, grantConsumed: false,
    budgetUsed: 0, budgetMax: 5,
    blastRadius: 0, blastMax: 12, blastThreshold: 3,
    consecutiveFailures: 0, standingCredentials: 0,
    audit: [],
  };
}

class Store extends EventEmitter {
  state: LoopState = freshState();
  startedAt = 0;

  begin() {
    this.startedAt = Date.now();
    this.state = { ...freshState(), started: true, playing: true };
    this.emit("change", this.state);
  }

  reset() {
    this.startedAt = 0;
    this.state = freshState();
    this.emit("change", this.state);
  }

  mutate(fn: (s: LoopState) => void) {
    const s = structuredClone(this.state);
    if (this.startedAt) s.clock = (Date.now() - this.startedAt) / 1000;
    fn(s);
    this.state = s;
    this.emit("change", s);
  }
}

export const store = new Store();

export const stamp = (clock: number) => `T+${clock.toFixed(1)}s`;

export function setStep(s: LoopState, id: string, state: AgentStep["state"], detail?: string) {
  s.steps = s.steps.map((st) => (st.id === id ? { ...st, state, at: stamp(s.clock), ...(detail ? { detail } : {}) } : st));
}

export function audit(s: LoopState, event: string, actor: string, tone: AuditEntry["tone"] = "neutral", detail?: string) {
  s.audit = [...s.audit, { id: `${event}-${s.audit.length}`, at: stamp(s.clock), actor, event, tone, detail }];
}

/** Coarse progress for the UI progress bar, derived from milestones. */
export function computeProgress(s: LoopState): number {
  if (s.finished) return 1;
  if (s.denial) return 0.95;
  if (s.incidentStatus === "resolved") return 0.85;
  if (s.gateState === "allowed") return 0.72;
  if (s.gateState === "pending") return 0.62;
  const done = s.steps.filter((x) => x.state === "done").length;
  return Math.min(0.55, 0.1 + done * 0.11);
}
```

- [ ] **Step 2: `src/traffic.ts`** (complete file):

```ts
const results: { t: number; ok: boolean }[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

export function startTraffic(paymentsUrl: string, intervalMs = 100) {
  stopTraffic();
  timer = setInterval(async () => {
    try {
      const r = await fetch(`${paymentsUrl}/pay`);
      results.push({ t: Date.now(), ok: r.ok });
    } catch {
      results.push({ t: Date.now(), ok: false });
    }
    if (results.length > 1500) results.splice(0, results.length - 1500);
  }, intervalMs);
}

export function stopTraffic() { if (timer) clearInterval(timer); timer = null; }
export function clearTraffic() { results.length = 0; }

export function errorRate(windowMs = 3000): number {
  const cut = Date.now() - windowMs;
  const w = results.filter((r) => r.t >= cut);
  if (!w.length) return 0;
  return (100 * w.filter((r) => !r.ok).length) / w.length;
}

/** 54 bucketed samples over the last 9s — matches the sparkline the UI expects. */
export function series(samples = 54, windowMs = 9000): number[] {
  const now = Date.now();
  const bucket = windowMs / samples;
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const end = now - windowMs + (i + 1) * bucket;
    const w = results.filter((r) => r.t >= end - bucket * 3 && r.t < end);
    out.push(w.length ? (100 * w.filter((r) => !r.ok).length) / w.length : 0);
  }
  return out;
}
```

- [ ] **Step 3: `src/server.ts`** (complete file; orchestrator imported in A4):

```ts
import express from "express";
import cors from "cors";
import type { LoopState } from "../../../src/lib/contract";
import { AGENT_ROUTES } from "../../../src/lib/contract";
import { store, computeProgress } from "./state";
import { errorRate, series } from "./traffic";
import { startIncident, thrash, resetDemo } from "./orchestrator";

const PORT = Number(process.env.PORT ?? 4000);
const app = express();
app.use(cors());
app.use(express.json());

app.get(AGENT_ROUTES.events, (req, res) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  const send = (s: LoopState) => res.write(`data: ${JSON.stringify(s)}\n\n`);
  send(store.state);
  const onChange = (s: LoopState) => send(s);
  store.on("change", onChange);
  const hb = setInterval(() => res.write(":hb\n\n"), 15000);
  req.on("close", () => { store.off("change", onChange); clearInterval(hb); });
});

app.get(AGENT_ROUTES.state, (_req, res) => { res.json(store.state); });
app.post(AGENT_ROUTES.start, (_req, res) => { startIncident(); res.json({ ok: true }); });
app.post(AGENT_ROUTES.thrash, (_req, res) => { thrash(); res.json({ ok: true }); });
app.post(AGENT_ROUTES.reset, async (_req, res) => { await resetDemo(); res.json({ ok: true }); });

// Live telemetry ticker: keeps chart + progress fresh between orchestrator beats.
setInterval(() => {
  if (!store.state.started || store.state.finished) return;
  store.mutate((s) => {
    s.errorRate = errorRate();
    s.series = series();
    s.progress = computeProgress(s);
  });
}, 250);

app.listen(PORT, () => console.log(`[vigil-agent] :${PORT}`));
```

- [ ] **Step 4: temporary stub `src/orchestrator.ts`** so the server runs now
(replaced wholesale in A4):

```ts
export async function startIncident() { console.log("orchestrator: not implemented yet"); }
export async function thrash() {}
export async function resetDemo() {}
```

- [ ] **Step 5: verify** — `npx tsx src/server.ts &` then
`curl -N localhost:4000/events` prints one `data: {...}` snapshot and stays
open; `curl -s localhost:4000/state | head -c 200` shows fresh LoopState. Kill it.

- [ ] **Step 6: commit** — `git commit -m "feat: vigil-agent state store, traffic loop, SSE server"`

---

### Task A3: fallback parser + integration clients

**Files:**
- Create: `services/vigil-agent/src/parse-fallback.ts`
- Create: `services/vigil-agent/src/parse-fallback.test.ts`
- Create: `services/vigil-agent/src/clients.ts`

**Interfaces (Produces — B and C plug into these via env, not code):**
- `parseLogs(raw): Promise<ParsedLogs>` — Zero live when `ZERO_MODE=live`, else fallback
- `requestGrant(req: GrantRequest): Promise<GrantResponse>` — gate when `GATE_URL` set
- `diagnose(req: DiagnoseRequest): Promise<DiagnoseResponse>` — worker when `WORKER_URL` set
- `applyRemediation(action, token)` — via `POMERIUM_URL` else `PAYMENTS_URL`

- [ ] **Step 1: failing test `src/parse-fallback.test.ts`** (node:test, run with tsx):

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLogsFallback } from "./parse-fallback";

test("parses the .vlog fixture to the dominant error signature", () => {
  const raw = readFileSync(new URL("../../../shared/fixtures/payments.vlog", import.meta.url), "utf8");
  const p = parseLogsFallback(raw);
  assert.equal(p.errorSignature, "ERR_TIMEOUT_CFG");
  assert.equal(p.suspectComponent, "stripe_adapter");
  assert.equal(p.suspectDeploy, "#4821");
  assert.equal(p.parserSource, "fallback");
  assert.ok(p.sampleLines.length >= 1);
});
```

Run: `npx tsx src/parse-fallback.test.ts` — expect FAIL (module not found).

- [ ] **Step 2: implement `src/parse-fallback.ts`**:

```ts
import { VLOG_LINE, type ParsedLogs } from "../../../src/lib/contract";

export function parseLogsFallback(raw: string): ParsedLogs {
  const errorLines: { line: string; component: string; code: string; rest: string }[] = [];
  for (const line of raw.split("\n")) {
    const m = VLOG_LINE.exec(line.trim());
    if (m?.groups && m.groups.lvl === "E") {
      errorLines.push({ line: line.trim(), component: m.groups.component, code: m.groups.code, rest: m.groups.rest });
    }
  }
  const count = (key: (e: (typeof errorLines)[number]) => string) => {
    const map = new Map<string, number>();
    for (const e of errorLines) map.set(key(e), (map.get(key(e)) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const deploy = errorLines.map((e) => /deploy=(#\d+)/.exec(e.rest)?.[1]).find(Boolean);
  return {
    errorSignature: count((e) => e.code) ?? "UNKNOWN",
    suspectComponent: count((e) => e.component) ?? "unknown",
    suspectDeploy: deploy,
    sampleLines: errorLines.slice(0, 3).map((e) => e.line),
    parserSource: "fallback",
  };
}
```

Run test again — expect all asserts PASS.

- [ ] **Step 3: implement `src/clients.ts`**:

```ts
import type {
  DiagnoseRequest, DiagnoseResponse, GrantRequest, GrantResponse, ParsedLogs,
} from "../../../src/lib/contract";
import { parseLogsFallback } from "./parse-fallback";
import { parseLogsLive } from "./integrations/zero-live";

export const PAYMENTS_URL = process.env.PAYMENTS_URL ?? "http://localhost:4100";
const GATE_URL = process.env.GATE_URL;
const WORKER_URL = process.env.WORKER_URL;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json()) as T;
}

export async function parseLogs(raw: string): Promise<ParsedLogs> {
  if (process.env.ZERO_MODE === "live") {
    try { return await parseLogsLive(raw); }
    catch (e) { console.warn("[zero] live parse failed, using fallback:", (e as Error).message); }
  }
  return parseLogsFallback(raw);
}

export async function requestGrant(req: GrantRequest): Promise<GrantResponse> {
  if (GATE_URL) return postJson<GrantResponse>(`${GATE_URL}/grants`, req);
  // Local fallback mirrors the real gate policy so the demo works pre-merge.
  if (req.servicesAffected > 3) return { verdict: "denied", scope: `requested: ${req.servicesAffected} services`, reason: "blast radius over limit" };
  if (!req.sandboxPassed) return { verdict: "denied", scope: `requested: ${req.service}`, reason: "no sandbox evidence for a destructive action" };
  if (req.consecutiveFailures >= 2) return { verdict: "denied", scope: `requested: ${req.service}`, reason: "policy tightened after repeat failure" };
  return { verdict: "allowed", scope: `${req.service} only`, token: `local-${Math.random().toString(36).slice(2)}`, ttlSeconds: 60, singleUse: true };
}

export async function diagnose(req: DiagnoseRequest): Promise<DiagnoseResponse> {
  if (WORKER_URL) return postJson<DiagnoseResponse>(`${WORKER_URL}/diagnose`, req);
  const parsed = parseLogsFallback(req.rawLogs);
  const cfgRelated = /CFG|TIMEOUT/.test(parsed.errorSignature);
  const matchesDeploy = parsed.suspectDeploy === req.deployId;
  const passed = cfgRelated && matchesDeploy;
  return {
    sandboxPassed: passed,
    rootCause: `deploy ${req.deployId} changed ${parsed.suspectComponent} timeout handling (${parsed.errorSignature})`,
    recommendedAction: passed ? req.candidateAction : "escalate",
    checks: [
      { name: "errors_cluster_after_deploy", passed: matchesDeploy },
      { name: "signature_is_config_related", passed: cfgRelated },
      { name: "rollback_target_exists", passed: true },
    ],
  };
}

export async function applyRemediation(action: "rollback" | "restart", token: string) {
  const base = process.env.POMERIUM_URL ?? PAYMENTS_URL;
  const r = await fetch(`${base}/${action}`, { method: "POST", headers: { "x-vigil-grant": token } });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}
```

- [ ] **Step 4: commit** — `git commit -m "feat: fallback parser + env-switched integration clients"`

---

### Task A4: the orchestrator (real autonomous loop)

**Files:**
- Replace: `services/vigil-agent/src/orchestrator.ts` (delete the A2 stub content)

Mirror the sim's narrative beats (`src/lib/use-incident-sim.ts` EVENTS array) but
drive them from real calls. Complete file:

```ts
import { audit, computeProgress, setStep, stamp, store } from "./state";
import { clearTraffic, errorRate, startTraffic, stopTraffic } from "./traffic";
import { PAYMENTS_URL, applyRemediation, diagnose, parseLogs, requestGrant } from "./clients";

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
```

- [ ] **Verify end-to-end (fallback mode, no other services needed):**

```bash
cd services/payments-api && npx tsx src/index.ts &
cd services/vigil-agent && npx tsx src/server.ts &
curl -s -X POST localhost:4000/demo/start
sleep 6  && curl -s localhost:4000/state | python3 -c "import json,sys; s=json.load(sys.stdin); print(s['incidentStatus'], round(s['errorRate'],1), [x['state'] for x in s['steps']])"
# expect: active <double-digit rate> with early steps done/active
sleep 12 && curl -s localhost:4000/state | python3 -c "import json,sys; s=json.load(sys.stdin); print(s['incidentStatus'], s['gateState'], s['grantConsumed'], s['denial'] is not None, s['finished'])"
# expect: resolved denied True True True
curl -s -X POST localhost:4000/demo/reset
```

- [ ] **Commit** — `git commit -m "feat: autonomous incident loop — detect, diagnose, gate, rollback, clamp"`

---

### Task A5 (STRETCH — only if A1–A4 are done and pushed): OpenAI hypothesis

**Files:** Create `services/vigil-agent/src/hypothesis.ts`; call it in the
orchestrator right after `parseLogs`, adding an audit line with the model's
one-sentence root-cause hypothesis.

```ts
import type { ParsedLogs } from "../../../src/lib/contract";

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export async function hypothesize(parsed: ParsedLogs, deployNote: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 150,
        temperature: 0.2,
        messages: [
          { role: "system", content: "You are an SRE assistant. Answer in exactly one concise sentence." },
          { role: "user", content: `Incident evidence: error signature ${parsed.errorSignature} in ${parsed.suspectComponent}, started after deploy ${parsed.suspectDeploy} ("${deployNote}"). Sample: ${parsed.sampleLines[0] ?? ""}. In ONE sentence, state the most likely root cause and whether rollback is the right fix.` },
        ],
      }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.warn("[hypothesis] skipped:", (e as Error).message);
    return null;
  }
}
```

In the orchestrator after the Zero audit line:

```ts
const hypo = await hypothesize(parsed, bad.note);
if (hypo) store.mutate((s) => audit(s, "Hypothesis formed", "agent", "neutral", hypo));
```

Verify with the end-to-end curl run; commit `feat: LLM hypothesis step (optional)`.

---

**Definition of done for this branch:** the A4 end-to-end curl sequence passes on
a clean checkout with only these two services running, all fallbacks active.
Push the branch. Post "A done" in team chat.
