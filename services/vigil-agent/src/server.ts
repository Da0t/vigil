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

const SERVICE = "vigil-agent";
installSafetyNets(SERVICE);

const PORT = env.PORT;
const app = express();
app.use(cors());
app.use(express.json());

/** Open SSE responses, tracked so shutdown can end them cleanly. */
const sseClients = new Set<Response>();

app.get("/health", (_req, res) => { res.json({ ok: true, service: SERVICE, sseClients: sseClients.size }); });

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
  sseClients.add(res);
  const hb = setInterval(() => res.write(":hb\n\n"), 15000);
  req.on("close", () => { store.off("change", onChange); clearInterval(hb); sseClients.delete(res); });
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

const server = app.listen(PORT, () => { logAgentConfig(); console.log(`[vigil-agent] :${PORT}`); });

onShutdown(() => { clearInterval(ticker); });
onShutdown(() => {
  for (const res of sseClients) { try { res.end(); } catch { /* already closed */ } }
  sseClients.clear();
});
onShutdown(() => new Promise<void>((r) => server.close(() => r())));
installSignalHandlers(SERVICE);
