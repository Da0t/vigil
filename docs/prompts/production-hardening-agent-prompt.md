# Production-Hardening Agent Prompt — Vigil

> Give this entire document to a capable coding agent (Claude Code, Cursor, etc.).
> It is self-contained. The agent should execute it end to end, phase by phase,
> committing after each task, and must not claim completion without running the
> verification in each phase.

---

## Your mission

You are a senior platform/security engineer. Take **Vigil** — a working demo of
an autonomous incident-remediation agent — from "demo that works" to
"production-ready in a state-of-the-art manner." Fix the real gaps below with
correct, idiomatic, well-tested code. Do NOT do a shallow pass; do the real
engineering (authentication, persistence, observability, tests, CI,
containerization) to a standard you'd defend in a production review.

Work autonomously. Do not stop to ask permission for reversible, in-scope work.
Only stop if you hit a genuinely ambiguous product decision or a destructive
action. Keep going until every phase's acceptance criteria pass.

## What Vigil is (context — read the code, don't trust this summary blindly)

Vigil is an AI on-call engineer that diagnoses and fixes production incidents
**while holding zero standing production credentials**. Every destructive action
(rollback/restart) must go through a just-in-time, single-use, scoped grant
issued by a policy **gate** (fronted by Pomerium). The whole product thesis is
"the agent can never touch prod directly; it must earn one tiny, single-use
permission at a time." **Security is the product**, so the security fixes below
are the highest priority.

Architecture (all local Node/Express + a Next.js frontend):

```
browser ─► Next.js web (:3000) ─SSE─► vigil-agent (:4000) ─► payments-api (:4100)  [mock prod]
                                          ├─► Zero.xyz CLI        (per-call log-parse capability)
                                          ├─► Akash worker (:4400/deployed)  POST /diagnose
                                          └─► gate (:4200) ─► single-use grant token
                                                 ▲ payments-api re-verifies the token here
                                      destructive calls route via Pomerium (:4300)
```

Repo layout:
- `src/**` — Next.js frontend. `src/lib/contract.ts` is the shared wire contract
  (`LoopState`, `GrantRequest/Response`, `VerifyRequest/Response`,
  `DiagnoseRequest/Response`, `ParsedLogs`, `PORTS`). **This contract is load-
  bearing across every service — change it only deliberately and update all
  consumers in the same commit.**
- `services/payments-api/**` — mock prod: real 500s after a bad deploy;
  destructive routes `/rollback` `/restart` (grant-checked), `/admin/break|reset`.
- `services/vigil-agent/**` — the orchestrator: traffic loop, SSE server,
  incident state machine, integration clients, Zero/OpenAI/Akash calls.
- `services/gate/**` — policy engine + single-use grant store + HTTP service.
- `services/diagnostic-worker/**` — the Akash-deployed diagnostic worker.
- `pomerium/**` — Pomerium proxy config.
- `docs/**`, `README.md`, `scripts/dev-all.sh`, `.env.example`.

Run it: `cp .env.example .env`, `./scripts/dev-all.sh`, open
`http://localhost:3000/incidents/inc-4821`, press Play. Verify the full loop:
error rate climbs → Zero parses → Akash verifies → gate grants a single-use
rollback → error rate recovers → an escalation (mass-restart) is denied.

## GOLDEN RULES (do not violate)

1. **The demo must still work at every step.** Vigil uses an env-switched
   design: unset env var ⇒ local fallback (so the demo runs with no external
   deps); set env var ⇒ real service. Preserve this. Your production hardening
   must be gated on `NODE_ENV === 'production'` (or an explicit `VIGIL_ENV`), so
   that **development keeps the convenient fallbacks** but **production
   fails closed and authenticates**. Never make dev require secrets it didn't
   before.
2. **Never break the `LoopState` SSE contract** the frontend consumes, or the
   `contract.ts` types, without updating every consumer in the same commit.
3. **Fail closed in production, fail convenient in dev** — this is the core
   pattern for every security fix.
4. **Evidence before "done."** After each phase, run the stated verification and
   paste the real output. Do not assert something passes without running it.
5. **Keep commits small and scoped**, one per task, with a clear message.
6. **Don't rewrite what's already correct** (see "Do not touch" below).

## What is already correct — DO NOT rewrite

- **Grant token minting**: `services/gate/src/grants.ts` uses
  `randomBytes(18)` (144-bit CSPRNG), binds tokens to action+service, enforces
  TTL, and truly consumes on verify — atomically within a process. Keep this
  logic; only extend it to a shared/persisted store (Phase 2).
