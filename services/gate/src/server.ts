import express from "express";
import cors from "cors";
import type { GrantRequest, GrantResponse, VerifyRequest } from "../../../src/lib/contract";
import { DEFAULT_CONTEXT, evaluatePolicy } from "./policy";
import { GrantStore } from "./grants";
import { DenialThrottle } from "./throttle";
import { AUTH_ENABLED, ATTEST_ENABLED, env, isDev, logGateConfig } from "./env";
import { captureRawBody, requireInternalAuth, verifyAttestation } from "../../shared/auth";

const PORT = env.PORT;
const TTL_SECONDS = 60;

const store = new GrantStore();
/** Behavior-reactive throttle, keyed on AUTHENTICATED identity + action. */
const throttle = new DenialThrottle();
/** Full decision log for GET /grants — the receipts (never includes tokens). */
const decisions: object[] = [];

const requireAuth = requireInternalAuth({ secret: env.VIGIL_INTERNAL_SECRET, enabled: AUTH_ENABLED });

const app = express();
app.use(cors());
app.use(express.json({ verify: captureRawBody }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, standingGrants: store.standing() });
});

/**
 * The gate must not trust self-reported evidence. `sandboxPassed` only counts
 * when a valid worker attestation backs it (in prod / when attestation is on);
 * otherwise a destructive action rests on an unsigned boolean, which we refuse.
 */
function sandboxProven(gr: GrantRequest): boolean {
  if (!gr.sandboxPassed) return false; // the caller didn't even claim success
  if (!ATTEST_ENABLED) return true; // dev: trust the boolean (fail convenient)
  if (!gr.attestation || !gr.deployId || !env.WORKER_ATTEST_SECRET) return false;
  return verifyAttestation(env.WORKER_ATTEST_SECRET, gr.service, gr.deployId, true, gr.attestation);
}

app.post("/grants", requireAuth, (req, res) => {
  const gr = req.body as GrantRequest;
  // Identity comes from the authenticated caller, never the request body.
  const requestedBy =
    (req as { vigilCaller?: string }).vigilCaller ?? (isDev ? gr.requestedBy || "unknown" : "unknown");
  const key = `${requestedBy}:${gr.action}`;

  // Replace trusted booleans with verified evidence before policy runs.
  const effective: GrantRequest = { ...gr, requestedBy, sandboxPassed: sandboxProven(gr) };
  const result = evaluatePolicy(effective, { ...DEFAULT_CONTEXT, observedFailures: throttle.observed(key) });

  let response: GrantResponse;
  if (result.verdict === "allowed") {
    throttle.reset(key); // success clears the denial counter for this key
    const g = store.mint(gr.action, gr.service, TTL_SECONDS);
    response = { ...result, token: g.token, ttlSeconds: TTL_SECONDS, singleUse: true };
  } else {
    throttle.recordDenial(key);
    response = result;
  }

  decisions.push({
    at: new Date().toISOString(),
    requestedBy,
    action: gr.action,
    service: gr.service,
    servicesAffected: gr.servicesAffected,
    sandboxProven: effective.sandboxPassed,
    verdict: response.verdict,
    scope: response.scope,
    reason: response.reason,
  });
  if (decisions.length > 500) decisions.shift();
  console.log(
    `[gate] ${response.verdict.toUpperCase()} ${gr.action} ${gr.service} by ${requestedBy} (${response.reason ?? response.scope})`,
  );
  res.json(response);
});

app.post("/grants/verify", requireAuth, (req, res) => {
  const { token, action, service } = req.body as VerifyRequest;
  const v = store.verifyAndConsume(token, action, service);
  console.log(`[gate] verify ${action} ${service}: ${v.valid ? "OK (consumed)" : `REJECTED (${v.reason})`}`);
  res.json(v);
});

app.get("/grants", requireAuth, (_req, res) => {
  // Never leak live token strings — redact to a short, non-usable prefix.
  const grants = store.list().map((g) => ({ ...g, token: `${g.token.slice(0, 8)}…` }));
  res.json({ standingGrants: store.standing(), grants, decisions });
});

app.listen(PORT, () => {
  logGateConfig();
  console.log(`[gate] :${PORT} (auth ${AUTH_ENABLED ? "ENFORCED" : "disabled — dev"}, attestation ${ATTEST_ENABLED ? "ENFORCED" : "disabled — dev"})`);
});
