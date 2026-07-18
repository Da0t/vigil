/**
 * Shared wire contract between the Vigil frontend, the vigil-agent
 * orchestrator, the gate service, and the Akash diagnostic worker.
 *
 * This file is the single source of truth for every cross-branch
 * interface. It lands on main BEFORE the person-a..d branches are cut.
 * Do not edit it on a feature branch without telling the whole team.
 */
import type {
  AgentStep,
  AuditEntry,
  GateDecision,
  IncidentStatus,
  SandboxResult,
} from "./types";

export type GateState = "idle" | "pending" | "allowed" | "denied";

/**
 * The full UI state. The scripted sim builds it locally; the live
 * orchestrator streams it as JSON snapshots over SSE. Same shape, so
 * every existing component works in both modes.
 */
export interface LoopState {
  clock: number;
  playing: boolean;
  started: boolean;
  finished: boolean;
  progress: number;
  incidentStatus: IncidentStatus;
  errorRate: number;
  series: number[];
  steps: AgentStep[];
  sandbox: SandboxResult;
  gateState: GateState;
  gate: GateDecision | null;
  denial: GateDecision | null;
  grantWindow: number; // 1 = fresh grant, 0 = consumed
  grantConsumed: boolean;
  budgetUsed: number;
  budgetMax: number;
  blastRadius: number;
  blastMax: number;
  blastThreshold: number;
  consecutiveFailures: number;
  standingCredentials: number;
  audit: AuditEntry[];
}

export const PORTS = {
  web: 3000,
  agent: 4000,
  payments: 4100,
  gate: 4200,
  pomerium: 4300,
  worker: 4400,
} as const;

/** vigil-agent HTTP surface (consumed by the frontend). */
export const AGENT_ROUTES = {
  /** GET — SSE stream; each message is a full LoopState JSON snapshot. */
  events: "/events",
  /** GET — current LoopState as plain JSON. */
  state: "/state",
  /** POST — breaks payments-api and starts the autonomous loop. */
  start: "/demo/start",
  /** POST — agent attempts a mass-restart; the gate should deny it. */
  thrash: "/demo/thrash",
  /** POST — restores payments-api and resets loop state. */
  reset: "/demo/reset",
} as const;

/* ------------------------------------------------------------------ */
/* Gate service (policy + single-use grants, fronted by Pomerium)      */
/* ------------------------------------------------------------------ */

export interface GrantRequest {
  action: "rollback" | "restart" | "mass-restart";
  service: string;
  servicesAffected: number;
  sandboxPassed: boolean;
  budgetUsed: number;
  consecutiveFailures: number;
  requestedBy: string; // "vigil-agent" — in prod the gate ignores this and uses
  // the authenticated caller identity from the request signature.
  /** Deploy under diagnosis; binds the sandbox attestation to a specific incident. */
  deployId?: string;
  /**
   * Worker-signed proof that the sandbox actually passed for {service, deployId}.
   * In prod the gate verifies this instead of trusting `sandboxPassed`.
   */
  attestation?: string;
}

export interface GrantResponse {
  verdict: "allowed" | "denied";
  scope: string;
  reason?: string;
  /** Single-use bearer token — present only when allowed. */
  token?: string;
  ttlSeconds?: number; // 60
  singleUse?: boolean; // true
}

export interface VerifyRequest {
  token: string;
  action: string;
  service: string;
}

export interface VerifyResponse {
  valid: boolean;
  reason?: string;
}

/* ------------------------------------------------------------------ */
/* Akash diagnostic worker                                             */
/* ------------------------------------------------------------------ */

export interface DiagnoseRequest {
  service: string;
  deployId: string; // e.g. "#4821"
  candidateAction: string; // e.g. "rollback"
  rawLogs: string; // .vlog format, see VLOG_LINE below
}

export interface DiagnoseResponse {
  sandboxPassed: boolean;
  rootCause: string;
  recommendedAction: string;
  checks: { name: string; passed: boolean; detail?: string }[];
  /**
   * Worker-signed attestation over {service, deployId, sandboxPassed}, present
   * when the worker holds a signing secret. The agent forwards it to the gate,
   * which verifies it — so a destructive grant never rests on an unsigned boolean.
   */
  attestation?: string;
}

/* ------------------------------------------------------------------ */
/* Zero.xyz log-parse capability                                       */
/* ------------------------------------------------------------------ */

export interface ParsedLogs {
  errorSignature: string; // e.g. "ERR_TIMEOUT_CFG"
  suspectComponent: string; // e.g. "stripe_adapter"
  suspectDeploy?: string; // e.g. "#4821"
  sampleLines: string[];
  parserSource: "zero" | "fallback";
  costUsd?: number;
}

/**
 * The deliberately cryptic pipe format payments-api emits (".vlog"):
 *   |<LVL>|<unix_ts>|<component>|<CODE>|k=v|k=v...
 * Example:
 *   |E|1721224512|stripe_adapter|ERR_TIMEOUT_CFG|txn=pay_8Hf2|lat_ms=5001|deploy=#4821
 * Sample fixture: shared/fixtures/payments.vlog
 */
export const VLOG_LINE =
  /^\|(?<lvl>[EWI])\|(?<ts>\d+)\|(?<component>[\w-]+)\|(?<code>[A-Z_]+)\|(?<rest>.*)$/;

/** Environment variable names used across services. */
export const ENV = {
  agentUrl: "NEXT_PUBLIC_AGENT_URL", // frontend → orchestrator
  paymentsUrl: "PAYMENTS_URL", // orchestrator → mock prod
  gateUrl: "GATE_URL", // orchestrator + payments-api → gate
  pomeriumUrl: "POMERIUM_URL", // orchestrator → destructive routes via proxy
  workerUrl: "WORKER_URL", // orchestrator → Akash worker
  zeroMode: "ZERO_MODE", // "live" | "fallback"
  zeroApiKey: "ZERO_API_KEY",
  openaiKey: "OPENAI_API_KEY", // optional LLM hypothesis step (services/vigil-agent/src/hypothesis.ts)
  openaiModel: "OPENAI_MODEL", // defaults to gpt-4o-mini
} as const;
