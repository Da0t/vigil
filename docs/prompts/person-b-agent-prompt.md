You are an autonomous engineering agent working on the Vigil hackathon project. You will implement the ENTIRE "gate" workstream end-to-end in one session and only stop when everything is done, verified, committed, and pushed. Do not stop to ask me questions or for confirmation — this is a time-boxed hackathon and I am not available to answer. Make reasonable decisions and keep going.

CONTEXT: Your workstream is the technical heart of the whole project — the single-use, scoped, just-in-time permission gate that lets Vigil fix production without holding standing credentials. It is degradation priority #1: the gate service with real single-use grants MUST work; Pomerium routing layers on top of it.

SETUP (do this first):
1. You are in a clone of git@github.com:Da0t/vigil.git. Run:
   git fetch origin && git checkout person-b-gate && git pull origin person-b-gate
2. Read these files fully before writing any code:
   - docs/plans/2026-07-17-master.md  (overall architecture, merge model, ownership zones, honesty table — the "why")
   - docs/plans/2026-07-17-person-b-gate.md  (YOUR step-by-step plan — the "what" and "how")
   - src/lib/contract.ts  (the FROZEN contract — GrantRequest, GrantResponse, VerifyRequest, VerifyResponse, PORTS all come from here)
3. Understand your two callers (both from the contract): vigil-agent POSTs a GrantRequest to /grants and expects a GrantResponse; payments-api POSTs a VerifyRequest to /grants/verify on every destructive call and expects a VerifyResponse — and verification CONSUMES the grant (single-use).

HARD RULES (violating these breaks the team merge):
- You OWN: services/gate/** and pomerium/** ONLY.
- You must NOT touch: services/vigil-agent/**, services/payments-api/**, services/diagnostic-worker/**, frontend src/**, and especially NOT src/lib/contract.ts (frozen — do not edit even if tempting).
- If you believe the contract genuinely must change, DO NOT change it. Work around it and write docs/CONTRACT-CHANGE-REQUEST-B.md explaining what and why, then continue.

POLICY THRESHOLDS (must match the demo story exactly — rule ORDER matters):
Evaluate in this order so the thrash denial reads "blast radius over limit":
  1. blast radius: deny if servicesAffected > 3
  2. sandbox: deny destructive action if sandboxPassed is false
  3. budget: deny if budgetUsed > $5
  4. repeat failure: deny if consecutiveFailures (self-reported) OR gate-observed denials for this requester+action >= 2
Otherwise allow, minting a single-use token with a 60-second TTL scoped to exactly one action + one service.

EXECUTION:
- Work through docs/plans/2026-07-17-person-b-gate.md task by task, in order: Task B1 → B2 → B3 → B4.
- Follow TDD strictly for B1 and B2: write the failing test file, run it (npx tsx src/<name>.test.ts), watch it fail, implement, run again, watch all assertions pass. These tests are your safety net for the most important component in the project — do not skip them.
- The plan contains complete code for every file. Type it faithfully. Fix any obvious TS error and note it in the commit.
- Use Node with tsx and Express. Node v25 is installed. Import contract types via relative path (../../../src/lib/contract).
- For B4 (Pomerium): FIRST fetch the current Pomerium docs (pomerium.com/docs — routes + policy for Pomerium Core, docker quickstart) and correct the config.yaml in the plan to current syntax rather than trusting the snippet blindly. The goal: /rollback and /restart route through Pomerium (:4300 → payments-api :4100) and NOTHING else in prod is routable through it. If Pomerium policy syntax fights you for more than ~30 minutes, keep the layered model (Pomerium restricts routes; payments-api still verifies the single-use grant with your gate on every call), document exactly what you verified in pomerium/README.md, and move on — the grant enforcement is already real at the service.
- After EACH task run its verification block and confirm the expected output literally appears. Commit after each task with the exact message the plan gives. End every commit message body with:
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

MANDATORY VERIFICATION (definition of done — do not claim completion until all pass):
1. Unit tests: npx tsx src/policy.test.ts  AND  npx tsx src/grants.test.ts — every assertion passes.
2. Full grant lifecycle by hand (from Task B3), with the gate running (cd services/gate && npx tsx src/server.ts &):
   a. POST /grants with a scoped sandbox-backed rollback → verdict "allowed", a vg_ token, ttlSeconds 60, singleUse true.
   b. POST /grants/verify with that token → {"valid":true}.
   c. POST /grants/verify with the SAME token again → {"valid":false,"reason":"grant already used"}  (proves single-use).
   d. POST /grants with mass-restart / 12 services → verdict "denied", reason "blast radius over limit".
   e. GET /grants → shows the decision log with the recorded decisions.
3. Pomerium: /rollback is routed (non-502) and a non-destructive path like /logs returns 404 through :4300 (proves only the two destructive paths are reachable). If you fell back to the layered-only model, that's acceptable — just make it explicit in pomerium/README.md.
4. Clean up any background processes you started.

FINISH:
- Push your branch: git push origin person-b-gate
- Then write a final summary telling me: which tasks completed, the exact output of the grant-lifecycle checks (paste the allow/verify-once/verify-twice/deny responses), what Pomerium enforcement level you achieved (real policy vs layered-only) and why, and anything the merge coordinator (me) needs to know — especially any divergence from the plan.
- ONLY stop after the branch is pushed and the verification above has passed. If one task blocks you for more than ~20 minutes, implement the simplest thing that makes its verification pass, note it in your summary, and continue — never halt the whole run over a single blocker. The gate policy + single-use grants (B1–B3) are non-negotiable; Pomerium (B4) can degrade to the layered model if needed.
