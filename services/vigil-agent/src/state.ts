import { EventEmitter } from "node:events";
import type { LoopState } from "../../../src/lib/contract";
import type { AgentStep, AuditEntry } from "../../../src/lib/types";

export const STEP_DEFS: Omit<AgentStep, "state">[] = [
  { id: "detect", label: "Detected from live traffic", source: "agent", detail: "5xx over threshold · no page raised" },
  { id: "context", label: "Pulled incident context", source: "agent", detail: "deploy #4821 · recent change set" },
  { id: "capability", label: "Found a capability it lacked", source: "zero", detail: "log-parser · called per use", cost: 0.04 },
  { id: "sandbox", label: "Verified in disposable diagnostic", source: "akash", detail: "awaiting result" },
  { id: "remediation", label: "Requesting remediation", source: "pomerium", detail: "rollback payments-api" },
];

export function freshState(): LoopState {
  return {
    clock: 0, playing: false, started: false, finished: false, progress: 0,
    incidentStatus: "active", errorRate: 0, series: new Array(54).fill(0),
    steps: STEP_DEFS.map((s) => ({ ...s, state: "pending" as const })),
    sandbox: { provider: "akash", lifecycle: "provisioning", sandboxPassed: false, recommendedAction: "rollback", region: process.env.WORKER_URL ? "akash · deployed" : "local fallback" },
    gateState: "idle", gate: null, denial: null,
    grantWindow: 1, grantConsumed: false,
    budgetUsed: 0, budgetMax: 5,
    blastRadius: 0, blastMax: 12, blastThreshold: 3,
    consecutiveFailures: 0, standingCredentials: 0,
    audit: [],
  };
}

class Store extends EventEmitter {
  state: LoopState = freshState();
  startedAt = 0;

  begin() {
    this.startedAt = Date.now();
    this.state = { ...freshState(), started: true, playing: true };
    this.emit("change", this.state);
  }

  reset() {
    this.startedAt = 0;
    this.state = freshState();
    this.emit("change", this.state);
  }

  mutate(fn: (s: LoopState) => void) {
    const s = structuredClone(this.state);
    if (this.startedAt) s.clock = (Date.now() - this.startedAt) / 1000;
    fn(s);
    this.state = s;
    this.emit("change", s);
  }
}

export const store = new Store();

export const stamp = (clock: number) => `T+${clock.toFixed(1)}s`;

export function setStep(s: LoopState, id: string, state: AgentStep["state"], detail?: string) {
  s.steps = s.steps.map((st) => (st.id === id ? { ...st, state, at: stamp(s.clock), ...(detail ? { detail } : {}) } : st));
}

export function audit(s: LoopState, event: string, actor: string, tone: AuditEntry["tone"] = "neutral", detail?: string) {
  s.audit = [...s.audit, { id: `${event}-${s.audit.length}`, at: stamp(s.clock), actor, event, tone, detail }];
}

/** Coarse progress for the UI progress bar, derived from milestones. */
export function computeProgress(s: LoopState): number {
  if (s.finished) return 1;
  if (s.denial) return 0.95;
  if (s.incidentStatus === "resolved") return 0.85;
  if (s.gateState === "allowed") return 0.72;
  if (s.gateState === "pending") return 0.62;
  const done = s.steps.filter((x) => x.state === "done").length;
  return Math.min(0.55, 0.1 + done * 0.11);
}
