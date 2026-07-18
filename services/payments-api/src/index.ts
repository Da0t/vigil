import express from "express";
import cors from "cors";
import type { VerifyResponse } from "../../../src/lib/contract";
import { AUTH_ENABLED, env, isDev, isProd, logPaymentsConfig } from "./env";
import { captureRawBody, requireInternalAuth, signRequest } from "../../shared/auth";
import { asyncHandler, errorHandler, installSafetyNets, installSignalHandlers, onShutdown } from "../../shared/http";
import { CORRELATION_HEADER, correlationMiddleware, createLogger, initErrorReporting, initMetrics, initTracing, metricsHandler } from "../../shared/observability";

const SERVICE = "payments-api";
const logger = createLogger(SERVICE);
initMetrics();
void initErrorReporting(SERVICE);
void initTracing(SERVICE);
installSafetyNets(SERVICE);

const PORT = env.PORT;
const GATE_URL = env.GATE_URL;

const requireAuth = requireInternalAuth({ secret: env.VIGIL_INTERNAL_SECRET, enabled: AUTH_ENABLED });

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

async function grantValid(token: string | undefined, action: string, correlationId?: string): Promise<{ ok: boolean; reason?: string }> {
  if (!GATE_URL) {
    // Fail CLOSED in prod: with no gate we cannot prove a grant, so refuse.
    // Fail CONVENIENT in dev: the ungated local path keeps the demo runnable.
    if (isProd) return { ok: false, reason: "no gate configured (fail closed)" };
    logger.warn({ action }, "GATE_URL unset — allowed ungated (dev only)");
    return { ok: true };
  }
  if (!token) return { ok: false, reason: "no grant presented" };

  const path = "/grants/verify";
  const body = JSON.stringify({ token, action, service: "payments-api" });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (correlationId) headers[CORRELATION_HEADER] = correlationId;
  if (env.VIGIL_INTERNAL_SECRET) {
    Object.assign(headers, signRequest(env.VIGIL_INTERNAL_SECRET, "payments-api", "POST", path, body));
  }
  try {
    const r = await fetch(`${GATE_URL}${path}`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return { ok: false, reason: `gate verify failed (${r.status})` };
    const v = (await r.json()) as VerifyResponse;
    return v.valid ? { ok: true } : { ok: false, reason: v.reason };
  } catch (e) {
    // Fail closed: unreachable gate ⇒ unproven grant ⇒ reject.
    return { ok: false, reason: `gate unreachable (${(e as Error).message})` };
  }
}

const app = express();
app.use(cors());
app.use(express.json({ verify: captureRawBody }));
app.use(correlationMiddleware(logger));

app.get("/health", (_req, res) => { res.json({ ok: !broken, deploy: current }); });
app.get("/metrics", metricsHandler());

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

// Demo-only scaffolding: these routes fabricate/undo an incident. In prod the
// service breaks for real, so they are compiled out entirely (404) rather than
// left as an unauthenticated way to break production.
if (isDev) {
  app.post("/admin/break", (_req, res) => {
    broken = true;
    const bad = deploys.find((d) => d.id === "#4821");
    if (bad) bad.status = "bad";
    log("I", "deployer", "DEPLOY_APPLIED", { deploy: "#4821", files: "stripe_adapter.ts" });
    res.json({ ok: true, broken });
  });

  app.post("/admin/reset", (_req, res) => { seed(); res.json({ ok: true }); });
}

app.post("/rollback", requireAuth, asyncHandler(async (req, res) => {
  const g = await grantValid(req.header("x-vigil-grant"), "rollback", (req as { correlationId?: string }).correlationId);
  const reqLog = (req as { log?: typeof logger }).log ?? logger;
  reqLog.info({ action: "rollback", granted: g.ok, reason: g.reason }, "destructive call");
  if (!g.ok) { res.status(403).json({ error: "grant rejected", reason: g.reason }); return; }
  broken = false;
  current = "#4820";
  const bad = deploys.find((d) => d.id === "#4821");
  if (bad) bad.status = "rolled_back";
  log("I", "deployer", "ROLLBACK_OK", { to: "#4820" });
  res.json({ ok: true, deploy: current });
}));

app.post("/restart", requireAuth, asyncHandler(async (req, res) => {
  const g = await grantValid(req.header("x-vigil-grant"), "restart", (req as { correlationId?: string }).correlationId);
  if (!g.ok) { res.status(403).json({ error: "grant rejected", reason: g.reason }); return; }
  log("I", "supervisor", "RESTART_OK", { deploy: current });
  res.json({ ok: true, restarted: true, note: "restart does not fix a bad deploy" });
}));

app.use(errorHandler(SERVICE));

const server = app.listen(PORT, () => { logPaymentsConfig(); console.log(`[payments-api] :${PORT}`); });
onShutdown(() => new Promise<void>((r) => server.close(() => r())));
installSignalHandlers(SERVICE);
