import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ParsedLogs } from "../../../../src/lib/contract";

const run = promisify(execFile);

/**
 * Live Zero.xyz log-parse capability — Vigil lacks the ability to turn its
 * cryptic .vlog lines into structured fields, so it *buys* that capability from
 * Zero on demand, paying per call in USDC over the x402 protocol.
 *
 * Zero's primary interface is its CLI (`@zeroxyz/cli`), which handles the 402
 * payment challenge and wallet signing for us — so instead of re-implementing
 * x402 we shell out to `zero fetch`. The demo machine must be signed in once
 * (`zero auth login`); the $5 starter credit covers ~150 calls.
 *
 * Capability: "402.com.tr AI Field Extractor"
 * (402-com-tr-ai-field-extractor-a6518290,
 * https://402.com.tr/api/x402/ai-extract) — an LLM-backed extractor
 * (Claude Haiku) that pulls named fields out of arbitrary text as JSON,
 * surfaced by `zero search "extract fields from text"`. It reliably parses
 * Vigil's bespoke format where a naive regex can't. Every value is
 * env-overridable so a different capability can be swapped in without a code
 * change.
 *
 * SAFETY CONTRACT (clients.ts#parseLogs catches any throw here and falls back
 * to the local regex parser, labelled parserSource:"fallback"):
 *   - throws on non-zero CLI exit, non-ok run, or missing extracted fields;
 *   - NEVER returns fabricated data with parserSource:"zero" — a "zero" result
 *     means Zero genuinely ran, was paid, and returned the fields we use.
 */
const ZERO_BIN = process.env.ZERO_BIN ?? "zero";
const ZERO_CAPABILITY = process.env.ZERO_CAPABILITY ?? "402-com-tr-ai-field-extractor-a6518290";
const ZERO_URL = process.env.ZERO_URL ?? "https://402.com.tr/api/x402/ai-extract";
const ZERO_FIELDS = process.env.ZERO_FIELDS ?? "errorSignature,suspectComponent,suspectDeploy,errorCount";
const ZERO_MAX_PAY = process.env.ZERO_MAX_PAY ?? "0.10";

export async function parseLogsLive(raw: string): Promise<ParsedLogs> {
  const q = `text=${encodeURIComponent(raw)}&fields=${encodeURIComponent(ZERO_FIELDS)}`;
  const url = `${ZERO_URL}?${q}`;

  let stdout: string;
  try {
    const res = await run(
      ZERO_BIN,
      ["fetch", "--capability", ZERO_CAPABILITY, "--json", "-X", "GET", "--max-pay", ZERO_MAX_PAY, url],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }
    );
    stdout = res.stdout;
  } catch (e) {
    throw new Error(`zero-live: 'zero fetch' failed (${(e as Error).message}). Signed in? run 'zero auth login'`);
  }

  let env: { ok?: boolean; status?: number; payment?: Record<string, unknown>; body?: any };
  try {
    env = JSON.parse(stdout);
  } catch {
    throw new Error(`zero-live: could not parse CLI JSON: ${stdout.slice(0, 200)}`);
  }
  if (!env.ok) throw new Error(`zero-live: run not ok (status ${env.status ?? "?"})`);

  // Extracted fields live at body.data.data (the extractor nests them); be
  // liberal in case a swapped capability returns a flatter shape.
  const body = env.body ?? {};
  const fields: Record<string, any> = body?.data?.data ?? body?.data ?? body ?? {};
  console.log("[zero] extracted:", JSON.stringify(fields).slice(0, 200));

  const errorSignature = firstString(fields.errorSignature, fields.signature, fields.code);
  const suspectComponent = firstString(fields.suspectComponent, fields.component, fields.service);
  if (!errorSignature || !suspectComponent) {
    throw new Error(`zero-live: capability returned no usable fields (${JSON.stringify(fields).slice(0, 120)})`);
  }
  const suspectDeploy = firstString(fields.suspectDeploy, fields.deploy);

  // sampleLines are just the real error lines for display — cheap to take from
  // raw; the diagnostic value (which component/code/deploy) came from Zero.
  const sampleLines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\|E\|/.test(l))
    .slice(0, 3);

  const costUsd =
    numberOrUndefined(env.payment?.amountUsd) ??
    numberOrUndefined(env.payment?.amount) ??
    numberOrUndefined((env.payment as any)?.total);

  return { errorSignature, suspectComponent, suspectDeploy, sampleLines, parserSource: "zero", costUsd };
}

function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === "string" && v.length) return v;
  return undefined;
}

function numberOrUndefined(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
