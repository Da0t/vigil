# Person D — Live frontend + demo kit (branch `person-d-frontend`)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans if
> available; otherwise execute top-to-bottom, one todo per task. Commit after
> every task. You own frontend `src/**` (NOT `src/lib/contract.ts`),
> `README.md`, `scripts/**`, `.env.example`, `docs/demo-script.md`. Never touch
> `services/**`.

**Goal:** The frontend consumes the real orchestrator over SSE (falling back to
the scripted sim when no backend is up), plus everything the submission needs:
one-command run script, README with architecture + honesty table, demo script.

**Read first:** `src/lib/contract.ts` (`LoopState`, `AGENT_ROUTES`, `PORTS`),
`src/lib/use-incident-sim.ts` (note: `SimState = LoopState` now),
`src/components/incident/incident-hero.tsx` (the one component you rewire).

**Your branch is testable before Person A finishes:** every task below verifies
against the sim fallback; the live path is re-verified at merge time.

---

### Task D1: live state hook

**Files:**
- Create: `src/lib/use-incident-live.ts`

- [ ] **Step 1: implement** (complete file):

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { LoopState } from "@/lib/contract";
import { AGENT_ROUTES } from "@/lib/contract";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "";

export type LiveStatus = "off" | "connecting" | "live" | "lost";

/**
 * Subscribes to the vigil-agent SSE stream. Each message is a full
 * LoopState snapshot — no event replay, no drift. When
 * NEXT_PUBLIC_AGENT_URL is unset the hook stays "off" and the caller
 * falls back to the scripted sim.
 */
