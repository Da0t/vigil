# Vigil — 3-minute demo script

**Roles:** Person A narrates. Person D drives (clicks). Total run time **3:00**.

**Before recording:** 1080p screen area · browser at 100% zoom · dark theme ·
`./scripts/dev-all.sh` running with the orchestrator up (chip reads
`LIVE · real services`) · incident page pre-loaded at
`http://localhost:3000/incidents/inc-4821` · one full rehearsal recorded as a
backup take.

**Universal fallback line (say it if any beat hiccups):** *"The loop is
env-switched — watch the audit strip, every action still gates."* If the live
orchestrator drops, the chip flips to `SIM · scripted` and the exact same loop
plays deterministically; keep narrating, nothing about the story changes.

---

### Beat 1 — The thesis · 0:00–0:20 (20s)
- **A (narrating):** "Vigil is an on-call engineer that holds **zero**
  production credentials."
- **On screen:** the incident page, idle. Telemetry steady, timeline pending,
  the `LIVE · real services` chip next to the controls.
- **D clicks:** nothing yet — rest on the header and the chip.
- **Fallback:** if the chip shows `SIM`, say "running the scripted twin today"
  and continue — the beats are identical.

### Beat 2 — Break + detect · 0:20–0:50 (30s)
- **A:** "It's a real service. Watch it break — and watch Vigil notice before a
  human would."
- **On screen:** the error-rate chart climbs as `payments-api` serves real 500s
  into the live traffic loop; the incident opens; the timeline's *detect* and
  *context* steps light up (governed read of deploy `#4821`).
- **D clicks:** **Play incident** (Start).
- **Fallback:** if the curve looks flat, point at the audit strip — "detection
  is a real threshold on the measured rate."

### Beat 3 — Zero parser + Akash evidence · 0:50–1:40 (50s)
- **A:** "The logs are unreadable, so Vigil **buys** a parser — one call, priced
  per use — then ships the evidence to a sandbox on Akash to reproduce it."
- **On screen:** timeline advances — *capability* step shows the **Zero**
  log-parse call **with its cost**; then the **Akash** worker provisions, runs,
  and returns `sandbox_passed=true · recommended_action=rollback`; sandbox tears
  down (no residue).
- **D clicks:** nothing — let the timeline run; hover the Zero cost and the
  Akash result.
- **Fallback:** "capability and worker are env-switched; the receipts are in
  `docs/zero-receipts.md` and `services/diagnostic-worker/AKASH.md`."

### Beat 4 — The gate: scoped, single-use grant · 1:40–2:20 (40s)
- **A:** "Every destructive action goes through Pomerium and a policy gate. The
  grant is **scoped to payments-api, single-use, 60-second TTL** — then the
  rollback runs, the curve recovers, and the credential is **spent**."
- **On screen:** the gate panel shows checks passing; grant issued
  (scope + single-use + 60s TTL); rollback applies through the gated path; the
  error-rate curve drops to baseline; the credential flips to **consumed**,
  `standing credentials: 0`.
- **D clicks:** nothing (live path auto-advances). *If in SIM:* it advances on
  its own too.
- **Fallback:** "the token is single-use — a second attempt to reuse it fails;
  the audit strip records the consumption."

### Beat 5 — The clamp: escalation denied · 2:20–2:45 (25s)
- **A:** "Now watch it overreach. It asks to mass-restart 12 services — and the
  gate says **no**. Blast radius over limit; policy tightens."
- **On screen:** the agent requests a mass-restart across 12 services; the gate
  **denies** it; the blast-radius panel shows the limit tripped; the audit strip
  shows the full attributed story.
- **D clicks:** **Thrash / escalate** control (or let the scripted beat fire).
- **Fallback:** "the denial is the point — blast radius is a hard policy limit,
  not a suggestion."

### Beat 6 — The close · 2:45–3:00 (15s)
- **A:** "Every action attributed, every credential **dead after one use**.
  Zero standing production access."
- **On screen:** audit strip full of the run; the `standing credentials: 0`
  readout; the recovered curve.
- **D clicks:** nothing — hold the frame.
- **Fallback:** end on the audit strip regardless of live/sim — it's the same
  story.
