# Person C — Capabilities: Akash diagnostic worker + Zero.xyz (branch `person-c-capabilities`)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans if
> available; otherwise execute top-to-bottom, one todo per task. Commit after
> every task. You own `services/diagnostic-worker/**` and EXACTLY ONE file in
> vigil-agent: `services/vigil-agent/src/integrations/zero-live.ts`. Nothing
> else — not clients.ts, not the orchestrator, not the frontend.

**Goal:** The evidence generators. (1) A diagnostic worker container genuinely
deployed on Akash that Vigil sends incident evidence to and gets back
`sandbox_passed` + `recommended_action`. (2) A live Zero.xyz call that gives
Vigil the log-parsing capability it lacks, with a per-call cost receipt.

**Read first:** `src/lib/contract.ts` — `DiagnoseRequest/Response`,
`ParsedLogs`, `VLOG_LINE`. Sample logs: `shared/fixtures/payments.vlog`.

**Important:** the worker CANNOT import from `../../src/...` — it gets built
into a Docker image whose build context is only its own folder. Its small
contract duplicate is intentional.

---

### Task C1: diagnostic worker service (runs anywhere)

**Files:**
- Create: `services/diagnostic-worker/package.json`
- Create: `services/diagnostic-worker/src/contract-lite.ts`
- Create: `services/diagnostic-worker/src/index.ts`

- [ ] **Step 1: scaffold**

```bash
mkdir -p services/diagnostic-worker/src && cd services/diagnostic-worker
npm init -y && npm i express@4 cors tsx && npm i -D @types/express @types/cors typescript
```

(Note: `tsx` is a runtime dependency here — the container runs through it.)

- [ ] **Step 2: `src/contract-lite.ts`** — intentional duplicate of the shapes
this container needs (keep in sync with `src/lib/contract.ts` by hand):

```ts
export interface DiagnoseRequest {
  service: string;
  deployId: string;
  candidateAction: string;
  rawLogs: string;
}

export interface DiagnoseResponse {
  sandboxPassed: boolean;
  rootCause: string;
  recommendedAction: string;
  checks: { name: string; passed: boolean; detail?: string }[];
}

export const VLOG_LINE =
  /^\|(?<lvl>[EWI])\|(?<ts>\d+)\|(?<component>[\w-]+)\|(?<code>[A-Z_]+)\|(?<rest>.*)$/;
```

- [ ] **Step 3: `src/index.ts`** (complete file):

```ts
import express from "express";
import cors from "cors";
import { VLOG_LINE, type DiagnoseRequest, type DiagnoseResponse } from "./contract-lite";

const PORT = Number(process.env.PORT ?? 4400);
const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => { res.json({ ok: true, role: "vigil-diagnostic-worker" }); });

app.post("/diagnose", (req, res) => {
  const { service, deployId, candidateAction, rawLogs } = req.body as DiagnoseRequest;

  const errors: { component: string; code: string; rest: string }[] = [];
  let sawDeployMarker = false;
  for (const line of (rawLogs ?? "").split("\n")) {
    const m = VLOG_LINE.exec(line.trim());
    if (!m?.groups) continue;
    if (m.groups.code === "DEPLOY_APPLIED" && m.groups.rest.includes(`deploy=${deployId}`)) sawDeployMarker = true;
    if (m.groups.lvl === "E") errors.push({ component: m.groups.component, code: m.groups.code, rest: m.groups.rest });
  }

  const top = <K extends "component" | "code">(k: K) => {
    const map = new Map<string, number>();
    for (const e of errors) map.set(e[k], (map.get(e[k]) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0];
  };
  const topComponent = top("component");
  const topCode = top("code");
  const dominant = topComponent && errors.length > 0 && topComponent[1] / errors.length > 0.7;
  const cfgRelated = !!topCode && /CFG|TIMEOUT|CONFIG/.test(topCode[0]);
  const referencesDeploy = errors.some((e) => e.rest.includes(`deploy=${deployId}`));

  const checks = [
    { name: "errors_present", passed: errors.length > 0, detail: `${errors.length} error lines` },
    { name: "single_component_dominates", passed: !!dominant, detail: topComponent?.[0] },
    { name: "signature_is_config_related", passed: cfgRelated, detail: topCode?.[0] },
    { name: "errors_reference_deploy", passed: referencesDeploy || sawDeployMarker, detail: deployId },
  ];
  const passed = checks.every((c) => c.passed);

  const response: DiagnoseResponse = {
    sandboxPassed: passed,
    rootCause: passed
      ? `deploy ${deployId} changed ${topComponent?.[0]} config handling (${topCode?.[0]})`
      : "evidence inconclusive — human review required",
    recommendedAction: passed ? candidateAction : "escalate",
    checks,
  };
  console.log(`[worker] diagnose ${service}/${deployId}: sandbox_passed=${passed}`);
  res.json(response);
});

app.listen(PORT, () => console.log(`[diagnostic-worker] :${PORT}`));
```