export function useIncidentLive() {
  const [state, setState] = useState<LoopState | null>(null);
  const [status, setStatus] = useState<LiveStatus>(AGENT_URL ? "connecting" : "off");

  useEffect(() => {
    if (!AGENT_URL) return;
    const es = new EventSource(`${AGENT_URL}${AGENT_ROUTES.events}`);
    es.onopen = () => setStatus("live");
    es.onmessage = (e) => setState(JSON.parse(e.data) as LoopState);
    es.onerror = () => setStatus((s) => (s === "connecting" ? "connecting" : "lost"));
    return () => es.close();
  }, []);

  const post = useCallback((route: string) => {
    void fetch(`${AGENT_URL}${route}`, { method: "POST" }).catch(() => {});
  }, []);

  return {
    state,
    status,
    start: useCallback(() => post(AGENT_ROUTES.start), [post]),
    thrash: useCallback(() => post(AGENT_ROUTES.thrash), [post]),
    reset: useCallback(() => post(AGENT_ROUTES.reset), [post]),
  };
}
```

- [ ] **Step 2: verify** — `npx tsc --noEmit` passes.
- [ ] **Step 3: commit** — `git commit -m "feat: SSE live-state hook with sim fallback contract"`

---

### Task D2: rewire IncidentHero (live when available, sim otherwise)

**Files:**
- Modify: `src/components/incident/incident-hero.tsx`

- [ ] **Step 1: apply this change.** Replace the hook usage at the top of
`IncidentHero` and add a mode chip. The component currently starts:

```tsx
export function IncidentHero({ incident }: { incident: Incident }) {
  const { state, toggle, restart } = useIncidentSim();
```

Replace with:

```tsx
export function IncidentHero({ incident }: { incident: Incident }) {
  const sim = useIncidentSim();
  const live = useIncidentLive();
  const isLive = live.status === "live" && live.state !== null;
  const state = isLive ? live.state! : sim.state;
  const onToggle = isLive
    ? (!state.started || state.finished ? live.start : live.reset)
    : sim.toggle;
  const onRestart = isLive ? live.reset : sim.restart;
```

Add imports:

```tsx
import { useIncidentLive } from "@/lib/use-incident-live";
```

Update the two usages: `<SimControls state={state} onToggle={onToggle} onRestart={onRestart} />`
(everything else already reads `state`, which is unchanged in shape).

Add a mode indicator chip next to the SimControls (inside the same GlassCard,
right side) so the demo can point at it:

```tsx
<span
  className={
    "ml-3 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide " +
    (isLive
      ? "bg-emerald-500/15 text-emerald-500"
      : "bg-secondary text-muted-foreground")
  }
>
  {isLive ? "LIVE · real services" : "SIM · scripted"}
</span>
```

Place it by wrapping SimControls: `<div className="flex items-center"><div className="flex-1"><SimControls ... /></div><span ...>...</span></div>`.

- [ ] **Step 2: verify in the browser** — `npm run dev`, open
`http://localhost:3000/incidents/inc-4821`. With no backend running the chip
says "SIM · scripted" and Play runs the old sim exactly as before. `npx tsc
--noEmit` passes.

- [ ] **Step 3: commit** — `git commit -m "feat: incident hero prefers live orchestrator, falls back to sim"`

---

### Task D3: run scripts + env template

**Files:**
- Create: `.env.example`
- Create: `scripts/dev-all.sh`

- [ ] **Step 1: `.env.example`**:

```bash
# Copy to .env and fill in. Unset vars = local fallback (demo still works).
NEXT_PUBLIC_AGENT_URL=http://localhost:4000
PAYMENTS_URL=http://localhost:4100
GATE_URL=http://localhost:4200
POMERIUM_URL=http://localhost:4300   # unset to call payments-api directly
WORKER_URL=                          # Akash URL from Person C, or http://localhost:4400
ZERO_MODE=fallback                   # "live" once Person C lands Zero
ZERO_API_KEY=
ZERO_API_URL=
OPENAI_API_KEY=                      # optional LLM hypothesis step
OPENAI_MODEL=gpt-4o-mini             # override the hypothesis model if desired
```

- [ ] **Step 2: `scripts/dev-all.sh`**:

```bash
#!/usr/bin/env bash
# Starts every Vigil service for the demo. Ctrl-C stops them all.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then set -a; source .env; set +a; fi

for svc in payments-api gate vigil-agent; do
  if [ -d "services/$svc" ] && [ ! -d "services/$svc/node_modules" ]; then
    (cd "services/$svc" && npm install --silent)
  fi
done
[ -d node_modules ] || npm install --silent

pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT

if [ -d services/payments-api ]; then
  (cd services/payments-api && npx tsx src/index.ts) & pids+=($!)
fi
if [ -d services/gate ]; then
  (cd services/gate && npx tsx src/server.ts) & pids+=($!)
fi
if [ -d services/vigil-agent ]; then
  (cd services/vigil-agent && npx tsx src/server.ts) & pids+=($!)
fi

echo "──────────────────────────────────────────────"
echo " web      → http://localhost:3000/incidents/inc-4821"
echo " agent    → ${NEXT_PUBLIC_AGENT_URL:-unset (frontend stays in SIM mode)}"
echo " pomerium → run separately: see pomerium/README.md"
echo "──────────────────────────────────────────────"
npm run dev
```

Then: `chmod +x scripts/dev-all.sh`.

- [ ] **Step 3: verify** — on your branch (services don't exist yet) the script
skips the missing dirs and starts `npm run dev` cleanly; frontend loads in SIM
mode. That proves the guards work.

- [ ] **Step 4: commit** — `git commit -m "feat: one-command dev script + env template"`

---

### Task D4: README + demo script

**Files:**
- Rewrite: `README.md`
- Create: `docs/demo-script.md`

- [ ] **Step 1: `README.md`** — write it for a judge with 90 seconds. Required
sections, in order:

1. **One-liner:** "Vigil is an AI on-call engineer that fixes production
   incidents autonomously — while holding zero standing production
   credentials. Every destructive action needs a single-use, scoped,
   just-in-time grant."
2. **The loop** — 8 numbered beats (break → detect → context → Zero parser →
   Akash evidence → gate allow (single-use 60s grant) → rollback + recovery →
   escalation denied). Copy the beats from `docs/plans/2026-07-17-master.md`
   demo script.
3. **Architecture** — copy the ASCII diagram from the master plan.
4. **Sponsors, and precisely what each does** — table: Zero.xyz (per-call
   log-parse capability, receipts in `docs/zero-receipts.md`), Akash
   (diagnostic worker deployed at the URL in `services/diagnostic-worker/AKASH.md`),
   Pomerium (only path to destructive routes, `pomerium/`), OpenAI
   (hypothesis step, if enabled).
5. **What's real vs simulated** — copy the honesty table from the master plan
   verbatim. Judges reward this.
6. **Run it** — `cp .env.example .env`, `./scripts/dev-all.sh`, pomerium
   command from `pomerium/README.md`, open the incident URL, press Play.
7. **Repo tour** — one line per top-level dir.

- [ ] **Step 2: `docs/demo-script.md`** — copy the 3-minute script from the
master plan and expand each beat with: who's talking, what's on screen, what to
click, and the fallback line if something hiccups ("the loop is env-switched —
watch the audit strip, every action still gates").

- [ ] **Step 3: commit** — `git commit -m "docs: judge-facing README + 3-minute demo script"`

---

### Task D5 (STRETCH — only after D1–D4 pushed): compose + polish

- [ ] `docker-compose.yml` at repo root: `web`, `payments-api`, `gate`,
  `vigil-agent`, `pomerium` (build contexts `services/*`, image
  `pomerium/pomerium:latest` with the `pomerium/config.yaml` volume). Each
  Node service gets a `Dockerfile` mirroring the worker's (Person C's) —
  copy that pattern. Verify `docker compose up` end-to-end once. Do not let
  this eat rehearsal time.
- [ ] Video prep: 1080p screen area, browser at 100% zoom, dark theme,
  incident page pre-loaded, `scripts/dev-all.sh` running, one full rehearsal
  recorded as backup before the "real" take.

---

**Definition of done:** frontend runs in SIM mode with the new chip and
unchanged behavior; `npx tsc --noEmit` clean; README + demo script written;
dev script guards verified. Push the branch. Post "D done" in team chat.

**At merge time you also drive:** the final rehearsal and the 3-minute video
recording (you know the demo beats best).
