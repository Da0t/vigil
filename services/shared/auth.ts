/**
 * Mutual authentication for internal service-to-service calls.
 *
 * Every internal request carries an HMAC-SHA256 signature over a canonical
 * string that binds: HTTP method, request path, the CALLER'S CLAIMED IDENTITY,
 * a timestamp, and a hash of the raw body. The receiver recomputes it with the
 * shared secret and compares in constant time. Because the caller identity is
 * inside the signed payload, an external attacker cannot forge who they are —
 * so downstream policy (e.g. the gate's `requestedBy`) can trust the
 * authenticated identity instead of a request-body string.
 *
 * Threat model: this shared-secret scheme authenticates *membership* in the
 * internal mesh and integrity/freshness of each call. It does NOT cryptograph-
 * ically distinguish one internal peer from another (they share the secret) —
 * the upgrade path is per-caller keys or mTLS/SPIFFE, noted in PRODUCTION.md.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Requests whose timestamp is more than this far from the receiver's clock are rejected. */
export const CLOCK_SKEW_MS = 30_000;

export const CALLER_HEADER = "x-vigil-caller";
export const TIMESTAMP_HEADER = "x-vigil-timestamp";
export const SIGNATURE_HEADER = "x-vigil-signature";

export type SignedHeaders = Record<string, string>;
export type VerifyResult = { ok: true; caller: string } | { ok: false; reason: string };

function bodyHash(rawBody: string): string {
  return createHash("sha256").update(rawBody ?? "").digest("hex");
}

function canonical(method: string, path: string, caller: string, ts: string, rawBody: string): string {
  return [method.toUpperCase(), path, caller, ts, bodyHash(rawBody)].join("\n");
}

function hmac(secret: string, msg: string): string {
  return createHmac("sha256", secret).update(msg).digest("hex");
}

/** Produce the auth headers for an outgoing internal request. */
export function signRequest(
  secret: string,
  caller: string,
  method: string,
  path: string,
  rawBody: string,
  now: number = Date.now(),
): SignedHeaders {
  const ts = String(now);
  const sig = hmac(secret, canonical(method, path, caller, ts, rawBody));
  return {
    [CALLER_HEADER]: caller,
    [TIMESTAMP_HEADER]: ts,
    [SIGNATURE_HEADER]: sig,
  };
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** Verify an incoming internal request. On success returns the authenticated caller. */
export function verifyRequest(
  secret: string,
  method: string,
  path: string,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  now: number = Date.now(),
): VerifyResult {
  const caller = headerValue(headers, CALLER_HEADER);
  const ts = headerValue(headers, TIMESTAMP_HEADER);
  const sig = headerValue(headers, SIGNATURE_HEADER);
  if (!caller || !ts || !sig) return { ok: false, reason: "missing auth headers" };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(now - tsNum) > CLOCK_SKEW_MS) {
    return { ok: false, reason: "stale or invalid timestamp" };
  }

  const expected = hmac(secret, canonical(method, path, caller, ts, rawBody));
  if (!hexEqual(sig, expected)) return { ok: false, reason: "bad signature" };
  return { ok: true, caller };
}

/** Constant-time comparison of two hex strings; false (never throws) on malformed input. */
function hexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a ?? "", "hex");
  const bb = Buffer.from(b ?? "", "hex");
  return ba.length > 0 && ba.length === bb.length && timingSafeEqual(ba, bb);
}

/* ------------------------------------------------------------------ */
/* Sandbox attestation — the worker's proof that a diagnosis really ran */
/* ------------------------------------------------------------------ */

/**
 * The worker signs this over (service, deployId, sandboxPassed) with a secret
 * ONLY the worker and the gate share (NOT the agent). The agent forwards the
 * opaque signature to the gate, which re-derives it — so the agent cannot fake
 * `sandboxPassed`; only the worker that actually ran the sandbox can vouch.
 */
function attestationMessage(service: string, deployId: string, sandboxPassed: boolean): string {
  return `sandbox|${service}|${deployId}|${sandboxPassed}`;
}

export function signAttestation(secret: string, service: string, deployId: string, sandboxPassed: boolean): string {
  return hmac(secret, attestationMessage(service, deployId, sandboxPassed));
}

export function verifyAttestation(
  secret: string,
  service: string,
  deployId: string,
  sandboxPassed: boolean,
  sig: string,
): boolean {
  return hexEqual(sig, signAttestation(secret, service, deployId, sandboxPassed));
}

/* ------------------------------------------------------------------ */
/* Express glue — raw-body capture + auth middleware                   */
/* ------------------------------------------------------------------ */

/**
 * Pass as `express.json({ verify: captureRawBody })` so the exact bytes the
 * caller signed are available to the auth middleware (Express otherwise
 * discards the raw body after parsing).
 */
export function captureRawBody(req: IncomingMessage, _res: ServerResponse, buf: Buffer): void {
  (req as IncomingMessage & { rawBody?: string }).rawBody = buf.length ? buf.toString("utf8") : "";
}

// Minimal structural request/response types so shared/ needn't depend on express.
interface AuthReq {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: string;
  vigilCaller?: string;
}
interface AuthRes {
  status(code: number): { json(body: unknown): void };
}
type AuthNext = (err?: unknown) => void;

/**
 * Express middleware enforcing internal auth.
 *   - enabled=false (dev, no secret): pass through — fail convenient.
 *   - enabled=true, secret missing: 500 (misconfigured, fail closed).
 *   - otherwise: verify; 401 on failure; on success set req.vigilCaller.
 */
export function requireInternalAuth(opts: { secret?: string; enabled: boolean; now?: () => number }) {
  return (req: AuthReq, res: AuthRes, next: AuthNext): void => {
    if (!opts.enabled) {
      next();
      return;
    }
    if (!opts.secret) {
      res.status(500).json({ error: "internal auth misconfigured (no secret)" });
      return;
    }
    const result = verifyRequest(opts.secret, req.method, req.path, req.rawBody ?? "", req.headers, opts.now?.());
    if (!result.ok) {
      res.status(401).json({ error: "unauthenticated", reason: result.reason });
      return;
    }
    req.vigilCaller = result.caller;
    next();
  };
}
