import test from "node:test";
import assert from "node:assert/strict";
import { DenialThrottle } from "./throttle";

const WINDOW = 60_000;

test("an unseen key has zero observed failures", () => {
  const t = new DenialThrottle(WINDOW);
  assert.equal(t.observed("vigil-agent:rollback", 1000), 0);
});

test("recorded denials accumulate", () => {
  const t = new DenialThrottle(WINDOW);
  t.recordDenial("vigil-agent:rollback", 1000);
  t.recordDenial("vigil-agent:rollback", 1200);
  assert.equal(t.observed("vigil-agent:rollback", 1300), 2);
});

test("a successful grant resets the counter for that key", () => {
  const t = new DenialThrottle(WINDOW);
  t.recordDenial("vigil-agent:rollback", 1000);
  t.recordDenial("vigil-agent:rollback", 1200);
  t.reset("vigil-agent:rollback");
  assert.equal(t.observed("vigil-agent:rollback", 1300), 0);
});

test("counters expire after the time window (no permanent self-lock)", () => {
  const t = new DenialThrottle(WINDOW);
  t.recordDenial("vigil-agent:rollback", 1000);
  assert.equal(t.observed("vigil-agent:rollback", 1000 + WINDOW + 1), 0);
});

test("a denial after the window restarts the count at 1, not stale+1", () => {
  const t = new DenialThrottle(WINDOW);
  t.recordDenial("vigil-agent:rollback", 1000);
  t.recordDenial("vigil-agent:rollback", 1000 + WINDOW + 1);
  assert.equal(t.observed("vigil-agent:rollback", 1000 + WINDOW + 2), 1);
});

test("counters are isolated per key (identity + action)", () => {
  const t = new DenialThrottle(WINDOW);
  t.recordDenial("vigil-agent:rollback", 1000);
  assert.equal(t.observed("vigil-agent:restart", 1000), 0);
  assert.equal(t.observed("other-caller:rollback", 1000), 0);
});
