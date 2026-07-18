/**
 * Shared environment loading + validation for every Vigil backend service.
 *
 * The core Vigil pattern is "fail closed in prod, fail convenient in dev":
 *   - In development an unset var falls back to a local default, so the demo
 *     runs with zero external dependencies and zero secrets.
 *   - In production a missing *required* var throws at boot (fail fast) and
 *     security-relevant fallbacks are compiled out.
 *
 * `VIGIL_ENV` (preferred) or `NODE_ENV` selects the mode. Anything other than
 * "production" is treated as development.
 *
 * NOTE: this module lives outside any single service's Docker build context, so
 * — like src/lib/contract.ts — the prod images copy it in explicitly (see the
 * service Dockerfiles). The diagnostic-worker, which is deployed standalone to
 * Akash with an isolated build context, keeps its own self-contained copy.
 */
import { z, type ZodTypeAny, type ZodRawShape, type ZodObject, type infer as zInfer } from "zod";

/**
 * Re-export the single shared zod instance. Every backend service builds its
 * schemas with THIS `z` (import it from here, not from "zod" directly) so that
 * all schemas and the helpers below share one module instance — zod uses
 * `instanceof` internally, which silently breaks across duplicate installs.
 */
export { z };

export const VIGIL_ENV = process.env.VIGIL_ENV ?? process.env.NODE_ENV ?? "development";
export const isProd = VIGIL_ENV === "production";
export const isDev = !isProd;

/**
 * A field that is optional in development (local fallback) but REQUIRED in
 * production (fail closed). This is the primitive that encodes the golden rule:
 * dev keeps its conveniences, prod refuses to boot without the real value.
 */
export function requiredInProd<T extends ZodTypeAny>(schema: T): T | z.ZodOptional<T> {
  return isProd ? schema : schema.optional();
}

/**
 * Parse process.env against a service-specific schema. On failure, throw one
 * readable error listing every problem — so a misconfigured prod deploy dies at
 * boot with a precise message instead of failing mysteriously at request time.
 */
export function parseEnv<T extends ZodRawShape>(service: string, shape: T): zInfer<ZodObject<T>> {
  const result = z.object(shape).safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new Error(
      `[${service}] invalid environment (VIGIL_ENV=${VIGIL_ENV}):\n${lines.join("\n")}`,
    );
  }
  return result.data;
}

const SECRET_KEY = /(secret|key|token|password|passphrase)/i;

/** Redact secret-ish values so config can be logged safely at boot. */
export function redact(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    out[k] =
      typeof v === "string" && v.length > 0 && SECRET_KEY.test(k)
        ? `${v.slice(0, 3)}…(len ${v.length})`
        : v;
  }
  return out;
}

/** Log the resolved, validated config once at boot (secrets redacted). */
export function logConfig(service: string, config: Record<string, unknown>): void {
  console.log(
    `[${service}] resolved config (env=${VIGIL_ENV}): ${JSON.stringify(redact(config))}`,
  );
}
