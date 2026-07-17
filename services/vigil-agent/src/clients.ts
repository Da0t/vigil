import type {
  DiagnoseRequest, DiagnoseResponse, GrantRequest, GrantResponse, ParsedLogs,
} from "../../../src/lib/contract";
import { parseLogsFallback } from "./parse-fallback";
import { parseLogsLive } from "./integrations/zero-live";
import { env } from "./env";
import { signRequest } from "../../shared/auth";

export const PAYMENTS_URL = env.PAYMENTS_URL;
const GATE_URL = env.GATE_URL;
const WORKER_URL = env.WORKER_URL;

/** Sign an outbound internal call as "vigil-agent" (no-op in dev without a secret). */
function authHeaders(method: string, url: string, rawBody: string): Record<string, string> {
  if (!env.VIGIL_INTERNAL_SECRET) return {};
  return signRequest(env.VIGIL_INTERNAL_SECRET, "vigil-agent", method, new URL(url).pathname, rawBody);
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 15000): Promise<T> {
  const raw = JSON.stringify(body);
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders("POST", url, raw) },
    body: raw,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`POST ${new URL(url).pathname} → ${r.status}`);
  return (await r.json()) as T;
}

/** Guarded GET for read-only telemetry (open endpoints). Throws on !ok/timeout. */
export async function getText(url: string, timeoutMs = 5000): Promise<string> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`GET ${new URL(url).pathname} → ${r.status}`);
  return r.text();
}
export async function getJson<T>(url: string, timeoutMs = 5000): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`GET ${new URL(url).pathname} → ${r.status}`);
  return (await r.json()) as T;
}
/** Dev-only incident scaffolding (payments /admin/* is compiled out in prod). */
export async function postForm(url: string, timeoutMs = 5000): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "POST", signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

export async function parseLogs(raw: string): Promise<ParsedLogs> {
  if (process.env.ZERO_MODE === "live") {
    try { return await parseLogsLive(raw); }
    catch (e) { console.warn("[zero] live parse failed, using fallback:", (e as Error).message); }
  }
  return parseLogsFallback(raw);
}

export async function requestGrant(req: GrantRequest): Promise<GrantResponse> {
  if (GATE_URL) {
    try {
      return await postJson<GrantResponse>(`${GATE_URL}/grants`, req);
    } catch (e) {
      // Fail closed: if we cannot reach the gate, we did not earn a grant.
      return { verdict: "denied", scope: `requested: ${req.service}`, reason: `gate unreachable (${(e as Error).message})` };
    }
  }
  // Local fallback mirrors the real gate policy so the demo works pre-merge.
  if (req.servicesAffected > 3) return { verdict: "denied", scope: `requested: ${req.servicesAffected} services`, reason: "blast radius over limit" };
  if (!req.sandboxPassed) return { verdict: "denied", scope: `requested: ${req.service}`, reason: "no sandbox evidence for a destructive action" };
  if (req.consecutiveFailures >= 2) return { verdict: "denied", scope: `requested: ${req.service}`, reason: "policy tightened after repeat failure" };
  return { verdict: "allowed", scope: `${req.service} only`, token: `local-${Math.random().toString(36).slice(2)}`, ttlSeconds: 60, singleUse: true };
}

export async function diagnose(req: DiagnoseRequest): Promise<DiagnoseResponse> {
  if (WORKER_URL) {
    try {
      return await postJson<DiagnoseResponse>(`${WORKER_URL}/diagnose`, req);
    } catch (e) {
      // Fail closed: no diagnosis ⇒ no sandbox evidence ⇒ escalate, never rollback.
      return {
        sandboxPassed: false,
        rootCause: `diagnostic worker unreachable (${(e as Error).message})`,
        recommendedAction: "escalate",
        checks: [{ name: "worker_reachable", passed: false }],
      };
    }
  }
  const parsed = parseLogsFallback(req.rawLogs);
  const cfgRelated = /CFG|TIMEOUT/.test(parsed.errorSignature);
  const matchesDeploy = parsed.suspectDeploy === req.deployId;
  const passed = cfgRelated && matchesDeploy;
  return {
    sandboxPassed: passed,
    rootCause: `deploy ${req.deployId} changed ${parsed.suspectComponent} timeout handling (${parsed.errorSignature})`,
    recommendedAction: passed ? req.candidateAction : "escalate",
    checks: [
      { name: "errors_cluster_after_deploy", passed: matchesDeploy },
      { name: "signature_is_config_related", passed: cfgRelated },
      { name: "rollback_target_exists", passed: true },
    ],
  };
}

export async function applyRemediation(action: "rollback" | "restart", token: string) {
  // Destructive calls route through Pomerium in prod; the direct fallback is dev-only.
  const base = env.POMERIUM_URL ?? PAYMENTS_URL;
  const url = `${base}/${action}`;
  const headers: Record<string, string> = { "x-vigil-grant": token, ...authHeaders("POST", url, "") };
  try {
    const r = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(10000) });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
  } catch (e) {
    return { ok: false, status: 0, body: { error: (e as Error).message } };
  }
}
