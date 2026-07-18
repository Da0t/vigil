You are an autonomous engineering agent working on the Vigil hackathon project. You will implement the ENTIRE "backbone" workstream end-to-end in one session and only stop when everything is done, verified, committed, and pushed. Do not stop to ask me questions or for confirmation — this is a time-boxed hackathon and I am not available to answer. Make reasonable decisions and keep going.

SETUP (do this first):
1. You are in a clone of git@github.com:Da0t/vigil.git. Run:
   git fetch origin && git checkout person-a-backbone && git pull origin person-a-backbone
2. Read these files fully before writing any code:
   - docs/plans/2026-07-17-master.md  (overall architecture, merge model, ownership zones, honesty table, demo script — the "why")
   - docs/plans/2026-07-17-person-a-backbone.md  (YOUR step-by-step plan — the "what" and "how")
   - src/lib/contract.ts  (the FROZEN cross-branch contract — every type/route/port you use comes from here)
   - src/lib/use-incident-sim.ts  (the scripted loop you are making real — reuse its audit copy, tone words, and step narrative so the UI reads identically)
   - shared/fixtures/payments.vlog  (sample of the weird log format your service emits)

HARD RULES (violating these breaks the team merge):
- You OWN: services/payments-api/** and services/vigil-agent/** — EXCEPT services/vigil-agent/src/integrations/zero-live.ts, which belongs to Person C. NEVER create or edit that file.
- You must NOT touch: frontend src/** (except you may read it), src/lib/contract.ts (frozen — do not edit even if tempting), services/gate/**, services/diagnostic-worker/**, pomerium/**.
- If you believe the contract genuinely must change, DO NOT change it. Instead work around it and write a note in a file called docs/CONTRACT-CHANGE-REQUEST-A.md explaining what and why, then continue.

EXECUTION:
- Work through docs/plans/2026-07-17-person-a-backbone.md task by task, in order: Task A1 → A2 → A3 → A4, then A5 only if A1–A4 are fully done and pushed.
- Follow TDD where the plan specifies tests (A3): write the failing test, run it, see it fail, implement, run it, see it pass.
- The plan contains complete code for every file. Type it out faithfully. If a snippet has an obvious bug or a TypeScript error, fix it and note the fix in your commit message — do not silently diverge from the contract's type names.
- Use Node with tsx (no build step) and Express, exactly as the plan specifies. Node v25 is installed. Services import contract types via relative path (e.g. ../../../src/lib/contract).
- After EACH task, run its verification block from the plan and confirm the expected output literally appears. If it doesn't, debug and fix before moving on — do not proceed on a broken task.
- Commit after each task with the exact commit message the plan gives.

MANDATORY END-TO-END VERIFICATION (this is your definition of done — do not claim completion until this passes on a clean run):
Run the Task A4 end-to-end sequence from the plan:
  1. Start payments-api:  cd services/payments-api && npx tsx src/index.ts &
  2. Start vigil-agent:    cd services/vigil-agent && npx tsx src/server.ts &
  3. curl -s -X POST localhost:4000/demo/start
  4. After ~6s, confirm /state shows incidentStatus "active" with a double-digit errorRate and early steps done/active.
  5. After ~18s total, confirm /state shows: incidentStatus "resolved", gateState "denied", grantConsumed true, denial present, finished true.
  6. curl -s -X POST localhost:4000/demo/reset
Also run: npx tsc --noEmit  (from repo root) — it MUST pass with zero errors. The frontend must still compile since you share contract.ts.
Clean up any background processes you started (kill the tsx servers).

FINISH:
- Push your branch: git push origin person-a-backbone
- Then write a final summary message telling me: which tasks completed, the exact output of the end-to-end verification (paste the /state fields), whether A5 (LLM hypothesis) was attempted, and anything the merge coordinator (me) needs to know — especially any place you diverged from the plan or hit a wall.
- ONLY stop after the branch is pushed and the end-to-end verification has passed. If you get stuck on one task for more than ~20 minutes, implement the simplest thing that makes that task's verification pass, leave a clear note in your summary, and continue to the next task — never halt the whole run over one blocker.
