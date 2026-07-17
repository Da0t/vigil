import { z, isDev, isProd, logConfig, parseEnv } from "../../shared/env";

/** Validated, typed configuration for the gate service. */
export const env = parseEnv("gate", {
  PORT: z.coerce.number().int().positive().default(4200),
});

export { isDev, isProd };
export function logGateConfig(): void {
  logConfig("gate", env);
}
