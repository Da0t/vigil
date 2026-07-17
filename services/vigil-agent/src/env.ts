import { z, isDev, isProd, logConfig, parseEnv, requiredInProd } from "../../shared/env";

/** Validated, typed configuration for the vigil-agent orchestrator. */
export const env = parseEnv("vigil-agent", {
  PORT: z.coerce.number().int().positive().default(4000),
  PAYMENTS_URL: z.string().url().default("http://localhost:4100"),
  // Required in prod: the agent must have a gate and a worker to earn grants
  // and to produce verifiable sandbox evidence. Optional in dev (local fallback).
  GATE_URL: requiredInProd(z.string().url()),
  WORKER_URL: requiredInProd(z.string().url()),
  POMERIUM_URL: requiredInProd(z.string().url()),
  ZERO_MODE: z.enum(["live", "fallback"]).default("fallback"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  // Shared secret used to sign every outbound internal call (gate, worker,
  // payments). Required in prod; unset in dev sends unsigned (fail convenient).
  VIGIL_INTERNAL_SECRET: requiredInProd(z.string().min(16)),
});

/** Sign outbound internal calls in prod, or in dev when a secret is set. */
export const AUTH_ENABLED = isProd || !!env.VIGIL_INTERNAL_SECRET;

export { isDev, isProd };
export function logAgentConfig(): void {
  logConfig("vigil-agent", env);
}
