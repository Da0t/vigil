# Vigil

Vigil is an AI on-call engineer that fixes production incidents autonomously —
while holding zero standing production credentials. Every destructive action
needs a single-use, scoped, just-in-time grant.

## The loop (8 beats)

1. **Break** — the incident starts: `payments-api` begins serving real HTTP 500s
   into a live traffic loop, and the measured error rate climbs.
2. **Detect** — a real threshold on the measured error rate trips and opens the
   incident (no human paged).
3. **Context** — the agent pulls incident context: a governed read of the recent
   change set, pointing at deploy `#4821`.
4. **Zero parser** — the logs are a cryptic `.vlog` format the agent can't read,
   so it *buys* a single per-call log-parse capability from Zero (cost shown).
5. **Akash evidence** — it ships the parsed evidence to the Akash diagnostic
   worker, which reproduces the failure: `sandbox_passed=true`,
   `recommended_action=rollback`.
6. **Gate allow** — the remediation request transits Pomerium to the gate; the
   policy panel shows every check pass; the grant is **scoped to `payments-api`,
   single-use, 60s TTL**.
7. **Rollback + recovery** — the rollback applies through the gated path, the
   error-rate curve really recovers, and the single-use credential is consumed
   (0 standing credentials held).
8. **Escalation denied** — the agent then attempts a mass-restart across 12
   services; the gate **denies** it (blast radius over limit), policy tightens,
   and the audit strip shows the whole story, every action attributed.

## Architecture

```
 browser ──► Next.js web (:3000)
                │  SSE /events  (LoopState snapshots)
                ▼
        vigil-agent (:4000)  ── traffic loop ──► payments-api (:4100)  [mock prod]
          │        │  reads /metrics /logs /deploys (safe, direct)
          │        │
          │        ├─► Zero.xyz        (log-parse capability, per-call, $)
          │        ├─► Akash worker (:4400 local / deployed URL)  POST /diagnose
          │        │
          │        └─► POST gate (:4200) /grants  ──► verdict + single-use token
          │
          └─ destructive calls ONLY via Pomerium (:4300) ──► payments-api
                                   /rollback /restart  (payments-api re-verifies
                                   the grant token with the gate — two layers)
```

The frontend consumes the orchestrator over SSE (`/events`, full `LoopState`
snapshots). Every integration has a local fallback selected by env var, so the
demo works end-to-end at every merge stage — unset = fallback, set = real
service.

## Sponsors — and precisely what each does

| Sponsor | Role in the loop | Receipts |
|---|---|---|
| **Zero.xyz** | Per-call log-parse capability the agent buys just-in-time (beat 4). It never holds a standing parser — it pays per use. | `docs/zero-receipts.md` |
| **Akash** | Hosts the diagnostic worker that reproduces the failure in a disposable sandbox (beat 5), deployed live. | deployed URL + proof in `services/diagnostic-worker/AKASH.md` |
| **Pomerium** | The *only* path to destructive routes (`/rollback`, `/restart`). Rollback (beat 6–7) and the denied mass-restart (beat 8) really transit it. | `pomerium/` (config + policy) |
| **OpenAI** | Optional LLM hypothesis step — writes a one-sentence root-cause hypothesis (`gpt-4o-mini`) when `OPENAI_API_KEY` is set; deterministic fallback otherwise. | env `OPENAI_API_KEY` (`services/vigil-agent/src/hypothesis.ts`) |

## What's real vs simulated

| Piece | Real | Simulated |
|---|---|---|
| payments-api errors | Real HTTP 500s served to a real traffic loop | It's a purpose-built mock service |
| Detection | Real threshold on measured error rate | Alert routing (no PagerDuty) |
| Zero | Live per-call capability (if `ZERO_MODE=live`) | Fallback parser when unset |
| Akash | Worker genuinely deployed on Akash, called live | Provision/teardown lifecycle beats are staged (worker pre-deployed) |
| Pomerium | Destructive routes really transit Pomerium; grants really single-use + TTL | — |
| Recovery | Error rate really drops because rollback really flips the service | — |

## Run it

```bash
cp .env.example .env      # unset vars fall back to local mimics; demo still works
./scripts/dev-all.sh      # starts payments-api, gate, vigil-agent (if present) + the web app
```

- **Pomerium** runs separately — see `pomerium/README.md` for the one-line
  `pomerium` command (it fronts the destructive routes on `:4300`).
- Open the incident: **http://localhost:3000/incidents/inc-4821**
- Press **Play** and watch the loop run. The chip by the controls reads
  **`LIVE · real services`** when the orchestrator is up, **`SIM · scripted`**
  when it isn't — the same UI drives both.

## Production

Vigil follows one rule everywhere: **fail closed in prod, fail convenient in
dev**, gated on `VIGIL_ENV` (falls back to `NODE_ENV`).

- **Dev** (`VIGIL_ENV` unset/`development`): unset vars fall back to local
  defaults, service auth + attestation are disabled, the grant store is
  in-memory — the demo runs with **zero secrets**.
- **Prod** (`VIGIL_ENV=production`): every service validates its required env at
  boot and refuses to start if a secret is missing (fail fast). Then:
  - **Service-to-service auth** — every internal call is HMAC-signed (identity +
    timestamp + body integrity); unauthenticated callers are rejected.
  - **Verified evidence** — the gate derives `requestedBy` from the authenticated
    caller and only accepts `sandboxPassed` when a **worker-signed attestation**
    backs it (the agent never holds the attest secret, so it can't forge proof).
  - **Single-use grants** — 60s TTL, scoped to one action+service, redacted in
    listings, enforced atomically in a shared **Redis** store so they hold across
    replicas and survive restarts.
  - **Network isolation + TLS** — destructive routes are reachable only through
    Pomerium (`config.prod.yaml`, HTTPS + a real policy); payments-api isn't
    published to the host.
  - **Observability** — structured pino logs with a correlation ID across the
    call chain, Prometheus `/metrics`, env-gated Sentry + OpenTelemetry.

Run the composed stacks:

```bash
docker compose up --build                                   # dev stack (no secrets)

export VIGIL_INTERNAL_SECRET=$(openssl rand -hex 24)
export WORKER_ATTEST_SECRET=$(openssl rand -hex 24)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build   # hardened prod stack
```

See **[PRODUCTION.md](PRODUCTION.md)** for the full change log, env matrix,
threat model, and known limitations, and `.env.example` for every variable
(grouped, with the prod-required ones marked).

## Repo tour

- `src/` — Next.js frontend (App Router). The incident page, the live/sim state
  hooks, and the shared wire contract (`src/lib/contract.ts`).
- `services/` — the backend: `payments-api` (mock prod), `vigil-agent`
  (orchestrator), `gate` (policy + single-use grants), `diagnostic-worker`
  (Akash).
- `pomerium/` — Pomerium config that gates the destructive routes.
- `shared/` — cross-service fixtures (e.g. the `.vlog` log samples).
- `scripts/` — `dev-all.sh`, the one-command demo launcher.
- `docs/` — plans, the demo script, and sponsor receipts.

## License

MIT License. See [LICENSE](LICENSE).
