import test from "node:test";
import assert from "node:assert/strict";
import { MemoryGrantStore } from "./grants";

test("minted grant verifies once, then is consumed", async () => {
  const store = new MemoryGrantStore();
  const g = await store.mint("rollback", "payments-api", 60, 1000);
  assert.equal((await store.verifyAndConsume(g.token, "rollback", "payments-api", 2000)).valid, true);
  const second = await store.verifyAndConsume(g.token, "rollback", "payments-api", 3000);
  assert.equal(second.valid, false);
  assert.match(second.reason ?? "", /already used/);
});

test("expired grant is rejected", async () => {
  const store = new MemoryGrantStore();
  const g = await store.mint("rollback", "payments-api", 60, 1000);
  const r = await store.verifyAndConsume(g.token, "rollback", "payments-api", 1000 + 61_000);
  assert.equal(r.valid, false);
  assert.match(r.reason ?? "", /expired/);
});

test("grant is scoped to exactly one action + service", async () => {
  const store = new MemoryGrantStore();
  const g = await store.mint("rollback", "payments-api", 60, 1000);
  assert.equal((await store.verifyAndConsume(g.token, "restart", "payments-api", 2000)).valid, false);
  assert.equal((await store.verifyAndConsume(g.token, "rollback", "other-svc", 2000)).valid, false);
});

test("unknown token is rejected", async () => {
  assert.equal((await new MemoryGrantStore().verifyAndConsume("nope", "rollback", "payments-api", 1)).valid, false);
});

test("concurrent consume of one token yields exactly one winner", async () => {
  const store = new MemoryGrantStore();
  const g = await store.mint("rollback", "payments-api", 60, 1000);
  const results = await Promise.all(
    Array.from({ length: 25 }, () => store.verifyAndConsume(g.token, "rollback", "payments-api", 2000)),
  );
  assert.equal(results.filter((r) => r.valid).length, 1, "exactly one consume must win");
});

test("expired grants are swept so the store does not grow unbounded", async () => {
  const store = new MemoryGrantStore();
  await store.mint("rollback", "payments-api", 60, 1000);
  await store.mint("rollback", "payments-api", 60, 1000);
  store.sweep(1000 + 61_000);
  assert.equal((await store.list()).length, 0);
});