- **The Zero CLI shell-out** (`services/vigil-agent/src/integrations/zero-live.ts`)
  uses `execFile` with an args array — injection-safe. Leave the invocation
  pattern.
- The env-switched fallback design itself. Harden it; don't delete it.

---

# THE WORK — execute in phases, in order

Each phase lists concrete tasks with the exact location and the fix. Use TDD
where a unit boundary exists (gate policy, grant store, validation, parsing).
After each phase, run its **Acceptance** checks.

## Phase 0 — Setup & baseline

- Create branch `production-hardening` off the current branch.
- Run the demo end-to-end once and confirm it works (baseline). Note the current
  green path so you can prove you didn't regress it.
- Add a single source of truth for environment: create
  `services/shared/env.ts` (or per-service `env.ts`) that reads and **validates**
  required env with `zod`, exposes typed config, and exposes
  `isProd = process.env.NODE_ENV === 'production'`. Fail fast (throw at boot) in
  prod if a required var is missing.

**Acceptance:** demo still runs; `tsc --noEmit` clean; each service boots and
logs its resolved, validated config.

## Phase 1 — Security core (highest priority — this is the product)

1. **Fail-closed gate check.** `services/payments-api/src/index.ts` currently
   returns `{ok:true}` (allow) when `GATE_URL` is unset (search for
   "allowed ungated"). In prod this must **reject** all destructive
   `/rollback` `/restart` calls if `GATE_URL` is unset or the gate is
   unreachable. Keep the ungated path **only** when `!isProd`.
2. **Authenticate every service-to-service call.** Today the gate, worker,
   payments-api, and agent trust any caller. Add mutual authentication between
   internal services: a signed request (HMAC over method+path+body+timestamp
   with a shared secret from env, with a short clock-skew window) or mTLS.
   Minimum bar: the gate must reject `POST /grants` and `POST /grants/verify`
   from an unauthenticated caller in prod. Apply the same to the worker's
   `/diagnose` and payments-api's destructive + admin routes.
