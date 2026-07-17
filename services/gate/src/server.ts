import express from "express";
import cors from "cors";
import type { GrantRequest, GrantResponse, VerifyRequest } from "../../../src/lib/contract";
import { DEFAULT_CONTEXT, evaluatePolicy } from "./policy";
import { createGrantStore } from "./grants";
import { DenialThrottle } from "./throttle";
import { AUTH_ENABLED, ATTEST_ENABLED, env, isDev, logGateConfig } from "./env";
import { captureRawBody, requireInternalAuth, verifyAttestation } from "../../shared/auth";
import { asyncHandler, errorHandler, installSafetyNets, installSignalHandlers, onShutdown } from "../../shared/http";

const SERVICE = "gate";
installSafetyNets(SERVICE);

const PORT = env.PORT;
const TTL_SECONDS = 60;

const store = createGrantStore(env.REDIS_URL);
/** Behavior-reactive throttle, keyed on AUTHENTICATED identity + action. */
const throttle = new DenialThrottle();
/** Bounded decision log for GET /grants — the receipts (never includes tokens). */
const decisions: object[] = [];

const requireAuth = requireInternalAuth({ secret: env.VIGIL_INTERNAL_SECRET, enabled: AUTH_ENABLED });

const app = express();
app.use(cors());
app.use(express.json({ verify: captureRawBody }));

app.get("/health", asyncHandler(async (_req, res) => {
  res.status(200).json({ ok: true, standingGrants: await store.standing() });
}));

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

app.post("/grants", requireAuth, asyncHandler(async (req, res) => {
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
    const g = await store.mint(gr.action, gr.service, TTL_SECONDS);
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
}));

app.post("/grants/verify", requireAuth, asyncHandler(async (req, res) => {
  const { token, action, service } = req.body as VerifyRequest;
  const v = await store.verifyAndConsume(token, action, service);
  console.log(`[gate] verify ${action} ${service}: ${v.valid ? "OK (consumed)" : `REJECTED (${v.reason})`}`);
  res.json(v);
}));

app.get("/grants", requireAuth, asyncHandler(async (_req, res) => {
  // Never leak live token strings — redact to a short, non-usable prefix.
  const grants = (await store.list()).map((g) => ({ ...g, token: `${g.token.slice(0, 8)}…` }));
  res.json({ standingGrants: await store.standing(), grants, decisions });
}));

app.use(errorHandler(SERVICE));

// Bound growth: periodically sweep expired grants + stale throttle entries.
const sweeper = setInterval(() => {
  void store.sweep();
  throttle.sweep();
}, 30_000);

const server = app.listen(PORT, () => {
  logGateConfig();
  console.log(`[gate] :${PORT} (auth ${AUTH_ENABLED ? "ENFORCED" : "disabled — dev"}, attestation ${ATTEST_ENABLED ? "ENFORCED" : "disabled — dev"})`);
});

onShutdown(() => { clearInterval(sweeper); });
onShutdown(() => new Promise<void>((r) => server.close(() => r())));
onShutdown(() => store.close());
installSignalHandlers(SERVICE);
