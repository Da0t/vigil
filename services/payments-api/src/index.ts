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
