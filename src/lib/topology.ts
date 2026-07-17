/**
 * Infrastructure knowledge graph for the payments platform.
 * Node coordinates live in a fixed 1000 x 620 space so the SVG edge layer and
 * the HTML node layer stay aligned at any width.
 */

export type NodeKind = "edge" | "service" | "datastore" | "queue" | "external";

export interface GraphNodeDef {
  id: string;
  label: string;
  kind: NodeKind;
  tier: string;
  x: number;
  y: number;
}

export interface GraphEdgeDef {
  from: string;
  to: string;
}

export const AFFECTED_ID = "payments-api";

export const NODES: GraphNodeDef[] = [
  { id: "edge-lb", label: "edge-lb", kind: "edge", tier: "ingress", x: 220, y: 78 },
  { id: "stripe-gw", label: "stripe-gw", kind: "external", tier: "external", x: 782, y: 78 },

  { id: "checkout-web", label: "checkout-web", kind: "service", tier: "web", x: 130, y: 232 },
  { id: "payments-api", label: "payments-api", kind: "service", tier: "api", x: 452, y: 226 },
  { id: "auth-gateway", label: "auth-gateway", kind: "service", tier: "api", x: 772, y: 232 },

  { id: "payments-db", label: "payments-db", kind: "datastore", tier: "data", x: 130, y: 392 },
  { id: "payments-queue", label: "payments-queue", kind: "queue", tier: "async", x: 388, y: 392 },
  { id: "fraud-svc", label: "fraud-svc", kind: "service", tier: "risk", x: 628, y: 392 },
  { id: "redis-cache", label: "redis-cache", kind: "datastore", tier: "cache", x: 866, y: 392 },

  { id: "ledger-sync", label: "ledger-sync", kind: "service", tier: "async", x: 300, y: 548 },
  { id: "notifications", label: "notifications", kind: "service", tier: "async", x: 548, y: 548 },
  { id: "settlement", label: "settlement", kind: "service", tier: "async", x: 792, y: 548 },
];

export const EDGES: GraphEdgeDef[] = [
  { from: "edge-lb", to: "payments-api" },
  { from: "edge-lb", to: "checkout-web" },
  { from: "checkout-web", to: "payments-api" },
  { from: "payments-api", to: "payments-db" },
  { from: "payments-api", to: "payments-queue" },
  { from: "payments-api", to: "fraud-svc" },
  { from: "payments-api", to: "auth-gateway" },
  { from: "payments-api", to: "redis-cache" },
  { from: "payments-api", to: "stripe-gw" },
  { from: "payments-api", to: "notifications" },
  { from: "payments-queue", to: "ledger-sync" },
  { from: "ledger-sync", to: "settlement" },
  { from: "fraud-svc", to: "redis-cache" },
  { from: "auth-gateway", to: "redis-cache" },
];

export const NODE_MAP: Record<string, GraphNodeDef> = Object.fromEntries(
  NODES.map((n) => [n.id, n])
);

/** The scoped fix touches one service. A mass-restart would hit the whole platform. */
export const SCOPED_SET = new Set<string>([AFFECTED_ID]);
export const MASS_SET = new Set<string>(NODES.map((n) => n.id));

const NEIGHBORS = new Set<string>();
for (const e of EDGES) {
  if (e.from === AFFECTED_ID) NEIGHBORS.add(e.to);
  if (e.to === AFFECTED_ID) NEIGHBORS.add(e.from);
}

export type GraphMode = "active" | "scoped" | "mass" | "resolved";
export type NodeState =
  | "healthy"
  | "dependency"
  | "affected"
  | "scoped"
  | "blast"
  | "resolved";
export type EdgeState = "default" | "active" | "blast";

export interface GraphView {
  nodeStates: Record<string, NodeState>;
  edgeStates: EdgeState[];
}

export function computeGraph(mode: GraphMode): GraphView {
  const nodeStates: Record<string, NodeState> = {};
  for (const n of NODES) nodeStates[n.id] = "healthy";

  if (mode === "mass") {
    for (const id of MASS_SET) nodeStates[id] = "blast";
  } else if (mode === "active") {
    for (const id of NEIGHBORS) nodeStates[id] = "dependency";
    nodeStates[AFFECTED_ID] = "affected";
  } else if (mode === "scoped") {
    for (const id of NEIGHBORS) nodeStates[id] = "dependency";
    nodeStates[AFFECTED_ID] = "scoped";
  } else {
    nodeStates[AFFECTED_ID] = "resolved";
  }

  const edgeStates: EdgeState[] = EDGES.map((e) => {
    if (mode === "mass") return "blast";
    if ((mode === "active" || mode === "scoped") &&
        (e.from === AFFECTED_ID || e.to === AFFECTED_ID))
      return "active";
    return "default";
  });

  return { nodeStates, edgeStates };
}

export const BLAST = {
  scoped: SCOPED_SET.size,
  mass: MASS_SET.size,
};
