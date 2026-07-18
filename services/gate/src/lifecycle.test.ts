import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONTEXT, evaluatePolicy } from "./policy";
import { MemoryGrantStore } from "./grants";
import { DenialThrottle } from "./throttle";
import { signAttestation, verifyAttestation } from "../../shared/auth";

/**
 * Integration of the units the gate wires together end to end: attestation →
 * policy decision → mint → single-use consume → deny + throttle paths. (The full
 * spawned gate↔agent↔payments HTTP lifecycle is exercised by the acceptance
 * scripts and the docker-network run; this keeps the security core covered in a
 * fast, dependency-free CI test.)
 */
const grant = (over: Record<string, unknown> = {}) => ({
  action: "rollback" as const, service: "payments-api", servicesAffected: 1,
  sandboxPassed: true, budgetUsed: 0, consecutiveFailures: 0, requestedBy: "vigil-agent",
  ...over,
});

test("attested rollback: allowed → single use → reuse denied", async () => {
  const store = new MemoryGrantStore();
  const throttle = new DenialThrottle();
  const ATTEST = "worker-attest-secret";

  // Worker vouches; gate can verify without trusting the agent.
  const attestation = signAttestation(ATTEST, "payments-api", "#4821", true);
  assert.equal(verifyAttestation(ATTEST, "payments-api", "#4821", true, attestation), true);

  const key = "vigil-agent:rollback";
  const decision = evaluatePolicy(grant(), { ...DEFAULT_CONTEXT, observedFailures: throttle.observed(key) });
  assert.equal(decision.verdict, "allowed");
  throttle.reset(key);

  const g = await store.mint("rollback", "payments-api", 60);
  assert.equal((await store.verifyAndConsume(g.token, "rollback", "payments-api")).valid, true);
  assert.equal((await store.verifyAndConsume(g.token, "rollback", "payments-api")).valid, false);
});

test("mass-restart escalation is denied and records a throttle strike", () => {
  const throttle = new DenialThrottle();
  const key = "vigil-agent:mass-restart";
  const d = evaluatePolicy(
    grant({ action: "mass-restart", service: "all", servicesAffected: 12, sandboxPassed: false, consecutiveFailures: 2 }),
    { ...DEFAULT_CONTEXT, observedFailures: throttle.observed(key) },
  );
  assert.equal(d.verdict, "denied");
  throttle.recordDenial(key);
  assert.equal(throttle.observed(key), 1);
});

test("unattested sandbox is treated as no evidence (fail closed)", () => {
  // The gate sets sandboxProven=false without a valid attestation; policy then
  // denies for lack of sandbox evidence.
  const d = evaluatePolicy(grant({ sandboxPassed: false }), DEFAULT_CONTEXT);
  assert.equal(d.verdict, "denied");
  assert.match(d.reason ?? "", /sandbox/);
});

test("a gate-observed failure streak tightens policy even if the caller lies", () => {
  // Caller self-reports 0 failures, but the gate has observed 2 → still denied.
  const d = evaluatePolicy(grant({ consecutiveFailures: 0 }), { ...DEFAULT_CONTEXT, observedFailures: 2 });
  assert.equal(d.verdict, "denied");
});
