import { z, isDev, isProd, logConfig, parseEnv } from "../../shared/env";

/** Validated, typed configuration for the vigil-agent orchestrator. */
export const env = parseEnv("vigil-agent", {
  PORT: z.coerce.number().int().positive().default(4000),
  PAYMENTS_URL: z.string().url().default("http://localhost:4100"),
  GATE_URL: z.string().url().optional(),
  POMERIUM_URL: z.string().url().optional(),
  WORKER_URL: z.string().url().optional(),
  ZERO_MODE: z.enum(["live", "fallback"]).default("fallback"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
});

export { isDev, isProd };
export function logAgentConfig(): void {
  logConfig("vigil-agent", env);
}
