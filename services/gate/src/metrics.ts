import { metrics } from "../../shared/observability";

export const grantsIssued = new metrics.Counter({
  name: "vigil_grants_issued_total",
  help: "Grants issued (verdict allowed)",
  labelNames: ["action"] as const,
});

export const grantsDenied = new metrics.Counter({
  name: "vigil_grants_denied_total",
  help: "Grant requests denied",
  labelNames: ["action", "reason"] as const,
});

export const grantsConsumed = new metrics.Counter({
  name: "vigil_grants_consumed_total",
  help: "Grant verify attempts by result",
  labelNames: ["result"] as const,
});

export const decisionLatency = new metrics.Histogram({
  name: "vigil_gate_decision_seconds",
  help: "Gate policy decision latency (seconds)",
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});
