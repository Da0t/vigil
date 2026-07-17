# Vigil — Production Hardening

This document summarizes the production-hardening work, the dev vs prod
environment matrix, the threat model addressed, and the honest remaining
limitations.

Vigil's thesis: **an AI on-call engineer that holds zero standing production
credentials**. Every destructive action must earn a just-in-time, single-use,
scoped grant from a policy gate. **Security is the product**, so the security
work is the highest-priority part of this hardening.

## Core pattern: fail closed in prod, fail convenient in dev

Everything is gated on `VIGIL_ENV` (falls back to `NODE_ENV`). Anything other
than `production` is development.

- **Dev**: unset vars fall back to local defaults; service auth and attestation
  are disabled; the grant store is in-memory. The demo runs with **zero secrets**.
- **Prod**: required vars are validated at boot (the service refuses to start if
  any is missing — see `services/shared/env.ts`), auth + attestation are
  enforced, and the grant store is Redis-backed.

## What changed, by area

| Area | Before | After |
|---|---|---|
| Env config | ad-hoc `process.env` reads | zod-validated, typed, fail-fast (`services/shared/env.ts` + per-service `env.ts`) |
| Gate check (payments) | `{ok:true}` when `GATE_URL` unset (fail **open**) | fail **closed** in prod; guarded fetch (timeout, `r.ok`); ungated path dev-only |
| Service-to-service auth | any caller trusted | HMAC-SHA256 over method+path+caller+timestamp+body-hash, ±30s skew; enforced in prod |
| Policy evidence | trusts body `sandboxPassed` + `requestedBy` | `requestedBy` = authenticated caller; `sandboxPassed` requires a **worker-signed attestation** the gate verifies (agent can't forge it) |
| Token leakage | `GET /grants` returned live tokens | tokens redacted to an unusable prefix; endpoint requires auth |
| Throttle | keyed on spoofable string, never reset (permanent self-lock) | keyed on authenticated identity, resets on success, expires on a window |
| Admin/demo routes | unauthenticated | compiled out in prod (`if (isDev)`) → 404 |
| Grant store | in-process `Map` (single replica, lost on restart) | pluggable: in-memory (dev) / **Redis atomic Lua CAS** (prod) — single-use holds across replicas + restarts |
| Network calls | unguarded `fetch` | `AbortSignal.timeout` + `r.ok` + try/catch; fail closed on security paths |
| Crashes | unhandled | `unhandledRejection`/`uncaughtException` nets; Express async errors forwarded; graceful SIGTERM/SIGINT shutdown |
| Incident loop | races on reset/thrash; timeouts ignored | `AbortController`; honored `until()` timeouts → terminal `failed` state |
| Deploy | no backend Dockerfiles; `tsx` a devDep (broke `npm ci --omit=dev`) | Dockerfiles for every service; `tsx` in dependencies; compose with healthcheck/limits/restart/`depends_on: service_healthy`; slim images (Next standalone) |
| Observability | `console.log` | pino JSON logs + correlation ID across services; Prometheus `/metrics`; SSE backpressure + cap; env-gated Sentry + OpenTelemetry |
| Validation | none | zod at the gate + worker boundaries → `400` on malformed input |
| Frontend | dropped stream silently reverted to SIM | distinct connecting/live/reconnecting/lost states; retains last snapshot; reconnect with backoff; control-error surfacing |

## Environment matrix

See `.env.example` for the full grouped list. Prod-required (fail closed if
missing) per service:

| Var | gate | payments | worker | agent |
|---|:-:|:-:|:-:|:-:|
| `VIGIL_INTERNAL_SECRET` | ✅ | ✅ | ✅ | ✅ |
| `WORKER_ATTEST_SECRET` | ✅ | — | ✅ | ❌ (must NOT hold it) |
| `REDIS_URL` | ✅ | — | — | — |
| `GATE_URL` | — | ✅ | — | ✅ |
| `WORKER_URL` / `POMERIUM_URL` | — | — | — | ✅ |

## Threat model addressed

- **External attacker with no secret** cannot mint or verify a grant, cannot
  reach destructive routes, and cannot set `requestedBy` — all internal calls
  are HMAC-authenticated with a freshness window and body integrity.
- **A compromised agent** cannot forge sandbox evidence: `sandboxPassed` only
  counts with a valid attestation signed by the worker's secret, which the agent
  never holds. It also cannot loosen the gate's observed failure count (policy
  takes `max(self-reported, gate-observed)`).
- **Token theft / replay**: grants are single-use (atomic CAS in Redis), 60s TTL,
  scoped to one action+service, redacted in listings, and (in prod) travel only
  over TLS through Pomerium.
- **Replica / restart**: single-use is enforced in the shared store, so two gate
  replicas racing one token yield exactly one spend (tested), and grants survive
  a restart.
- **Downstream outage**: security paths fail closed (deny) rather than hang or
  crash; every call is time-bounded.

## Known limitations (honest)

- **Shared-secret auth** authenticates *membership* in the internal mesh and
  each call's integrity/freshness, but does not cryptographically distinguish
  one internal peer from another. Upgrade path: per-caller keys or mTLS/SPIFFE.
- **`servicesAffected` / `budgetUsed`** are still caller-asserted (only
  `max`-monotonic for failures is enforced). A gate-side budget ledger and an
  action→blast-radius table would remove that trust.
- **Prod Pomerium** (`pomerium/config.prod.yaml`) is a ready-to-fill template; a
  real deployment needs an IdP + certificate provisioning this repo doesn't
  stand up.
- **Prod incident trigger**: the demo `/demo/*` controls are dev-only. In prod
  the same detect→gate→remediate core would be driven by real alerting, which is
  out of scope here.
- **`docker compose up`** was verified image-by-image on a shared Docker network
  (the dev box lacked the compose plugin); CI runs `docker compose build`.
- **Playwright E2E** is scaffolded but not executed in this session.
- **Secrets**: the local `.env` OpenAI key noted as "shared in chat" should be
  **rotated** (an external action). No key is committed or baked into any image.
- **Dependency**: the pinned Next.js (15.1.0) is flagged for a CVE in the
  lockfile; bump when validating the frontend build.

## Running

- **Dev demo**: `cp .env.example .env` → `./scripts/dev-all.sh` → open
  `http://localhost:3000/incidents/inc-4821`, press Play.
- **Composed dev stack**: `docker compose up --build`.
- **Hardened prod stack**: set `VIGIL_INTERNAL_SECRET` + `WORKER_ATTEST_SECRET`,
  then `docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build`.
