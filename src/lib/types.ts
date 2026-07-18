export type Severity = "SEV-1" | "SEV-2" | "SEV-3";
export type SourceTag = "zero" | "akash" | "pomerium" | "agent";

export type IncidentStatus = "active" | "resolving" | "resolved" | "failed";
export type StepState = "done" | "active" | "pending" | "failed";
export type SandboxLifecycle =
  | "provisioning"
  | "running"
  | "done"
  | "torn_down"
  | "failed";

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  service: string;
  metric: { label: string; value: number; unit: string; series: number[] };
  status: IncidentStatus;
  startedAt: string;
  owner: string;
  deploy?: string;
  summary?: string;
}

export interface AgentStep {
  id: string;
  label: string;
  source: SourceTag;
  state: StepState;
  detail?: string;
  cost?: number;
  at?: string;
}

export interface GateDecision {
  action: string;
  verdict: "allowed" | "denied";
  scope: string;
  credential?: { singleUse: boolean; ttlSeconds: number };
  reason?: string;
  budgetOk: boolean;
  attributedTo: string;
  at: string;
}

export interface SandboxResult {
  provider: "akash";
  lifecycle: SandboxLifecycle;
  sandboxPassed: boolean;
  recommendedAction: string;
  region?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  event: string;
  detail?: string;
  tone?: "neutral" | "signal" | "ok" | "alert";
}

export interface RemediationAction {
  id: string;
  action: string;
  service: string;
  verdict: "allowed" | "denied";
  scope: string;
  ttlSeconds?: number;
  at: string;
  outcome: string;
  reason?: string;
}

export interface Connector {
  id: string;
  name: string;
  role: string;
  status: "connected" | "streaming" | "armed";
  detail: string;
  accent: SourceTag;
}
