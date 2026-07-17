# Akash deploy — Vigil diagnostic worker

STATUS: ✅ LIVE ON AKASH. Image da0t/vigil-diagnostic-worker:latest (clean
single-arch linux/amd64, digest sha256:0d782ad5a668…a1e1c1) deployed to a lease
on provider **overclock (na-us-west, 100% uptime)** via console.akash.network.

- **WORKER_URL:** http://qdf388inj981750j4jbdb8t33c.ingress.hurricane.akash.pub
- **Verified from the cloud:**
  - `GET /health` → `{"ok":true,"role":"vigil-diagnostic-worker"}`
  - `POST /diagnose` (fixture) → `sandboxPassed:true`,
    rootCause "deploy #4821 changed stripe_adapter config handling
    (ERR_TIMEOUT_CFG)", recommendedAction "rollback", all 4 checks passed.
- **Full loop verified:** vigil-agent with WORKER_URL set dispatched to this
  lease (audit: "Dispatching Akash diagnostic worker" → "Sandbox passed"),
  sandbox region reported "akash · deployed". WORKER_URL is set in `.env`.

The service (`services/diagnostic-worker`) is built, verified locally, and
containerized. The image build + push + Akash lease steps below require a human
with a Docker Hub login and an Akash wallet (or sponsor trial credits), so they
are left for the human-only checklist.

> **Build-machine note:** Docker was **not installed** on the machine that
> prepared this branch (`docker`/`docker info`/`docker buildx` all unavailable),
> so the image was **not** built or run locally. The `Dockerfile` is a standard
> `node:20-alpine` + `npm ci --omit=dev` image (`tsx` is a *runtime* dep, so it
> survives `--omit=dev`); it needs a real Docker daemon to build. Everything
> below is the exact, copy-pasteable path to finish the deploy.

---

## 1. Build for amd64 and push to Docker Hub

Macs are ARM; Akash providers are amd64 — the `--platform linux/amd64` flag is
mandatory, not optional. Replace `<dockerhub-user>` with your Docker Hub
username (this is a placeholder, not a real account).

```bash
cd services/diagnostic-worker
docker login                       # human-only: Docker Hub credentials
docker buildx build --platform linux/amd64 \
  -t <dockerhub-user>/vigil-diagnostic-worker:latest --push .

# sanity-check the pushed image runs (maps container 4400 -> host 4401):
docker run --rm -p 4401:4400 <dockerhub-user>/vigil-diagnostic-worker:latest &
curl -s localhost:4401/health          # -> {"ok":true,"role":"vigil-diagnostic-worker"}
# then stop it:  docker stop $(docker ps -q --filter ancestor=<dockerhub-user>/vigil-diagnostic-worker:latest)
```

After pushing, set the image in `deploy.yaml` (replace the `<dockerhub-user>`
placeholder in the `image:` line to match what you pushed).

## 2. Deploy via Akash Console (fastest path)

1. Open <https://console.akash.network>.
2. Connect a wallet funded with AKT (or claim trial credits at the sponsor booth).
3. **Deploy → Build your template → Upload SDL** and paste
   `services/diagnostic-worker/deploy.yaml`.
4. **Create Deployment**, review bids, and **accept a provider bid**.
5. Once the lease is active, open the lease and copy the public URI/port the
   provider exposes for port 80 (mapped from container `4400`).

## 3. Verify the DEPLOYED worker end-to-end

Run these from the **repo root** (the fixture path is repo-relative). Replace
the host/port with the lease URI from step 2.

```bash
export WORKER_URL=http://<akash-provider-host>:<port>

# health:
curl -s "$WORKER_URL/health"
# -> {"ok":true,"role":"vigil-diagnostic-worker"}

# fixture diagnose (must match the local result exactly):
curl -s -X POST "$WORKER_URL/diagnose" -H 'content-type: application/json' \
  -d "$(python3 -c "import json; print(json.dumps({'service':'payments-api','deployId':'#4821','candidateAction':'rollback','rawLogs':open('shared/fixtures/payments.vlog').read()}))")"
# -> sandboxPassed:true, rootCause contains stripe_adapter + ERR_TIMEOUT_CFG,
#    recommendedAction:"rollback", all 4 checks passed:true
```

(If `python3` is missing, build the body with node instead:)

```bash
curl -s -X POST "$WORKER_URL/diagnose" -H 'content-type: application/json' \
  -d "$(node -e "const fs=require('fs');process.stdout.write(JSON.stringify({service:'payments-api',deployId:'#4821',candidateAction:'rollback',rawLogs:fs.readFileSync('shared/fixtures/payments.vlog','utf8')}))")"
```

## 4. Record the deployed URL (receipts for judges / merge)

Fill these in after the lease is live — the coordinator needs `WORKER_URL` at
merge time (`WORKER_URL=<deployed>` in the orchestrator env selects the real
worker; unset falls back to the in-process heuristic):

- **WORKER_URL:** `<fill after deploy — e.g. http://provider.example.com:32115>`
- **Lease ID:** `<fill: order/dseq from console>`
- **Provider:** `<fill: provider address / host>`
- **Image digest:** `<fill: docker buildx output or `docker inspect`>`
- **Console lease screenshot:** `<attach / link>`
- **Verified health + diagnose response pasted:** `<paste step-3 output>`

---

## Local verification already passing (from Task C1, run without Docker)

```
GET /health  -> {"ok":true,"role":"vigil-diagnostic-worker"}

POST /diagnose (fixture) ->
  {"sandboxPassed":true,
   "rootCause":"deploy #4821 changed stripe_adapter config handling (ERR_TIMEOUT_CFG)",
   "recommendedAction":"rollback",
   "checks":[errors_present, single_component_dominates,
             signature_is_config_related, errors_reference_deploy] all passed:true}

POST /diagnose (rawLogs:"") ->
  {"sandboxPassed":false, "recommendedAction":"escalate", ...}  (checks not vacuous)
```
