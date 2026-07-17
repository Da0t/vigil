import type {
  Connector,
  Incident,
  RemediationAction,
} from "@/lib/types";

/** The demo incident that the live simulation drives. */
export const PRIMARY_INCIDENT_ID = "inc-4821";

export const incidents: Incident[] = [
  {
    id: PRIMARY_INCIDENT_ID,
    title: "payments-api error rate high",
    severity: "SEV-2",
    service: "payments-api",
    status: "active",
    startedAt: "3m ago",
    owner: "vigil-agent",
    deploy: "#4821",
    summary:
      "5xx rate crossed threshold on payments-api shortly after deploy #4821. Vigil is working the incident with no human paged.",
    metric: {
      label: "5xx error rate",
      value: 14.2,
      unit: "%",
      series: [6.1, 9.4, 11.2, 12.8, 13.1, 13.9, 14.2, 14.0, 14.4, 14.2],
    },
  },
  {
    id: "inc-4809",
    title: "checkout-web latency spike",
    severity: "SEV-3",
    service: "checkout-web",
    status: "resolving",
    startedAt: "22m ago",
    owner: "vigil-agent",
    deploy: "#4809",
    summary: "p95 latency elevated on checkout-web. Cache warm-up in progress.",
    metric: {
      label: "p95 latency",
      value: 412,
      unit: "ms",
      series: [180, 240, 360, 520, 610, 540, 470, 430, 412, 408],
    },
  },
  {
    id: "inc-4788",
    title: "ledger-sync queue backlog",
    severity: "SEV-3",
    service: "ledger-sync",
    status: "resolved",
    startedAt: "1h 40m ago",
    owner: "vigil-agent",
    summary: "Consumer lag cleared after scaling workers within scoped budget.",
    metric: {
      label: "queue depth",
      value: 12,
      unit: "k",
      series: [48, 44, 39, 30, 24, 18, 14, 12, 12, 12],
    },
  },
  {
    id: "inc-4771",
    title: "auth-gateway token errors",
    severity: "SEV-1",
    service: "auth-gateway",
    status: "resolved",
    startedAt: "5h ago",
    owner: "vigil-agent",
    deploy: "#4770",
    summary: "Key rotation misfire. Rolled back within a single scoped grant.",
    metric: {
      label: "auth failures",
      value: 0.4,
      unit: "%",
      series: [22, 19, 14, 8, 4, 2, 0.9, 0.5, 0.4, 0.4],
    },
  },
];

export const recentActions: RemediationAction[] = [
  {
    id: "act-4809-a",
    action: "warm cache · checkout-web",
    service: "checkout-web",
    verdict: "allowed",
    scope: "this service only",
    ttlSeconds: 90,
    at: "18m ago",
    outcome: "applied · latency recovering",
  },
  {
    id: "act-4788-a",
    action: "scale workers +4 · ledger-sync",
    service: "ledger-sync",
    verdict: "allowed",
    scope: "worker pool only",
    ttlSeconds: 120,
    at: "1h 32m ago",
    outcome: "applied · backlog cleared",
  },
  {
    id: "act-4788-b",
    action: "purge dead-letter queue",
    service: "ledger-sync",
    verdict: "denied",
    scope: "requested: all queues",
    at: "1h 35m ago",
    outcome: "held · scope wider than incident",
    reason: "blast radius over limit for a read-recoverable fault",
  },
  {
    id: "act-4771-a",
    action: "rollback deploy #4770 · auth-gateway",
    service: "auth-gateway",
    verdict: "allowed",
    scope: "this service only",
    ttlSeconds: 60,
    at: "4h 58m ago",
    outcome: "applied · auth failures cleared",
  },
  {
    id: "act-4771-b",
    action: "rotate signing keys fleet-wide",
    service: "auth-gateway",
    verdict: "denied",
    scope: "requested: all regions",
    at: "4h 59m ago",
    outcome: "held · policy tightened after repeat failure",
    reason: "2 consecutive failures · escalation refused",
  },
];

export const connectors: Connector[] = [
  {
    id: "zero",
    name: "Zero",
    role: "Open capability market",
    status: "connected",
    detail: "Per-call tools, wallet-bounded, no standing keys.",
    accent: "zero",
  },
  {
    id: "pomerium",
    name: "Pomerium",
    role: "The remediation gate",
    status: "armed",
    detail: "Single-use scoped grants. Behavior-reactive policy.",
    accent: "pomerium",
  },
  {
    id: "akash",
    name: "Akash",
    role: "Disposable sandbox compute",
    status: "connected",
    detail: "Provisioned per incident, torn down after.",
    accent: "akash",
  },
];
