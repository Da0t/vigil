/**
 * auth-lite — self-contained duplicate of the parts of services/shared/auth.ts
 * this container needs (verify inbound requests, sign sandbox attestations).
 *
 * Like contract-lite.ts, the worker is built from an isolated Docker context and
 * cannot import ../../shared/auth. The canonical string + attestation message
 * formats below MUST stay BYTE-CONSISTENT with services/shared/auth.ts — the
 * agent signs requests with that module and the gate verifies attestations with
 * it, so any divergence breaks authentication silently.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const CLOCK_SKEW_MS = 30_000;
const CALLER_HEADER = "x-vigil-caller";
const TIMESTAMP_HEADER = "x-vigil-timestamp";
const SIGNATURE_HEADER = "x-vigil-signature";

function bodyHash(rawBody: string): string {
  return createHash("sha256").update(rawBody ?? "").digest("hex");
}
function canonical(method: string, path: string, caller: string, ts: string, rawBody: string): string {
  return [method.toUpperCase(), path, caller, ts, bodyHash(rawBody)].join("\n");
}
function hmac(secret: string, msg: string): string {
  return createHmac("sha256", secret).update(msg).digest("hex");
}
function hexEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a ?? "", "hex");
  const bb = Buffer.from(b ?? "", "hex");
  return ba.length > 0 && ba.length === bb.length && timingSafeEqual(ba, bb);
}

export type VerifyResult = { ok: true; caller: string } | { ok: false; reason: string };

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

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
  if (!hexEqual(sig, hmac(secret, canonical(method, path, caller, ts, rawBody)))) {
    return { ok: false, reason: "bad signature" };
  }
  return { ok: true, caller };
}

export function signAttestation(secret: string, service: string, deployId: string, sandboxPassed: boolean): string {
  return hmac(secret, `sandbox|${service}|${deployId}|${sandboxPassed}`);
}

export function captureRawBody(req: IncomingMessage, _res: ServerResponse, buf: Buffer): void {
  (req as IncomingMessage & { rawBody?: string }).rawBody = buf.length ? buf.toString("utf8") : "";
}

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

export function requireInternalAuth(opts: { secret?: string; enabled: boolean }) {
  return (req: AuthReq, res: AuthRes, next: AuthNext): void => {
    if (!opts.enabled) {
      next();
      return;
    }
    if (!opts.secret) {
      res.status(500).json({ error: "internal auth misconfigured (no secret)" });
      return;
    }
    const result = verifyRequest(opts.secret, req.method, req.path, req.rawBody ?? "", req.headers);
    if (!result.ok) {
      res.status(401).json({ error: "unauthenticated", reason: result.reason });
      return;
    }
    req.vigilCaller = result.caller;
    next();
  };
}
