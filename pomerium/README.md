# Pomerium — the proxy in front of the two destructive prod routes

Vigil's destructive path is **layered**:

```
vigil-agent ──POST /rollback|/restart──► Pomerium (:4300) ──► payments-api (:4100)
                                             │                        │
                                   route restriction         re-verifies the single-use
                                   (only these 2 paths        grant with the gate (:4200)
                                    are reachable at all)      on every destructive call
```

Two independent layers must both pass for a destructive action to land:

1. **Pomerium (this dir):** only `/rollback` and `/restart` are declared as routes.
   Every other prod path (`/logs`, `/metrics`, `/deploys`, …) has **no route**, so
   Pomerium answers `404` and the request never reaches prod.
2. **The gate (`services/gate`, :4200):** payments-api re-verifies the single-use,
   60s-TTL, scoped grant token with the gate on every call. A request with a
   missing/expired/already-used grant is rejected at the service even if it
   transited Pomerium.

This is the "layered model" from the plan. Enforcement of *single-use grants* is
**real and unconditional at the gate**; Pomerium adds a **real route-restriction**
layer on top (verified below). The Pomerium *auth* policy is intentionally
permissive for the local demo (`allow_public_unauthenticated_access`) — we do not
run an external IdP — so Pomerium's job here is route reachability, not identity.

## Verified against

- **Pomerium Core `0.33.0`** (`pomerium/pomerium:latest`, envoy-based), 2026-07-17.
- Config field syntax checked against current docs
  (pomerium.com/docs/reference/routes): `from`, `to`, `prefix` (path-prefix match,
  still valid at route level), and `allow_public_unauthenticated_access: true`
  (public-access field, current).

## Run it

The backend target is payments-api on `:4100` (Person A). Pomerium reaches the
host from inside the container via `host.docker.internal`.

**Standard bind-mount run** (use this from the repo, where the config lives under
`/Users/...` and Docker Desktop file-sharing works):

```bash
# from the repo root
docker run --rm --name vigil-pomerium -p 4300:4300 \
  -v "$PWD/pomerium/config.yaml:/pomerium/config.yaml" \
  pomerium/pomerium:latest
```

If your Docker Desktop can't bind-mount a single file from that path (it silently
mounts an empty dir and Pomerium logs `read /pomerium/config.yaml: is a
directory`), mount the **directory** instead:

```bash
docker run --rm --name vigil-pomerium -p 4300:4300 \
  -v "$PWD/pomerium:/pomerium" \
  pomerium/pomerium:latest
```

…or bake the config into a throwaway image (no bind mount at all — this is what
was used to verify here, because the CI/scratch path was not a Docker-shared
directory):

```bash
printf 'FROM pomerium/pomerium:latest\nCOPY config.yaml /pomerium/config.yaml\n' > /tmp/pom.Dockerfile
docker build -t vigil-pomerium -f /tmp/pom.Dockerfile pomerium
docker run --rm --name vigil-pomerium -p 4300:4300 vigil-pomerium
```

## What was verified (2026-07-17, Pomerium 0.33.0)

Backend was a stand-in on `:4100` (`python3 -m http.server 4100`) purely to prove
proxying; in the real demo payments-api serves `:4100`. `POST` cleanly
distinguishes the two outcomes — the stub answers `501` to POST (so `501` ⇒ the
request reached the backend), while Pomerium answers `404` for any path it has no
route for:

| Request | Result | Meaning |
|---|---|---|
| `POST /rollback` | `501` | **routed** through Pomerium to `:4100` |
| `POST /restart`  | `501` | **routed** through Pomerium to `:4100` |
| `POST /logs`     | `404` | **blocked** — no route, answered by Pomerium |
| `POST /metrics`  | `404` | **blocked** |
| `POST /deploys`  | `404` | **blocked** |
| `POST /admin`    | `404` | **blocked** |
| `POST /`         | `404` | **blocked** |

Proof of *source*: the `/rollback` body is python's error page (`<!DOCTYPE HTML>`,
uppercase — from the backend), the `/logs` body is Pomerium's own `404`
(`<!DOCTYPE html>`, lowercase — never left the proxy). Pomerium's authorize log
for a routed call shows `path:/rollback ... allow:true ["accept"]`.

Reproduce (with the container up and a target on `:4100`):

```bash
for p in /rollback /restart /logs /metrics /deploys; do
  printf 'POST %-9s -> ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "http://localhost:4300$p"
done
# expect: /rollback 501, /restart 501, everything else 404
```

## Enforcement level achieved

- **Route restriction: REAL.** Only `/rollback` and `/restart` are reachable
  through `:4300`; all other prod paths return `404` at the proxy. Verified above.
- **Single-use grant: REAL and enforced at the gate/service layer**
  (`services/gate` + payments-api), independent of Pomerium.
- **Pomerium auth policy: permissive by design** for the no-IdP local demo
  (`allow_public_unauthenticated_access`). Tightening Pomerium itself to require a
  grant header (PPL) is a documented stretch; it is unnecessary for correctness
  because the grant is already hard-enforced one layer down. If pursued, add a PPL
  `deny` for requests missing `x-vigil-grant` and screenshot the denial here.

_Person D: copy the "layered" diagram + the honesty note ("route restriction is
real; grant single-use is real; Pomerium auth is permissive for the demo") into
the main README honesty table._

## Production profile (`config.prod.yaml`)

`config.yaml` is the **dev** profile (plain HTTP, public access). Production uses
`config.prod.yaml`, which changes three things:

| Concern | dev (`config.yaml`) | prod (`config.prod.yaml`) |
|---|---|---|
| Transport | `insecure_server: true` (plain HTTP) | HTTPS only — grant tokens never travel cleartext |
| Caller auth | `allow_public_unauthenticated_access` | `authenticated_user: true` — anonymous denied at the proxy |
| Routes | `/rollback`, `/restart` only | same (everything else 404s) |

Secrets/certs are injected at runtime via env (`SHARED_SECRET`, `COOKIE_SECRET`,
`SIGNING_KEY`, `AUTOCERT` or `CERTIFICATE`/`CERTIFICATE_KEY`, IdP creds) and are
never committed. This is the "document a service-mesh/ingress assumption" option
from the plan: a full prod Pomerium needs an IdP + certificate provisioning that
this repo does not stand up, so `config.prod.yaml` is a ready-to-fill template.

### Network isolation (Phase 1 #8)

In prod, payments-api's destructive routes must be reachable **only through
Pomerium**, never directly from the host:

- **Code path:** the agent's `applyRemediation` uses `POMERIUM_URL ?? PAYMENTS_URL`.
  `POMERIUM_URL` is `requiredInProd`, so in production the agent always routes
  through Pomerium; the direct-to-payments fallback is structurally dev-only.
- **Network path:** the prod compose/orchestration does **not** publish
  payments-api's `:4100` to the host — only Pomerium's `:443` is exposed, and
  payments-api is reachable solely on the internal network (see the prod compose
  notes / `docker-compose.prod.yml` from Phase 3). Even a leaked grant token
  cannot be replayed from outside the mesh.
