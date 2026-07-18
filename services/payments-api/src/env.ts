import { z, isDev, isProd, logConfig, parseEnv, requiredInProd } from "../../shared/env";

/** Validated, typed configuration for the payments-api (mock prod) service. */
export const env = parseEnv("payments-api", {
  PORT: z.coerce.number().int().positive().default(4100),
  // Required in prod: no gate configured ⇒ refuse to boot. In dev, unset ⇒ the
  // ungated local fallback path stays available (fail convenient).
  GATE_URL: requiredInProd(z.string().url()),
  // Shared secret: verifies inbound destructive calls AND signs the outbound
  // grant-verify call to the gate.
  VIGIL_INTERNAL_SECRET: requiredInProd(z.string().min(16)),
});

/** Internal auth is enforced in prod, or in dev when a secret is explicitly set. */
export const AUTH_ENABLED = isProd || !!env.VIGIL_INTERNAL_SECRET;

export { isDev, isProd };
export function logPaymentsConfig(): void {
  logConfig("payments-api", env);
}
