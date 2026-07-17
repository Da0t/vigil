import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseLogsFallback } from "./parse-fallback";

test("parses the .vlog fixture to the dominant error signature", () => {
  const raw = readFileSync(new URL("../../../shared/fixtures/payments.vlog", import.meta.url), "utf8");
  const p = parseLogsFallback(raw);
  assert.equal(p.errorSignature, "ERR_TIMEOUT_CFG");
  assert.equal(p.suspectComponent, "stripe_adapter");
  assert.equal(p.suspectDeploy, "#4821");
  assert.equal(p.parserSource, "fallback");
  assert.ok(p.sampleLines.length >= 1);
});
