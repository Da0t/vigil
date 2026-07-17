import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, DEFAULT_CONTEXT } from "./policy";
import type { GrantRequest } from "../../../src/lib/contract";

const good: GrantRequest = {
  action: "rollback", service: "payments-api", servicesAffected: 1,
  sandboxPassed: true, budgetUsed: 0.1, consecutiveFailures: 0, requestedBy: "vigil-agent",
};

test("allows a scoped, sandbox-backed rollback", () => {
  const r = evaluatePolicy(good, DEFAULT_CONTEXT);
  assert.equal(r.verdict, "allowed");
  assert.equal(r.scope, "payments-api only");
});

test("denies when blast radius exceeds threshold", () => {
  const r = evaluatePolicy({ ...good, action: "mass-restart", servicesAffected: 12 }, DEFAULT_CONTEXT);
  assert.equal(r.verdict, "denied");
  assert.match(r.reason ?? "", /blast radius/);
});

test("denies destructive action without sandbox evidence", () => {
  const r = evaluatePolicy({ ...good, sandboxPassed: false }, DEFAULT_CONTEXT);
  assert.equal(r.verdict, "denied");
  assert.match(r.reason ?? "", /sandbox/);
});

test("denies when budget exhausted", () => {
  const r = evaluatePolicy({ ...good, budgetUsed: 9 }, DEFAULT_CONTEXT);
  assert.equal(r.verdict, "denied");
  assert.match(r.reason ?? "", /budget/);
});

test("denies after repeat failures (self-reported or gate-observed)", () => {
  assert.equal(evaluatePolicy({ ...good, consecutiveFailures: 2 }, DEFAULT_CONTEXT).verdict, "denied");
  assert.equal(evaluatePolicy(good, { ...DEFAULT_CONTEXT, observedFailures: 2 }).verdict, "denied");
});
