import express from "express";
import cors from "cors";
import type { LoopState } from "../../../src/lib/contract";
import { AGENT_ROUTES } from "../../../src/lib/contract";
import { store, computeProgress } from "./state";
import { errorRate, series } from "./traffic";
import { startIncident, thrash, resetDemo } from "./orchestrator";
import { env, logAgentConfig } from "./env";

const PORT = env.PORT;
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

app.listen(PORT, () => { logAgentConfig(); console.log(`[vigil-agent] :${PORT}`); });