- [ ] **Step 4: verify locally with the fixture**

```bash
npx tsx src/index.ts &
curl -s -X POST localhost:4400/diagnose -H 'content-type: application/json' \
  -d "$(python3 -c "import json; print(json.dumps({'service':'payments-api','deployId':'#4821','candidateAction':'rollback','rawLogs':open('../../shared/fixtures/payments.vlog').read()}))")"
# → {"sandboxPassed":true,"rootCause":"deploy #4821 changed stripe_adapter config handling (ERR_TIMEOUT_CFG)","recommendedAction":"rollback","checks":[...all passed:true]}
kill %1
```

- [ ] **Step 5: commit** — `git add services/diagnostic-worker && git commit -m "feat: diagnostic worker — evidence checks for candidate remediation"`

---

### Task C2: containerize + deploy to Akash

**Files:**
- Create: `services/diagnostic-worker/Dockerfile`
- Create: `services/diagnostic-worker/deploy.yaml` (Akash SDL)
- Create: `services/diagnostic-worker/AKASH.md` (deployed URL + receipts)

- [ ] **Step 1: `Dockerfile`**:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 4400
CMD ["npx", "tsx", "src/index.ts"]
```

- [ ] **Step 2: build for amd64 and push.** Macs are ARM — Akash providers are
amd64. This is the classic gotcha; do not skip the platform flag. Use Docker Hub
(public) with your username:

```bash
cd services/diagnostic-worker
docker buildx build --platform linux/amd64 -t <dockerhub-user>/vigil-diagnostic-worker:latest --push .
# sanity check the image runs:
docker run --rm -p 4401:4400 <dockerhub-user>/vigil-diagnostic-worker:latest &
curl -s localhost:4401/health   # {"ok":true,...}
```

- [ ] **Step 3: `deploy.yaml`** (Akash SDL — starting point; verify against
current docs at https://akash.network/docs and the sponsor booth, who likely
have credits/wallet help):

```yaml
---
version: "2.0"
services:
  worker:
    image: <dockerhub-user>/vigil-diagnostic-worker:latest
    expose:
      - port: 4400
        as: 80
        to:
          - global: true
profiles:
  compute:
    worker:
      resources:
        cpu:
          units: 0.5
        memory:
          size: 512Mi
        storage:
          size: 512Mi
  placement:
    akash:
      pricing:
        worker:
          denom: uakt
          amount: 10000
deployment:
  worker:
    akash:
      profile: worker
      count: 1
```

- [ ] **Step 4: deploy via Akash Console** (https://console.akash.network —
fastest path; needs a wallet with AKT or trial credits from the sponsor):
upload `deploy.yaml`, pick a provider bid, deploy, get the public URL.

- [ ] **Step 5: verify the DEPLOYED worker end-to-end:**

```bash
export WORKER_URL=http://<akash-provider-host>:<port>   # from console lease
curl -s $WORKER_URL/health   # {"ok":true,"role":"vigil-diagnostic-worker"}
curl -s -X POST $WORKER_URL/diagnose -H 'content-type: application/json' \
  -d "$(python3 -c "import json; print(json.dumps({'service':'payments-api','deployId':'#4821','candidateAction':'rollback','rawLogs':open('shared/fixtures/payments.vlog').read()}))")"
# → sandboxPassed:true (same as local)
```

- [ ] **Step 6: `AKASH.md`** — record: deployed URL, lease ID, provider,
  screenshots of the console lease, the exact curl + response above. These are
  the receipts for judges and the README.

- [ ] **Step 7: commit** — `git commit -m "feat: worker containerized + deployed on Akash (see AKASH.md)"`

**If Akash deployment is fought past ~45 min:** timebox it. The env-switch
design means `WORKER_URL` can point at the local container; keep the SDL +
attempt notes in AKASH.md, get help from the booth, retry after C3.

---

### Task C3: Zero.xyz live log-parse capability

**Files:**
- Modify: `services/vigil-agent/src/integrations/zero-live.ts` (replace the stub — this is your ONE vigil-agent file)
- Create: `services/diagnostic-worker/../..`/`docs/zero-receipts.md` → create as `docs/zero-receipts.md`

**Consumed by:** `clients.ts#parseLogs` — already wired: when `ZERO_MODE=live`,
it calls your `parseLogsLive(raw)`; any throw falls back to the local parser.
So nothing you do here can break the demo.

