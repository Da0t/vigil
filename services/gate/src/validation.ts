import { z } from "../../shared/env";

/** Boundary schema for POST /grants (mirrors contract.ts GrantRequest). */
export const grantRequestSchema = z.object({
  action: z.enum(["rollback", "restart", "mass-restart"]),
  service: z.string().min(1),
  servicesAffected: z.number().int().nonnegative(),
  sandboxPassed: z.boolean(),
  budgetUsed: z.number().nonnegative(),
  consecutiveFailures: z.number().int().nonnegative(),
  requestedBy: z.string().min(1),
  deployId: z.string().min(1).optional(),
  attestation: z.string().min(1).optional(),
});

/** Boundary schema for POST /grants/verify (mirrors contract.ts VerifyRequest). */
export const verifyRequestSchema = z.object({
  token: z.string().min(1),
  action: z.string().min(1),
  service: z.string().min(1),
});
