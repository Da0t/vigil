import test from "node:test";
import assert from "node:assert/strict";
import { grantRequestSchema, verifyRequestSchema } from "./validation";

const validGrant = {
  action: "rollback",
  service: "payments-api",
  servicesAffected: 1,
  sandboxPassed: true,
  budgetUsed: 0.1,
  consecutiveFailures: 0,
  requestedBy: "vigil-agent",
};

test("a well-formed grant request passes", () => {
  assert.equal(grantRequestSchema.safeParse(validGrant).success, true);
});

test("an unknown action is rejected", () => {
  assert.equal(grantRequestSchema.safeParse({ ...validGrant, action: "delete-everything" }).success, false);
});

test("a non-boolean sandboxPassed is rejected (no undefined into policy)", () => {
  assert.equal(grantRequestSchema.safeParse({ ...validGrant, sandboxPassed: "yes" }).success, false);
  assert.equal(grantRequestSchema.safeParse({ ...validGrant, sandboxPassed: undefined }).success, false);
});

test("a negative servicesAffected is rejected", () => {
  assert.equal(grantRequestSchema.safeParse({ ...validGrant, servicesAffected: -3 }).success, false);
});

test("a missing service is rejected", () => {
  const { service, ...noService } = validGrant;
  void service;
  assert.equal(grantRequestSchema.safeParse(noService).success, false);
});

test("verify request requires token, action, service", () => {
  assert.equal(verifyRequestSchema.safeParse({ token: "t", action: "rollback", service: "payments-api" }).success, true);
  assert.equal(verifyRequestSchema.safeParse({ token: "", action: "rollback", service: "payments-api" }).success, false);
  assert.equal(verifyRequestSchema.safeParse({ action: "rollback", service: "payments-api" }).success, false);
});
