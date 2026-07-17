import express from "express";
import cors from "cors";
import type { Response } from "express";
import type { LoopState } from "../../../src/lib/contract";
import { AGENT_ROUTES } from "../../../src/lib/contract";
import { store, computeProgress } from "./state";
import { errorRate, series } from "./traffic";
import { startIncident, thrash, resetDemo } from "./orchestrator";
import { env, isDev, logAgentConfig } from "./env";
import { asyncHandler, errorHandler, installSafetyNets, installSignalHandlers, onShutdown } from "../../shared/http";
import { correlationMiddleware, createLogger, initErrorReporting, initMetrics, initTracing, metricsHandler } from "../../shared/observability";
import { sseClientsGauge, sseDropped } from "./metrics";

const SERVICE = "vigil-agent";
const log = createLogger(SERVICE);
initMetrics();
void initErrorReporting(SERVICE);
void initTracing(SERVICE);
installSafetyNets(SERVICE);

const PORT = env.PORT;
const MAX_SSE = Number(process.env.MAX_SSE_CLIENTS ?? 50);

const app = express();
app.use(cors());
app.use(express.json());
app.use(correlationMiddleware(log));

/** Open SSE responses, tracked so shutdown can end them cleanly. */
const sseClients = new Set<Response>();

app.get("/health", (_req, res) => { res.json({ ok: true, service: SERVICE, sseClients: sseClients.size }); });
app.get("/metrics", metricsHandler());

app.get(AGENT_ROUTES.events, (req, res) => {
  // Cap concurrent SSE clients so a flood can't exhaust memory/sockets.
  if (sseClients.size >= MAX_SSE) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "too many SSE clients" }));
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "access-control-allow-origin": "*",
  });
  sseClients.add(res);
  sseClientsGauge.set(sseClients.size);

  // Each message is a full LoopState snapshot, so a frame dropped under
  // backpressure is harmless — the next carries the latest state. A client that
  // stays backed up (slow consumer) is dropped so it can't balloon memory.
  let strikes = 0;
  const send = (s: LoopState) => {
    const ok = res.write(`data: ${JSON.stringify(s)}\n\n`);
    if (ok) { strikes = 0; return; }
    if (++strikes > 5) { sseDropped.inc(); teardown(); res.end(); }
  };
  const hb = setInterval(() => { res.write(":hb\n\n"); }, 15000);
  function teardown() {
    store.off("change", send);
    clearInterval(hb);
    if (sseClients.delete(res)) sseClientsGauge.set(sseClients.size);
  }

  send(store.state); // initial snapshot
  store.on("change", send);
  req.on("close", teardown);
});

app.get(AGENT_ROUTES.state, (_req, res) => { res.json(store.state); });

// Demo trigger controls. Unauthenticated by nature (the browser drives them),
// so they are dev-only. In prod the loop is driven by real alerting, not a
// button — these are compiled out (404). See PRODUCTION.md for the prod trigger.
if (isDev) {
  app.post(AGENT_ROUTES.start, (_req, res) => { void startIncident(); res.json({ ok: true }); });
  app.post(AGENT_ROUTES.thrash, (_req, res) => { void thrash(); res.json({ ok: true }); });
  app.post(AGENT_ROUTES.reset, asyncHandler(async (_req, res) => { await resetDemo(); res.json({ ok: true }); }));
}

app.use(errorHandler(SERVICE));

// Live telemetry ticker: keeps chart + progress fresh between orchestrator beats.
const ticker = setInterval(() => {
  if (!store.state.started || store.state.finished) return;
  store.mutate((s) => {
    s.errorRate = errorRate();
    s.series = series();
    s.progress = computeProgress(s);
  });
}, 250);

const server = app.listen(PORT, () => { logAgentConfig(); log.info({ port: PORT }, "vigil-agent listening"); });

onShutdown(() => { clearInterval(ticker); });
onShutdown(() => {
  for (const res of sseClients) { try { res.end(); } catch { /* already closed */ } }
  sseClients.clear();
});
onShutdown(() => new Promise<void>((r) => server.close(() => r())));
installSignalHandlers(SERVICE);