- [ ] **Step 1: read Zero's actual docs** (https://zero.xyz — plus whatever the
sponsor booth hands out: API base URL, auth scheme, how a capability/tool call
is made and how cost is reported). Budget 45–60 min max including this step.
What Vigil needs from Zero, in order of preference:
  1. A capability/tool invocation that can transform/parse text (ideal: send the
     raw `.vlog` text, get structure back).
  2. Any per-call paid capability invocation whose response we can map into
     `ParsedLogs` fields (even partially) — the demo point is *acquiring a paid
     capability on demand with a receipt*, and we can still merge Zero's output
     with the local parse.

- [ ] **Step 2: implement `zero-live.ts`.** Shape (adapt endpoint/payload/auth
to the real docs — the error handling and mapping stay):

```ts
import type { ParsedLogs } from "../../../../src/lib/contract";

const ZERO_API_URL = process.env.ZERO_API_URL ?? "https://api.zero.xyz"; // confirm in docs
const ZERO_API_KEY = process.env.ZERO_API_KEY;

/**
 * Buys one log-parse capability call from Zero. Throws on any failure —
 * the caller falls back to the local parser, so fail loudly, never
 * return half-fake data with parserSource: "zero".
 */
export async function parseLogsLive(raw: string): Promise<ParsedLogs> {
  if (!ZERO_API_KEY) throw new Error("ZERO_API_KEY unset");
  const r = await fetch(`${ZERO_API_URL}/<capability-invoke-path-from-docs>`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ZERO_API_KEY}` },
    body: JSON.stringify({
      // per docs — e.g. capability id + input payload:
      input: raw,
    }),
  });
  if (!r.ok) throw new Error(`zero: HTTP ${r.status} ${await r.text().catch(() => "")}`);
  const data = await r.json();
  console.log("[zero] raw response:", JSON.stringify(data).slice(0, 400));

  // Map the real response into ParsedLogs. Fill what Zero returns; anything
  // it doesn't cover, derive from the raw logs the same way the local
  // parser does — but parserSource stays "zero" only if Zero's call
  // genuinely succeeded and its output was used.
  return {
    errorSignature: /* from data */ "ERR_TIMEOUT_CFG",
    suspectComponent: /* from data */ "stripe_adapter",
    suspectDeploy: /* from data */ "#4821",
    sampleLines: /* from data or raw */ raw.split("\n").filter((l) => l.startsWith("|E|")).slice(0, 3),
    parserSource: "zero",
    costUsd: /* from data / receipt */ 0.04,
  };
}
```

The literals above are what the mapping must PRODUCE for the fixture — replace
each `/* from data */` with the real field from Zero's response. If Zero's
response can't populate a field, derive it from `raw` locally and say so in
`docs/zero-receipts.md`.

- [ ] **Step 3: verify against the fixture**

```bash
cd services/vigil-agent
ZERO_MODE=live ZERO_API_KEY=<key> npx tsx -e "
import { readFileSync } from 'node:fs';
import { parseLogsLive } from './src/integrations/zero-live';
parseLogsLive(readFileSync('../../shared/fixtures/payments.vlog','utf8')).then(p => console.log(p));
"
# → { errorSignature: 'ERR_TIMEOUT_CFG', ..., parserSource: 'zero', costUsd: <real cost> }
```

- [ ] **Step 4: `docs/zero-receipts.md`** — paste the raw Zero response, the
  cost/receipt info, and exactly which `ParsedLogs` fields came from Zero vs
  derived locally. Honesty here is a feature.

- [ ] **Step 5: commit** — `git commit -m "feat: live Zero.xyz log-parse capability with receipts"`

**If Zero's API genuinely can't do this in the time box:** leave the stub
throwing, write `docs/zero-receipts.md` explaining what was attempted and how
the fallback is labeled in the UI (`parserSource: "fallback"`). The demo
narrative survives; honesty beats theater.

---

**Definition of done:** local worker curl passes; deployed Akash URL answers
`/diagnose` correctly (or AKASH.md documents the timeboxed state); zero-live.ts
either works live with receipts or documents why not. Push the branch. Post
"C done · WORKER_URL=<url>" in team chat — the coordinator needs that URL at
merge time.