3. **Gate must not trust self-reported policy evidence.** In
   `services/gate/src/server.ts` / `policy.ts`, the decision is made from
   body-supplied `sandboxPassed`, `servicesAffected`, `budgetUsed`,
   `consecutiveFailures`, `requestedBy`. Replace trust with verification:
   - `requestedBy` must come from the authenticated caller identity (from #2),
     not the request body.
   - `sandboxPassed` must be proven, not asserted: have the gate verify a signed
     attestation from the diagnostic worker (worker signs its
     `DiagnoseResponse`; agent forwards the signature; gate checks it), OR have
     the gate call the worker/an evidence store itself. Do not grant a
     destructive action on an unauthenticated boolean.
4. **Stop leaking token strings.** `GET /grants`
   (`services/gate/src/server.ts`) returns full grant objects including live,
   unconsumed `token`s. Redact `token` to a short prefix in any list/receipt
   view, and require auth on the endpoint.
5. **Behavior-reactive throttle must be keyed on authenticated identity**
   (from #2), reset on success, and expire on a time window — today it's keyed
   on the spoofable `requestedBy` string and never resets (permanent self-lock).
6. **Lock down admin/demo routes.** `payments-api` `/admin/break` `/admin/reset`
   and `vigil-agent` `/demo/start|thrash|reset` are unauthenticated. In prod,
   require auth or compile them out entirely (a `if (!isProd)` guard or a
   separate dev-only router).
7. **TLS for prod.** Configure TLS on every hop (or document a service-mesh/
   ingress assumption). Grant tokens must never travel cleartext in prod;
   `pomerium/config.yaml` `insecure_server: true` and
   `allow_public_unauthenticated_access` are dev-only — provide a prod Pomerium
   config that enforces TLS and a real policy requiring the grant.
8. **Network isolation.** Ensure payments-api's destructive routes are only
   reachable *through* Pomerium in prod (not published to the host). Update
   compose/networking so `POMERIUM_URL` is the only path; the direct
   `POMERIUM_URL ?? PAYMENTS_URL` fallback in `clients.ts` stays dev-only.
9. **Secrets.** Remove any real key from `.env` on disk (rotate the OpenAI key
   noted in the file). Document a secret-manager approach for prod (env injected
   at runtime, never committed, never in the image). Confirm `.dockerignore`
   excludes `.env`.

**Acceptance:** Add integration tests proving, in prod mode: (a) a destructive
call with no/invalid grant is rejected; (b) an unauthenticated `POST /grants` is
rejected; (c) a grant is not issued on an unattested `sandboxPassed`; (d)
`GET /grants` never returns a full token; (e) a token works exactly once. Demo
(dev mode) still runs unchanged.

## Phase 2 — Reliability & correctness

1. **Guard and time-bound every network call.** Wrap all `fetch`/downstream
   calls (`payments-api` gate verify; `vigil-agent` orchestrator + clients;
   traffic loop; OpenAI in `hypothesis.ts`) in try/catch with
   `AbortSignal.timeout(...)`, and check `r.ok` before `r.json()`. On failure,
   fail closed for security-relevant paths; degrade gracefully for others.
2. **Global safety nets.** Add `process.on('unhandledRejection')` and
   `process.on('uncaughtException')` handlers (log + controlled shutdown) to
   every service entrypoint. Note: Express 4 does not catch async-handler
   rejections — either wrap every async route in an error-forwarding helper or
   upgrade to Express 5.
3. **Persist + share the grant store.** Move the gate's `grants`, denial
   counters, and decision log out of in-process `Map`s into a shared store
   (Redis or Postgres). Make `verifyAndConsume` an **atomic** compare-and-set
   (Redis `SET NX` / Lua, or a DB conditional update) so single-use holds across
   replicas and survives restarts. Add TTL/eviction so the store doesn't grow
   unbounded. This is what makes the security guarantee real at scale.
4. **Bound all growth.** Cap/rotate the gate `decisions[]` log; sweep
   consumed/expired grants. Confirm payments-api/traffic buffers stay capped.
5. **Fix the incident-loop races.** The `running` flag only guards
   `startIncident` re-entry. Make `/demo/reset` and `/demo/thrash` abort the
   running loop (via an `AbortController`/token) before mutating state, so reset
   can't interleave with a live loop and thrash can't double-fire.
6. **Honor timeouts in the state machine.** `until(...)` return values are
   discarded in the DETECT and RECOVERY waits — the loop emits "incident
   resolved" even if recovery never happened. Branch on the result; emit a
   failed/timed-out terminal state and reflect it in `LoopState`.
7. **Fix the traffic loop.** It fires overlapping un-awaited, un-timed fetches;
   add an in-flight guard (skip tick if prior pending) and a per-request abort
   timeout so error-rate can't read stale-zero during an outage.
8. **Graceful shutdown.** SIGTERM/SIGINT handler in each service: stop intervals,
   `server.close()`, end open SSE responses, close the store connection, then
   exit.

**Acceptance:** Kill/restart the gate mid-incident and show the system behaves
correctly (grant survives / clean failure, not a crash). Show a downstream
outage produces a clean fail-closed response, not a hung request or a process
exit. Two gate replicas + one token ⇒ exactly one successful spend (add a test).

## Phase 3 — Deployability

1. **Dockerfile for every service.** `docker-compose.yml` references build
   contexts for payments-api/gate/vigil-agent that have no Dockerfile; add them
   (mirror `services/diagnostic-worker/Dockerfile`), and add the worker to
   compose. `docker compose up` must build and run the whole system.
2. **Fix the runtime toolchain.** `tsx` runs the TS in prod but is a
   `devDependency` in three services, so `npm ci --omit=dev` breaks them. Either
   move `tsx` to `dependencies` **or** add a real `tsc` build step and run
   compiled JS in prod (preferred for prod). Pick one and apply consistently.
3. **Compose hardening.** Add `healthcheck`, `restart: unless-stopped`,
   `deploy.resources` limits, and `depends_on: {condition: service_healthy}` to
   every service. Add a `/health` endpoint to **vigil-agent** (it's missing one).
4. **Parameterize the frontend agent URL.** `NEXT_PUBLIC_AGENT_URL` is baked to
   `localhost:4000`, so live mode only works on the demo box (the browser opens
   the SSE stream). For hosted deploys, make it a build/runtime arg pointing at
   the public agent origin, or proxy `/events` through the Next.js origin.
5. **Reproducible images.** Digest-pin the Akash worker image in `deploy.yaml`
   (not `:latest`), and treat the lease URL as runtime config, not a committed
   constant. Pin Node versions (`engines` + `.nvmrc`); align base images
   (worker `node:20` vs web `node:24`) and TypeScript versions.
6. **Slim images.** Use Next.js `output: "standalone"` and multi-stage prune so
   the runtime image doesn't ship devDependencies.

**Acceptance:** `docker compose up --build` brings up all services healthy;
`curl` each `/health`; run the full incident loop against the composed stack.

## Phase 4 — Observability

1. Replace ad-hoc `console.log` with a **structured logger** (pino) emitting
   JSON with levels, service name, and a **request/correlation ID** propagated
   across the agent→gate→payments-api call chain (and into the audit log).
2. Add **metrics** (Prometheus `/metrics` via `prom-client`): incident count,
   grant issue/deny/consume counts, gate decision latency, downstream error
   rates, active SSE clients.
3. Add **tracing** (OpenTelemetry) spans across the incident loop and the
   service-to-service calls.
4. Add **error reporting** hook (Sentry-compatible) behind env config.
5. Cap SSE listeners and honor backpressure (respect `res.write` return / drop
   slow clients); throttle or diff the `LoopState` payload instead of full-state
   at 4/s.

**Acceptance:** show a correlated log trace for one incident across all services
sharing one request ID; `/metrics` returns the counters; a slow SSE client
doesn't balloon memory.

## Phase 5 — Input validation

Validate every request body and query at the boundary with `zod` (gate
`/grants` + `/grants/verify`, worker `/diagnose`, payments-api routes, agent
demo routes). Reject malformed input with `400` instead of letting `undefined`
flow into policy logic. Add tests for rejection paths.

**Acceptance:** malformed bodies get `400` with a helpful error; tests cover it.

## Phase 6 — Frontend robustness

In `src/lib/use-incident-live.ts` and
`src/components/incident/incident-hero.tsx`:
1. Surface distinct **connecting / live / reconnecting / lost** UI states — today
   anything that isn't `live` renders as "SIM," and a dropped stream silently
   snaps the UI back to the scripted sim's default state.
2. On stream drop, **retain the last live snapshot** and show a reconnect
   indicator instead of reverting to sim; implement explicit reconnect with
   backoff.
3. Guard `JSON.parse(e.data)` in a try/catch.
4. Surface control-POST failures (start/thrash/reset) to the user instead of
   swallowing them; disable buttons when the backend is unreachable.

**Acceptance:** stop the agent while the page is open and show a clear
"disconnected/reconnecting" state (not a silent flip to SIM); restart it and
show automatic recovery.

## Phase 7 — Testing & CI

1. **Unit** tests for policy, grant store (incl. atomic/concurrent consume),
   validation schemas, the fallback parser, and the Zero/OpenAI response mappers.
2. **Integration** tests for the full gate↔agent↔payments-api grant lifecycle
   (issue → single use → deny paths → fail-closed).
3. **E2E** (Playwright) for the incident page: press Play, assert the loop
   reaches resolved and the thrash is denied.
4. **CI**: a GitHub Actions workflow running `tsc`, lint, all unit+integration
   suites, and `docker compose build` on every PR. Add a real ESLint config
   (the `next lint` script has none) and make it pass.

**Acceptance:** CI is green on a fresh clone; coverage covers the security core.

## Phase 8 — Docs & consistency

1. Reconcile the **LLM provider mismatch**: stale docs and compose env used to
   name a different provider, but the code (`services/vigil-agent/src/hypothesis.ts`)
   calls OpenAI (`gpt-4o-mini`, `OPENAI_API_KEY`). Make code and docs agree
   and remove the dead env var.
2. Update `README.md` to a production operations guide: real run instructions,
   the prod vs dev env matrix, the security model (auth, single-use grants,
   network isolation), and an honest "what's real vs simulated" section.
3. Update `.env.example` to list every var each phase introduced, grouped, with
   which are required in prod.

**Acceptance:** a new engineer can clone, read the README, and run both the dev
demo and a hardened prod-mode stack without tribal knowledge.

---

## Final definition of done

- All phase acceptance checks pass with pasted evidence.
- `docker compose up --build` yields a healthy, hardened stack; the full incident
  loop works against it; the demo (dev mode) also still works unchanged.
- The security core is real: no fail-open path in prod, service-to-service auth,
  gate verifies evidence, tokens never leaked, single-use enforced across
  replicas/restarts.
- CI is green; tests cover the security-critical logic.
- No secret committed or baked into an image.
- Provide a short `PRODUCTION.md` summarizing what changed, the prod env matrix,
  the threat model addressed, and any known remaining limitations (be honest).

Work through it phase by phase. Commit per task. Prove each phase before moving
on. Do not stop until the definition of done is met.
