import test from "node:test";
import assert from "node:assert/strict";
import { signRequest, verifyRequest, CLOCK_SKEW_MS, signAttestation, verifyAttestation } from "./auth";

const SECRET = "test-internal-secret";
const t0 = 1_700_000_000_000;

test("a signed request verifies and yields the caller identity", () => {
  const h = signRequest(SECRET, "vigil-agent", "POST", "/grants", '{"a":1}', t0);
  const r = verifyRequest(SECRET, "POST", "/grants", '{"a":1}', h, t0);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.caller, "vigil-agent");
});

test("a tampered body is rejected", () => {
  const h = signRequest(SECRET, "vigil-agent", "POST", "/grants", '{"a":1}', t0);
  const r = verifyRequest(SECRET, "POST", "/grants", '{"a":2}', h, t0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /signature/);
});

test("a tampered path is rejected", () => {
  const h = signRequest(SECRET, "vigil-agent", "POST", "/grants", '{}', t0);
  const r = verifyRequest(SECRET, "POST", "/grants/verify", '{}', h, t0);
  assert.equal(r.ok, false);
});

test("a spoofed caller identity is rejected (identity is bound into the signature)", () => {
  const h = signRequest(SECRET, "vigil-agent", "POST", "/grants", '{}', t0);
  const r = verifyRequest(SECRET, "POST", "/grants", '{}', { ...h, "x-vigil-caller": "attacker" }, t0);
  assert.equal(r.ok, false);
});

test("a wrong secret is rejected", () => {
  const h = signRequest(SECRET, "vigil-agent", "POST", "/grants", '{}', t0);
  const r = verifyRequest("other-secret", "POST", "/grants", '{}', h, t0);
  assert.equal(r.ok, false);
});

test("a stale timestamp outside the skew window is rejected", () => {
  const h = signRequest(SECRET, "vigil-agent", "POST", "/grants", '{}', t0);
  const r = verifyRequest(SECRET, "POST", "/grants", '{}', h, t0 + CLOCK_SKEW_MS + 1);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /timestamp|stale/);
});

test("a fresh timestamp within the skew window is accepted", () => {
  const h = signRequest(SECRET, "vigil-agent", "POST", "/grants", '{}', t0);
  const r = verifyRequest(SECRET, "POST", "/grants", '{}', h, t0 + CLOCK_SKEW_MS - 1);
  assert.equal(r.ok, true);
});

test("missing auth headers are rejected", () => {
  const r = verifyRequest(SECRET, "POST", "/grants", '{}', {}, t0);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.reason, /missing/);
});

test("changing the HTTP method invalidates the signature", () => {
  const h = signRequest(SECRET, "vigil-agent", "POST", "/grants", '{}', t0);
  const r = verifyRequest(SECRET, "GET", "/grants", '{}', h, t0);
  assert.equal(r.ok, false);
});

// ---- worker→gate sandbox attestation (separate secret from request auth) ----
const ATTEST = "worker-attest-secret";

test("a worker attestation verifies against the same service/deploy/result", () => {
  const sig = signAttestation(ATTEST, "payments-api", "#4821", true);
  assert.equal(verifyAttestation(ATTEST, "payments-api", "#4821", true, sig), true);
});

test("an attestation cannot be replayed onto a different service", () => {
  const sig = signAttestation(ATTEST, "payments-api", "#4821", true);
  assert.equal(verifyAttestation(ATTEST, "billing-api", "#4821", true, sig), false);
});

test("an attestation cannot be flipped from failed to passed", () => {
  const failed = signAttestation(ATTEST, "payments-api", "#4821", false);
  // Attacker holds a 'failed' attestation but wants the gate to see 'passed'.
  assert.equal(verifyAttestation(ATTEST, "payments-api", "#4821", true, failed), false);
});

test("an attestation signed with the wrong secret is rejected", () => {
  const sig = signAttestation("agent-guessed-secret", "payments-api", "#4821", true);
  assert.equal(verifyAttestation(ATTEST, "payments-api", "#4821", true, sig), false);
});

test("a malformed attestation string is rejected, not thrown", () => {
  assert.equal(verifyAttestation(ATTEST, "payments-api", "#4821", true, "not-hex-zzz"), false);
  assert.equal(verifyAttestation(ATTEST, "payments-api", "#4821", true, ""), false);
});
