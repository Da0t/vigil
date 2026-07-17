import test from "node:test";
import assert from "node:assert/strict";
import { GrantStore } from "./grants";

test("minted grant verifies once, then is consumed", () => {
  const store = new GrantStore();
  const g = store.mint("rollback", "payments-api", 60, 1000);
  assert.equal(store.verifyAndConsume(g.token, "rollback", "payments-api", 2000).valid, true);
  const second = store.verifyAndConsume(g.token, "rollback", "payments-api", 3000);
  assert.equal(second.valid, false);
  assert.match(second.reason ?? "", /already used/);
});

test("expired grant is rejected", () => {
  const store = new GrantStore();
  const g = store.mint("rollback", "payments-api", 60, 1000);
  const r = store.verifyAndConsume(g.token, "rollback", "payments-api", 1000 + 61_000);
  assert.equal(r.valid, false);
  assert.match(r.reason ?? "", /expired/);
});

test("grant is scoped to exactly one action + service", () => {
  const store = new GrantStore();
  const g = store.mint("rollback", "payments-api", 60, 1000);
  assert.equal(store.verifyAndConsume(g.token, "restart", "payments-api", 2000).valid, false);
  assert.equal(store.verifyAndConsume(g.token, "rollback", "other-svc", 2000).valid, false);
});

test("unknown token is rejected", () => {
  assert.equal(new GrantStore().verifyAndConsume("nope", "rollback", "payments-api", 1).valid, false);
});
