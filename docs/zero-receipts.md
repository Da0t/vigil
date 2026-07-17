# Zero.xyz log-parse capability — receipts

STATUS: awaiting Zero API key

Vigil lacks the ability to parse payments-api's cryptic `.vlog` format on its
own, so it *buys* that capability from Zero on demand. The integration
(`services/vigil-agent/src/integrations/zero-live.ts`, `parseLogsLive(raw)`) is
implemented, type-checks against the frozen contract, and its failure path is
verified. The one thing missing is a funded Zero credential — get it at the
sponsor booth, then run the one-command verification below and paste the real
receipt here.

---

## What Zero.xyz actually is (from real docs discovery)

Discovery done against <https://zero.xyz> and its CLI docs (~15 min budget).
Findings:

- Zero is a **discovery + per-call-payment layer** for AI agents: "gives your AI
  access to thousands of tools, APIs and services." When an agent hits something
  it can't do (parse weird logs, generate media, scrape, etc.), it discovers a
  third-party capability through Zero and invokes it, paying **per call in USDC
  over the x402 protocol** (Base chain). ~$5 free credit to start; many
  capabilities cost pennies.
- Its **first-class interface is a CLI**, `@zeroxyz/cli`, with a four-step loop:
  1. `zero search "parse logs"` → capability results with attribution tokens
     (`z_xxx.N`).
  2. `zero get z_Ab12cd.1 --formatted` → the capability's URL, method, request
     schema, and **pricing**.
  3. `zero fetch <url> --capability z_Ab12cd.1 -d '{...}' --max-pay 0.10` →
     invokes it, auto-handles the `402 Payment Required` challenge, returns the
     response body on stdout and a **Run ID + payment info** on stderr (or a
     structured `{ ok, runId, payment, body }` envelope with `--json`).
  4. `zero review <runId> --success ...` → required after every paid call.
- **Auth is wallet-based**, not a classic API key: `ZERO_PRIVATE_KEY=0x…` for a
  custom wallet, `zero auth agent register` for a managed agent account, or an
  MCP connector's `authorize` flow for sandboxes.

### Consequence for this integration (honesty note)

The frozen shared contract (`src/lib/contract.ts`) standardized on
`ZERO_API_KEY` + `ZERO_MODE=live` and an HTTP-shaped call — decided before this
discovery. Zero's real primary interface is the **CLI + USDC wallet**, and there
is no single fixed "parse logs" REST endpoint (Zero brokers to whichever
third-party capability `search` surfaces). Rather than fight the frozen
contract at the deadline, `zero-live.ts`:

- keeps `ZERO_API_KEY` as the **gate** (that's what `clients.ts` and the demo
  set), and
- makes **every Zero-specific value env-overridable** so the real
  URL/capability/spend-cap from the booth can be injected without a code change:

  | env var | default | meaning |
  |---|---|---|
  | `ZERO_API_KEY` | — (required) | credential; unset ⇒ throw ⇒ local fallback |
  | `ZERO_API_URL` | `https://api.zero.xyz` | Zero invoke gateway base |
  | `ZERO_INVOKE_PATH` | `/v1/fetch` | `fetch`-style capability-invoke path |
  | `ZERO_CAPABILITY` | `log-parse` | capability/attribution id (e.g. `z_Ab12cd.1`) |
  | `ZERO_MAX_PAY` | `0.10` | hard per-call spend cap (USD), mirrors `--max-pay` |

If the booth hands out a Zero **HTTP gateway** URL + key, set `ZERO_API_URL`
(and `ZERO_CAPABILITY` from `zero search`) and it works as-is. If Zero only
exposes the **CLI/wallet** path, the alternative is to shell out to
`@zeroxyz/cli` from `parseLogsLive`; the request/response mapping below is
identical either way.

---

## Field provenance (`ParsedLogs`)

`parseLogsLive` uses Zero's returned fields when present, and derives anything
Zero omits from `raw` locally (the same regex technique as the fallback parser).
**No fixture values are hardcoded** — every field traces to Zero's response or
to `raw`.

| `ParsedLogs` field | from Zero if it returns… | otherwise derived from `raw` |
|---|---|---|
| `errorSignature` | `body.errorSignature \| signature \| code` | most-frequent `E`-line code |
| `suspectComponent` | `body.suspectComponent \| component` | most-frequent `E`-line component |
| `suspectDeploy` | `body.suspectDeploy \| deploy` | `deploy=…` in an `E` line |
| `sampleLines` | `body.sampleLines[]` | first 3 `E` lines |
| `parserSource` | always `"zero"` — only reached on a genuine success | (fallback path sets `"fallback"`) |
| `costUsd` | `payment.amountUsd \| payment.amount \| costUsd \| x-zero-payment` header | **never invented** — omitted if absent |

---

## Verification status

### Throw-on-failure path — ✅ VERIFIED (this is what the demo's fallback depends on)

With `ZERO_API_KEY` unset, `parseLogsLive` throws immediately, before any
network call, so `clients.ts` falls back to the local parser:

```
$ tsx zero-failpath.ts        # ZERO_API_KEY unset
THREW CLEANLY: zero-live: ZERO_API_KEY unset
exit=0
```

### Mapping path — ✅ VERIFIED with a stubbed Zero success (no key needed)

Stubbing `fetch` to return a Zero-shaped envelope with an **empty capability
body but a real payment receipt** proves the mapping is genuine (fields derived
from `raw`, cost taken from the receipt) and not hardcoded:

```
[zero] raw response: {"ok":true,"runId":"run_demo_123","payment":{"amountUsd":0.03,"asset":"USDC","chain":"base"},"body":{}}
{
  "errorSignature": "ERR_TIMEOUT_CFG",     <- derived from raw (body was empty)
  "suspectComponent": "stripe_adapter",    <- derived from raw
  "suspectDeploy": "#4821",                <- derived from raw
  "sampleLines": [ ...first 3 E lines... ],<- derived from raw
  "parserSource": "zero",
  "costUsd": 0.03                          <- from Zero's payment receipt
}
```

### Live path — ⏳ PENDING a real key

`npx tsc --noEmit` (repo root) passes, so `zero-live.ts` type-checks against the
frozen `ParsedLogs` contract. Only a funded credential is missing.

---

## One-command verification to run once a key exists

Get a Zero credential at the booth, then (from `services/vigil-agent`, after the
branches merge so vigil-agent has its deps):

```bash
cd services/vigil-agent
# If the booth gives an HTTP gateway, also export ZERO_API_URL / ZERO_CAPABILITY.
ZERO_MODE=live ZERO_API_KEY=<key> npx tsx -e "
import { readFileSync } from 'node:fs';
import { parseLogsLive } from './src/integrations/zero-live';
parseLogsLive(readFileSync('../../shared/fixtures/payments.vlog','utf8'))
  .then(p => console.log(JSON.stringify(p, null, 2)))
  .catch(e => { console.error('zero live call failed:', e.message); process.exit(1); });
"
# Expect: parserSource:"zero", costUsd:<real cost from the receipt>, and the
# stripe_adapter / ERR_TIMEOUT_CFG / #4821 fields (from Zero and/or derived).
```

Then paste here: the raw `[zero] raw response:` line, the returned `ParsedLogs`,
and the real `costUsd`. Replace the STATUS line at the top with
`STATUS: live, receipts below`.

### If Zero genuinely can't do this in the time box

Leave the credential unset. `parseLogsLive` throws, `clients.ts` falls back to
the local regex parser, and the UI labels the result `parserSource:"fallback"`.
The demo narrative survives intact — honesty beats theater.
