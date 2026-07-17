import { metrics } from "../../shared/observability";

export const incidentsTotal = new metrics.Counter({
  name: "vigil_incidents_total",
  help: "Incident loops started",
});

export const incidentOutcome = new metrics.Counter({
  name: "vigil_incident_outcome_total",
  help: "Incident terminal outcomes",
  labelNames: ["outcome"] as const,
});

export const sseClientsGauge = new metrics.Gauge({
  name: "vigil_sse_clients",
  help: "Currently connected SSE clients",
});

export const sseDropped = new metrics.Counter({
  name: "vigil_sse_dropped_total",
  help: "SSE clients dropped for persistent backpressure",
});
