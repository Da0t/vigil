import { z, isDev, isProd, logConfig, parseEnv, requiredInProd } from "../../shared/env";

/** Validated, typed configuration for the gate service. */
export const env = parseEnv("gate", {
  PORT: z.coerce.number().int().positive().default(4200),
  // Shared secret authenticating internal callers (the agent, payments-api).
  // Required in prod; unset in dev disables auth (fail convenient).
  VIGIL_INTERNAL_SECRET: requiredInProd(z.string().min(16)),
  // Secret the worker signs sandbox attestations with. The gate verifies them;
  // the agent never holds this, so it cannot forge sandbox evidence.
  WORKER_ATTEST_SECRET: requiredInProd(z.string().min(16)),
  // Shared grant store. Required in prod so single-use holds across replicas and
  // survives restarts; unset in dev ⇒ zero-dependency in-memory store.
  REDIS_URL: requiredInProd(z.string().url()),
});

/** Internal auth is enforced in prod, or in dev when a secret is explicitly set. */
export const AUTH_ENABLED = isProd || !!env.VIGIL_INTERNAL_SECRET;
/** Attestation is verified in prod, or in dev when the attest secret is set. */
export const ATTEST_ENABLED = isProd || !!env.WORKER_ATTEST_SECRET;

export { isDev, isProd };
export function logGateConfig(): void {
  logConfig("gate", env);
}
