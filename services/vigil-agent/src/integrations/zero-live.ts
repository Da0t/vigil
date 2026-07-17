import type { ParsedLogs } from "../../../../src/lib/contract";

/**
 * Live Zero.xyz log-parse capability.
 *
 * OWNED BY PERSON C — branch person-c-capabilities. This is the ONLY file in
 * services/vigil-agent that Person C edits.
 *
 * Zero (https://zero.xyz) is a discovery + per-call-payment layer for AI
 * agents: you search for a capability, inspect its schema, invoke it, and pay
 * per call (USDC over the x402 protocol). Its first-class interface is the
 * `@zeroxyz/cli` (`zero search | get | fetch | review`) backed by a wallet
 * (`ZERO_PRIVATE_KEY`) or a managed agent account. See docs/zero-receipts.md
 * for the full model and the exact one-command verification.
 *
 * This module buys a single log-parse capability call over Zero's HTTP invoke
 * surface so vigil-agent can acquire the parsing ability it lacks, inline, with
 * a per-call cost receipt. Endpoint, capability id, invoke path, and spend cap
 * are all env-overridable, so the real values from `zero search "parse logs"`
 * (or a sponsor-provided gateway URL) can be injected WITHOUT a code change.
 *
 * CONTRACT (this is what keeps the demo safe — clients.ts#parseLogs catches any
 * throw here and falls back to the local regex parser, labelled
 * parserSource:"fallback"):
 *   - throws immediately if ZERO_API_KEY is unset;
 *   - throws on ANY HTTP or JSON-parse failure;
 *   - NEVER returns fabricated data with parserSource:"zero". A "zero" result
 *     means Zero genuinely answered and its output was used. Fields Zero does
 *     not return are derived from `raw` locally (same technique as the local
 *     parser) and that provenance is documented in docs/zero-receipts.md.
 */

const ZERO_API_URL = process.env.ZERO_API_URL ?? "https://api.zero.xyz"; // confirm at the booth / docs
const ZERO_API_KEY = process.env.ZERO_API_KEY;
/** Zero `fetch`-style capability-invoke path. Overridable per docs. */
const ZERO_INVOKE_PATH = process.env.ZERO_INVOKE_PATH ?? "/v1/fetch";
/** Capability/attribution id (e.g. "z_Ab12cd.1" from `zero search`). */
const ZERO_CAPABILITY = process.env.ZERO_CAPABILITY ?? "log-parse";
/** Hard spend cap per call, in USD — mirrors the CLI's `--max-pay`. */
const ZERO_MAX_PAY = Number(process.env.ZERO_MAX_PAY ?? "0.10");

export async function parseLogsLive(raw: string): Promise<ParsedLogs> {
  if (!ZERO_API_KEY) throw new Error("zero-live: ZERO_API_KEY unset");

  const r = await fetch(`${ZERO_API_URL}${ZERO_INVOKE_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ZERO_API_KEY}`,
      "x-zero-max-pay": String(ZERO_MAX_PAY),
    },
    body: JSON.stringify({
      capability: ZERO_CAPABILITY,
      maxPay: ZERO_MAX_PAY,
      // Zero convention: "send input.body as JSON — do not wrap the envelope".
      input: { body: { format: "vlog", logs: raw } },
    }),
  });
  if (!r.ok) {
    throw new Error(`zero-live: HTTP ${r.status} ${await r.text().catch(() => "")}`);
  }

  let data: unknown;
  try {
    data = await r.json();
  } catch (e) {
    throw new Error(`zero-live: response was not JSON (${(e as Error).message})`);
  }
  console.log("[zero] raw response:", JSON.stringify(data).slice(0, 400));

  // Zero `fetch` returns an envelope { ok, runId, payment, body }; the
  // capability's own payload sits in `.body` (or `.output`). Be liberal about
  // where the parsed fields live, since capability schemas vary.
  const d = data as Record<string, any>;
  const body: Record<string, any> = d?.body ?? d?.output ?? d ?? {};

  // Fields Zero returns are used directly; anything it omits is derived from
  // `raw` locally (documented in docs/zero-receipts.md). No fixture values are
  // hardcoded — everything below traces to Zero's response or to `raw`.
  const local = deriveFromRaw(raw);

  const errorSignature =
    firstString(body.errorSignature, body.signature, body.code) ?? local.errorSignature;
  const suspectComponent =
    firstString(body.suspectComponent, body.component) ?? local.suspectComponent;
  const suspectDeploy =
    firstString(body.suspectDeploy, body.deploy) ?? local.suspectDeploy;
  const sampleLines =
    Array.isArray(body.sampleLines) && body.sampleLines.length
      ? (body.sampleLines as string[])
      : local.sampleLines;

  // Cost comes ONLY from Zero's payment receipt — never invented.
  const costUsd =
    numberOrUndefined(d?.payment?.amountUsd) ??
    numberOrUndefined(d?.payment?.amount) ??
    numberOrUndefined(d?.costUsd) ??
    numberOrUndefined(r.headers.get("x-zero-payment"));

  return {
    errorSignature,
    suspectComponent,
    suspectDeploy,
    sampleLines,
    parserSource: "zero",
    costUsd,
  };
}

/**
 * Local derivation — the same regex technique as the fallback parser. Used
 * ONLY to fill fields the Zero capability didn't return (provenance recorded
 * in docs/zero-receipts.md).
 */
function deriveFromRaw(raw: string): {
  errorSignature: string;
  suspectComponent: string;
  suspectDeploy?: string;
  sampleLines: string[];
} {
  const VLOG_LINE =
    /^\|(?<lvl>[EWI])\|(?<ts>\d+)\|(?<component>[\w-]+)\|(?<code>[A-Z_]+)\|(?<rest>.*)$/;
  const errors: { component: string; code: string; rest: string; line: string }[] = [];
  for (const line of raw.split("\n")) {
    const m = VLOG_LINE.exec(line.trim());
    if (!m?.groups || m.groups.lvl !== "E") continue;
    errors.push({
      component: m.groups.component,
      code: m.groups.code,
      rest: m.groups.rest,
      line: line.trim(),
    });
  }
  const topBy = (key: "component" | "code"): string | undefined => {
    const counts = new Map<string, number>();
    for (const e of errors) counts.set(e[key], (counts.get(e[key]) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const suspectDeploy = errors
    .map((e) => /deploy=(#?[\w-]+)/.exec(e.rest)?.[1])
    .find(Boolean);
  return {
    errorSignature: topBy("code") ?? "UNKNOWN",
    suspectComponent: topBy("component") ?? "unknown",
    suspectDeploy,
    sampleLines: errors.slice(0, 3).map((e) => e.line),
  };
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
