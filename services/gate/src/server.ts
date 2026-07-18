import express from "express";
import cors from "cors";
import type { GrantRequest, GrantResponse, VerifyRequest } from "../../../src/lib/contract";
import { DEFAULT_CONTEXT, evaluatePolicy } from "./policy";
import { createGrantStore } from "./grants";
import { DenialThrottle } from "./throttle";
import { AUTH_ENABLED, ATTEST_ENABLED, env, isDev, logGateConfig } from "./env";
import { captureRawBody, requireInternalAuth, verifyAttestation } from "../../shared/auth";
import { asyncHandler, errorHandler, installSafetyNets, installSignalHandlers, onShutdown, validateBody } from "../../shared/http";
import { grantRequestSchema, verifyRequestSchema } from "./validation";
import { correlationMiddleware, createLogger, initErrorReporting, initMetrics, initTracing, metricsHandler } from "../../shared/observability";
import { decisionLatency, grantsConsumed, grantsDenied, grantsIssued } from "./metrics";

const SERVICE = "gate";
const log = createLogger(SERVICE);
initMetrics();
void initErrorReporting(SERVICE);
void initTracing(SERVICE);
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
app.use(correlationMiddleware(log));

app.get("/health", asyncHandler(async (_req, res) => {
  res.status(200).json({ ok: true, standingGrants: await store.standing() });
}));

app.get("/metrics", metricsHandler());

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

app.post("/grants", requireAuth, validateBody(grantRequestSchema), asyncHandler(async (req, res) => {
  const gr = req.body as GrantRequest;
  // Identity comes from the authenticated caller, never the request body.
  const requestedBy =
    (req as { vigilCaller?: string }).vigilCaller ?? (isDev ? gr.requestedBy || "unknown" : "unknown");
  const key = `${requestedBy}:${gr.action}`;

  // Replace trusted booleans with verified evidence before policy runs.
  const endTimer = decisionLatency.startTimer();
  const effective: GrantRequest = { ...gr, requestedBy, sandboxPassed: sandboxProven(gr) };
  const result = evaluatePolicy(effective, { ...DEFAULT_CONTEXT, observedFailures: throttle.observed(key) });
  endTimer();

  let response: GrantResponse;
  if (result.verdict === "allowed") {
    throttle.reset(key); // success clears the denial counter for this key
    const g = await store.mint(gr.action, gr.service, TTL_SECONDS);
    response = { ...result, token: g.token, ttlSeconds: TTL_SECONDS, singleUse: true };
    grantsIssued.inc({ action: gr.action });
  } else {
    throttle.recordDenial(key);
    response = result;
    grantsDenied.inc({ action: gr.action, reason: response.reason ?? "unknown" });
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
  const reqLog = (req as { log?: typeof log }).log ?? log;
  reqLog.info(
    { verdict: response.verdict, action: gr.action, service: gr.service, requestedBy, reason: response.reason ?? response.scope },
    "grant decision",
  );
  res.json(response);
}));

app.post("/grants/verify", requireAuth, validateBody(verifyRequestSchema), asyncHandler(async (req, res) => {
  const { token, action, service } = req.body as VerifyRequest;
  const v = await store.verifyAndConsume(token, action, service);
  grantsConsumed.inc({ result: v.valid ? "ok" : "rejected" });
  const reqLog = (req as { log?: typeof log }).log ?? log;
  reqLog.info({ action, service, valid: v.valid, reason: v.reason }, "grant verify");
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
  log.info({ port: PORT, authEnforced: AUTH_ENABLED, attestationEnforced: ATTEST_ENABLED }, "gate listening");
});

onShutdown(() => { clearInterval(sweeper); });
onShutdown(() => new Promise<void>((r) => server.close(() => r())));
onShutdown(() => store.close());
installSignalHandlers(SERVICE);
