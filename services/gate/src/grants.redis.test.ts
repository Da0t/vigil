import test from "node:test";
import assert from "node:assert/strict";
import { RedisGrantStore } from "./grants";

const url = process.env.REDIS_URL;
const skip = url ? false : "REDIS_URL not set — start redis and export REDIS_URL to run";

test("two gate replicas sharing one Redis spend a token exactly once", { skip }, async () => {
  const a = new RedisGrantStore(url!);
  const b = new RedisGrantStore(url!);
  try {
    const g = await a.mint("rollback", "payments-api", 60);
    // 30 parallel consumes split across BOTH replica instances.
    const attempts = [
      ...Array.from({ length: 15 }, () => a.verifyAndConsume(g.token, "rollback", "payments-api")),
      ...Array.from({ length: 15 }, () => b.verifyAndConsume(g.token, "rollback", "payments-api")),
    ];
    const results = await Promise.all(attempts);
    assert.equal(results.filter((r) => r.valid).length, 1, "exactly one consume across replicas must win");
  } finally {
    await a.close();
    await b.close();
  }
});

test("a grant survives a store 'restart' (new instance, same Redis)", { skip }, async () => {
  const a = new RedisGrantStore(url!);
  let token: string;
  try {
    token = (await a.mint("rollback", "payments-api", 60)).token;
  } finally {
    await a.close();
  }
  const b = new RedisGrantStore(url!); // simulate a fresh replica after restart
  try {
    assert.equal((await b.verifyAndConsume(token, "rollback", "payments-api")).valid, true);
    assert.equal((await b.verifyAndConsume(token, "rollback", "payments-api")).valid, false);
  } finally {
    await b.close();
  }
});

test("logical expiry reports 'expired' independent of Redis key TTL", { skip }, async () => {
  const a = new RedisGrantStore(url!);
  try {
    const now = Date.now();
    const g = await a.mint("rollback", "payments-api", 1, now);
    const r = await a.verifyAndConsume(g.token, "rollback", "payments-api", now + 2000);
    assert.equal(r.valid, false);
    assert.match(r.reason ?? "", /expired/);
  } finally {
    await a.close();
  }
});
