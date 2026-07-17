import { z, isDev, isProd, logConfig, parseEnv } from "../../shared/env";

/** Validated, typed configuration for the payments-api (mock prod) service. */
export const env = parseEnv("payments-api", {
  PORT: z.coerce.number().int().positive().default(4100),
  // Optional here (Phase 0 is non-behavioral); Phase 1 tightens this to
  // required-in-prod and makes the gate check fail closed.
  GATE_URL: z.string().url().optional(),
});

export { isDev, isProd };
export function logPaymentsConfig(): void {
  logConfig("payments-api", env);
}
