# Person B — The Gate: policy, single-use grants, Pomerium (branch `person-b-gate`)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans if
> available; otherwise execute top-to-bottom, one todo per task. Commit after
> every task. You own `services/gate/**` and `pomerium/**` ONLY. Do not touch
> `services/vigil-agent`, `services/payments-api`, or frontend `src/**`.

**Goal:** The technical heart of the demo. A gate service that evaluates policy
(`GrantRequest → GrantResponse` from `src/lib/contract.ts`), mints single-use
60s-TTL tokens, verifies-and-consumes them, and records every decision. Plus
Pomerium as the proxy every destructive prod call must transit.

**This is the most protected feature in the whole project** (degradation
priority #1 in the master plan). The gate service with real single-use grants
must work; Pomerium routing layers on top.

**Read first:** `src/lib/contract.ts` — `GrantRequest`, `GrantResponse`,
`VerifyRequest`, `VerifyResponse`, `PORTS`. Your callers:
- vigil-agent POSTs `GrantRequest` to `/grants`, expects `GrantResponse`.
- payments-api POSTs `VerifyRequest` to `/grants/verify` on every destructive
  call, expects `VerifyResponse`. Verification CONSUMES the grant (single-use).

**Policy thresholds (must match the sim's story):** blast radius ≤ 3 services,
budget ≤ $5, destructive actions need `sandboxPassed=true`, deny after ≥ 2
consecutive failures. Rule order matters — blast radius first, so the thrash
denial reads "blast radius over limit".

---

### Task B1: policy engine (pure function + tests)

**Files:**
- Create: `services/gate/package.json`
- Create: `services/gate/src/policy.ts`
- Create: `services/gate/src/policy.test.ts`

- [ ] **Step 1: scaffold**

```bash
mkdir -p services/gate/src && cd services/gate
npm init -y && npm i express@4 cors && npm i -D tsx @types/express @types/cors typescript
```

- [ ] **Step 2: failing tests `src/policy.test.ts`** (complete file):

```ts
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
```

Run: `npx tsx src/policy.test.ts` — expect FAIL ("Cannot find module './policy'").

- [ ] **Step 3: implement `src/policy.ts`** (complete file):

```ts
import type { GrantRequest, GrantResponse } from "../../../src/lib/contract";

export interface PolicyContext {
  blastThreshold: number;
  budgetMax: number;
  maxConsecutiveFailures: number;
  /** Failures/denials the gate itself has recorded for this requester+action. */
  observedFailures: number;
}

export const DEFAULT_CONTEXT: PolicyContext = {
  blastThreshold: 3,
  budgetMax: 5,
  maxConsecutiveFailures: 2,
  observedFailures: 0,
};

export function evaluatePolicy(
  req: GrantRequest,
  ctx: PolicyContext
): Pick<GrantResponse, "verdict" | "scope" | "reason"> {
  const failures = Math.max(req.consecutiveFailures, ctx.observedFailures);
  if (req.servicesAffected > ctx.blastThreshold) {
    return { verdict: "denied", scope: `requested: ${req.servicesAffected} services`, reason: "blast radius over limit" };
  }
  if (!req.sandboxPassed) {
    return { verdict: "denied", scope: `requested: ${req.service}`, reason: "no sandbox evidence for a destructive action" };
  }
  if (req.budgetUsed > ctx.budgetMax) {
    return { verdict: "denied", scope: `requested: ${req.service}`, reason: "incident budget exhausted" };
  }
  if (failures >= ctx.maxConsecutiveFailures) {
    return { verdict: "denied", scope: `requested: ${req.service}`, reason: "policy tightened after repeat failure" };
  }
  return { verdict: "allowed", scope: `${req.service} only` };
}
```

- [ ] **Step 4:** `npx tsx src/policy.test.ts` — all 5 tests PASS.
- [ ] **Step 5: commit** — `git add services/gate && git commit -m "feat: gate policy engine with tests"`

---

### Task B2: single-use grant store (+ tests)

**Files:**
- Create: `services/gate/src/grants.ts`
- Create: `services/gate/src/grants.test.ts`

- [ ] **Step 1: failing tests `src/grants.test.ts`**:

```ts
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
```

Run: `npx tsx src/grants.test.ts` — expect FAIL.

- [ ] **Step 2: implement `src/grants.ts`**:

```ts
import { randomBytes } from "node:crypto";

export interface Grant {
  token: string;
  action: string;
  service: string;
  mintedAt: number;
  expiresAt: number;
  consumed: boolean;
  consumedAt?: number;
}

export class GrantStore {
  private grants = new Map<string, Grant>();

  mint(action: string, service: string, ttlSeconds = 60, now = Date.now()): Grant {
    const g: Grant = {
      token: `vg_${randomBytes(18).toString("base64url")}`,
      action, service, mintedAt: now,
      expiresAt: now + ttlSeconds * 1000,
      consumed: false,
    };
    this.grants.set(g.token, g);
    return g;
  }

  verifyAndConsume(token: string, action: string, service: string, now = Date.now()): { valid: boolean; reason?: string } {
    const g = this.grants.get(token);
    if (!g) return { valid: false, reason: "unknown grant" };
    if (g.consumed) return { valid: false, reason: "grant already used" };
    if (now > g.expiresAt) return { valid: false, reason: "grant expired" };
    if (g.action !== action || g.service !== service) return { valid: false, reason: "grant scope mismatch" };
    g.consumed = true;
    g.consumedAt = now;
    return { valid: true };
  }

  list(): Grant[] { return [...this.grants.values()]; }

  /** Count of live, unconsumed grants — should be 0 at rest. */
  standing(now = Date.now()): number {
    return this.list().filter((g) => !g.consumed && now <= g.expiresAt).length;
  }
}
```

- [ ] **Step 3:** `npx tsx src/grants.test.ts` — all 4 PASS.
- [ ] **Step 4: commit** — `git commit -m "feat: single-use TTL grant store with tests"`

---

### Task B3: gate HTTP service

**Files:**
- Create: `services/gate/src/server.ts`

**Produces:** `:4200` — `POST /grants`, `POST /grants/verify`, `GET /grants`
(decision audit), `GET /health`.

- [ ] **Step 1: implement `src/server.ts`** (complete file):

```ts
import express from "express";
import cors from "cors";
import type { GrantRequest, GrantResponse, VerifyRequest } from "../../../src/lib/contract";
import { DEFAULT_CONTEXT, evaluatePolicy } from "./policy";
import { GrantStore } from "./grants";

const PORT = Number(process.env.PORT ?? 4200);
const TTL_SECONDS = 60;

const store = new GrantStore();
/** Gate-observed denial counts per requester+action (behavior-reactive policy). */
const denials = new Map<string, number>();
/** Full decision log for GET /grants — the receipts. */
const decisions: object[] = [];

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => { res.json({ ok: true, standingGrants: store.standing() }); });

app.post("/grants", (req, res) => {
  const gr = req.body as GrantRequest;
  const key = `${gr.requestedBy}:${gr.action}`;
  const result = evaluatePolicy(gr, { ...DEFAULT_CONTEXT, observedFailures: denials.get(key) ?? 0 });

  let response: GrantResponse;
  if (result.verdict === "allowed") {
    const g = store.mint(gr.action, gr.service, TTL_SECONDS);
    response = { ...result, token: g.token, ttlSeconds: TTL_SECONDS, singleUse: true };
  } else {
    denials.set(key, (denials.get(key) ?? 0) + 1);
    response = result;
  }
  decisions.push({ at: new Date().toISOString(), request: gr, verdict: response.verdict, scope: response.scope, reason: response.reason });
  console.log(`[gate] ${response.verdict.toUpperCase()} ${gr.action} ${gr.service} (${response.reason ?? response.scope})`);
  res.json(response);
});

app.post("/grants/verify", (req, res) => {
  const { token, action, service } = req.body as VerifyRequest;
  const v = store.verifyAndConsume(token, action, service);
  console.log(`[gate] verify ${action} ${service}: ${v.valid ? "OK (consumed)" : `REJECTED (${v.reason})`}`);
  res.json(v);
});

app.get("/grants", (_req, res) => {
  res.json({ standingGrants: store.standing(), grants: store.list(), decisions });
});

app.listen(PORT, () => console.log(`[gate] :${PORT}`));
```

- [ ] **Step 2: verify the full grant lifecycle by hand**

```bash
cd services/gate && npx tsx src/server.ts &
# allow:
curl -s -X POST localhost:4200/grants -H 'content-type: application/json' -d '{"action":"rollback","service":"payments-api","servicesAffected":1,"sandboxPassed":true,"budgetUsed":0.1,"consecutiveFailures":0,"requestedBy":"vigil-agent"}'
# → {"verdict":"allowed","scope":"payments-api only","token":"vg_...","ttlSeconds":60,"singleUse":true}
# verify once (use the token from above):
curl -s -X POST localhost:4200/grants/verify -H 'content-type: application/json' -d '{"token":"vg_PASTE","action":"rollback","service":"payments-api"}'
# → {"valid":true}
# verify twice — single use:
curl -s -X POST localhost:4200/grants/verify -H 'content-type: application/json' -d '{"token":"vg_PASTE","action":"rollback","service":"payments-api"}'
# → {"valid":false,"reason":"grant already used"}
# thrash denial:
curl -s -X POST localhost:4200/grants -H 'content-type: application/json' -d '{"action":"mass-restart","service":"all-services","servicesAffected":12,"sandboxPassed":false,"budgetUsed":0.1,"consecutiveFailures":2,"requestedBy":"vigil-agent"}'
# → {"verdict":"denied","scope":"requested: 12 services","reason":"blast radius over limit"}
curl -s localhost:4200/grants | python3 -m json.tool | head -20   # decisions recorded
kill %1
```

- [ ] **Step 3: commit** — `git commit -m "feat: gate service — policy, single-use grants, decision log"`

---

### Task B4: Pomerium in front of the destructive routes

**Files:**
- Create: `pomerium/config.yaml`
- Create: `pomerium/README.md` (exact run command + what was verified)

**Intent:** every `POST /rollback|/restart` from the agent transits Pomerium
(`:4300` → payments-api `:4100`). Enforcement is layered: Pomerium restricts
which routes/paths are reachable at all, and payments-api verifies the
single-use grant with the gate on every call. Even if Pomerium policy ends up
permissive for the demo, the destructive path is still hard-gated.

- [ ] **Step 1: verify current Pomerium config syntax against the docs.**
  Fetch https://www.pomerium.com/docs (routes + policy for Pomerium Core,
  docker quickstart). The config below is the starting point — correct it to
  current syntax rather than trusting it blindly. Sponsor booth can help.

- [ ] **Step 2: `pomerium/config.yaml`** (starting point — adjust per docs):

```yaml
# Pomerium Core, all-in-one, demo mode.
# Vigil's destructive path: agent → :4300 (Pomerium) → payments-api :4100
address: :4300
insecure_server: true          # local demo only — no TLS
authenticate_service_url: https://authenticate.pomerium.app

routes:
  # ONLY the two destructive endpoints are routed. Nothing else in prod
  # is reachable through the gate at all.
  - from: http://localhost:4300
    to: http://host.docker.internal:4100
    prefix: /rollback
    allow_public_unauthenticated_access: true   # see layering note in README
    pass_identity_headers: true
  - from: http://localhost:4300
    to: http://host.docker.internal:4100
    prefix: /restart
    allow_public_unauthenticated_access: true
    pass_identity_headers: true
```

- [ ] **Step 3: run + verify**

```bash
docker run --rm -p 4300:4300 \
  -v "$PWD/pomerium/config.yaml:/pomerium/config.yaml" \
  pomerium/pomerium:latest
# other terminal — payments-api running from main? If not merged yet, verify routing with any local :4100 stub:
python3 -m http.server 4100 &   # temporary target just to prove proxying
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4300/rollback   # non-502 = routed
curl -s -o /dev/null -w '%{http_code}\n' localhost:4300/logs               # 404 — path NOT routed (the point)
```

- [ ] **Step 4 (stretch, only if Steps 1–3 done): tighten policy.** Try a real
  Pomerium policy on the route (e.g. JWT/claims or an authorize step per current
  docs) so Pomerium itself rejects requests without a grant header, e.g. a
  policy that requires the `x-vigil-grant` header to be present. Screenshot a
  Pomerium denial for the README. If the syntax fights you for more than 30
  minutes, keep the layered model and move on — the grant enforcement is
  already real at the service.

- [ ] **Step 5: `pomerium/README.md`** — write down: exact docker command, which
  Pomerium version, what you verified (routed paths, blocked paths, any policy),
  and the layering statement above. Person D copies this into the main README.

- [ ] **Step 6: commit** — `git commit -m "feat: pomerium route restricting prod to two gated destructive paths"`

---

**Definition of done:** `npx tsx src/policy.test.ts` and `npx tsx src/grants.test.ts`
pass; the B3 curl lifecycle works; Pomerium routes `/rollback` and 404s
everything else. Push the branch. Post "B done" in team chat.
