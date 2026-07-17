import express from "express";
import cors from "cors";
import type { GrantRequest, GrantResponse, VerifyRequest } from "../../../src/lib/contract";
import { DEFAULT_CONTEXT, evaluatePolicy } from "./policy";
import { GrantStore } from "./grants";
import { env, logGateConfig } from "./env";

const PORT = env.PORT;
const TTL_SECONDS = 60;

const store = new GrantStore();
/** Gate-observed denial counts per requester+action (behavior-reactive policy). */
const denials = new Map<string, number>();
/** Full decision log for GET /grants — the receipts. */
const decisions: object[] = [];

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => { res.json({ ok: true, standingGrants: store.standing() }); });

app.post("/grants", (req, res) => {
  const gr = req.body as GrantRequest;
  const key = `${gr.requestedBy}:${gr.action}`;
  const result = evaluatePolicy(gr, { ...DEFAULT_CONTEXT, observedFailures: denials.get(key) ?? 0 });

  let response: GrantResponse;
  if (result.verdict === "allowed") {
    const g = store.mint(gr.action, gr.service, TTL_SECONDS);
    response = { ...result, token: g.token, ttlSeconds: TTL_SECONDS, singleUse: true };
  } else {
    denials.set(key, (denials.get(key) ?? 0) + 1);
    response = result;
  }
  decisions.push({ at: new Date().toISOString(), request: gr, verdict: response.verdict, scope: response.scope, reason: response.reason });
  console.log(`[gate] ${response.verdict.toUpperCase()} ${gr.action} ${gr.service} (${response.reason ?? response.scope})`);
  res.json(response);
});

app.post("/grants/verify", (req, res) => {
  const { token, action, service } = req.body as VerifyRequest;
  const v = store.verifyAndConsume(token, action, service);
  console.log(`[gate] verify ${action} ${service}: ${v.valid ? "OK (consumed)" : `REJECTED (${v.reason})`}`);
  res.json(v);
});

app.get("/grants", (_req, res) => {
  res.json({ standingGrants: store.standing(), grants: store.list(), decisions });
});

app.listen(PORT, () => { logGateConfig(); console.log(`[gate] :${PORT}`); });
