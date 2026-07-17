import type { GrantRequest, GrantResponse } from "../../../src/lib/contract";

export interface PolicyContext {
  blastThreshold: number;
  budgetMax: number;
  maxConsecutiveFailures: number;
  /** Failures/denials the gate itself has recorded for this requester+action. */
  observedFailures: number;
}

export const DEFAULT_CONTEXT: PolicyContext = {
  blastThreshold: 3,
  budgetMax: 5,
  maxConsecutiveFailures: 2,
  observedFailures: 0,
};

export function evaluatePolicy(
  req: GrantRequest,
  ctx: PolicyContext
): Pick<GrantResponse, "verdict" | "scope" | "reason"> {
  const failures = Math.max(req.consecutiveFailures, ctx.observedFailures);
  if (req.servicesAffected > ctx.blastThreshold) {
    return { verdict: "denied", scope: `requested: ${req.servicesAffected} services`, reason: "blast radius over limit" };
  }
  if (!req.sandboxPassed) {
    return { verdict: "denied", scope: `requested: ${req.service}`, reason: "no sandbox evidence for a destructive action" };
  }
  if (req.budgetUsed > ctx.budgetMax) {
    return { verdict: "denied", scope: `requested: ${req.service}`, reason: "incident budget exhausted" };
  }
  if (failures >= ctx.maxConsecutiveFailures) {
    return { verdict: "denied", scope: `requested: ${req.service}`, reason: "policy tightened after repeat failure" };
  }
  return { verdict: "allowed", scope: `${req.service} only` };
}
