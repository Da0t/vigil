/**
 * Self-contained env validation for the diagnostic worker.
 *
 * Like contract-lite.ts, this is intentionally standalone: the worker is built
 * into a Docker image whose build context is ONLY this folder, so it cannot
 * import ../../shared/env. Keep the "fail closed in prod" behavior consistent
 * with services/shared/env.ts by hand.
 */
import { z } from "zod";

const VIGIL_ENV = process.env.VIGIL_ENV ?? process.env.NODE_ENV ?? "development";
export const isProd = VIGIL_ENV === "production";
export const isDev = !isProd;

// Required in prod, optional in dev (fail closed in prod, fail convenient in dev).
const secret = isProd ? z.string().min(16) : z.string().min(16).optional();

const result = z
  .object({
    PORT: z.coerce.number().int().positive().default(4400),
    // Verifies inbound /diagnose calls from the agent.
    VIGIL_INTERNAL_SECRET: secret,
    // Signs the sandbox attestation the gate later verifies.
    WORKER_ATTEST_SECRET: secret,
  })
  .safeParse(process.env);

if (!result.success) {
  const lines = result.error.issues.map(
    (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
  );
  throw new Error(
    `[diagnostic-worker] invalid environment (VIGIL_ENV=${VIGIL_ENV}):\n${lines.join("\n")}`,
  );
}

export const env = result.data;

/** Internal auth is enforced in prod, or in dev when a secret is explicitly set. */
export const AUTH_ENABLED = isProd || !!env.VIGIL_INTERNAL_SECRET;
/** Sign attestations in prod, or in dev when the attest secret is set. */
export const ATTEST_ENABLED = isProd || !!env.WORKER_ATTEST_SECRET;

export function logWorkerConfig(): void {
  console.log(
    `[diagnostic-worker] resolved config (env=${VIGIL_ENV}): ${JSON.stringify(env)}`,
  );
}
