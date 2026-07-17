"use client";

import { Waypoints, Server, Database, Layers, Cloud } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NODES,
  EDGES,
  NODE_MAP,
  computeGraph,
  type GraphMode,
  type NodeKind,
  type NodeState,
  type EdgeState,
} from "@/lib/topology";
import type { SimState } from "@/lib/use-incident-sim";

const W = 1000;
const H = 620;

const KIND_ICON: Record<NodeKind, typeof Server> = {
  edge: Waypoints,
  service: Server,
  datastore: Database,
  queue: Layers,
  external: Cloud,
};

const NODE_CLASS: Record<NodeState, string> = {
  healthy: "border-border bg-card",
  dependency: "border-foreground/25 bg-card",
  affected: "border-[hsl(var(--primary)/0.6)] bg-[hsl(var(--primary)/0.12)]",
  scoped: "border-[hsl(var(--lg-ok)/0.5)] bg-[hsl(var(--lg-ok)/0.07)]",
  blast: "border-[hsl(var(--lg-alert)/0.65)] bg-[hsl(var(--lg-alert)/0.12)]",
  resolved: "border-[hsl(var(--lg-ok)/0.4)] bg-card",
};

const ICON_CLASS: Record<NodeState, string> = {
  healthy: "text-muted-foreground",
  dependency: "text-foreground",
  affected: "text-[hsl(var(--primary))]",
  scoped: "text-ok",
  blast: "text-alert",
  resolved: "text-ok",
};

const EDGE_COLOR: Record<EdgeState, string> = {
  default: "hsl(var(--lg-hair) / 0.16)",
  active: "hsl(var(--primary) / 0.55)",
  blast: "hsl(var(--lg-alert) / 0.6)",
};

/** Map the live simulation state to what the graph should show. */
export function graphModeFromSim(s: SimState): GraphMode {
  if (s.blastRadius >= 12) return "mass";
  if (s.incidentStatus === "resolved") return "resolved";
  if (s.gateState === "allowed") return "scoped";
  return "active";
}

export function ServiceGraph({ mode }: { mode: GraphMode }) {
  const { nodeStates, edgeStates } = computeGraph(mode);

  return (
    <div className="w-full overflow-x-auto">
      <div className="relative mx-auto w-full" style={{ aspectRatio: `${W} / ${H}`, minWidth: 660 }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {EDGES.map((e, i) => {
            const a = NODE_MAP[e.from];
            const b = NODE_MAP[e.to];
            const st = edgeStates[i];
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={EDGE_COLOR[st]}
                strokeWidth={st === "default" ? 1 : 1.6}
                vectorEffect="non-scaling-stroke"
                className="transition-all duration-500"
              />
            );
          })}
        </svg>

        {NODES.map((n) => {
          const st = nodeStates[n.id];
          const Icon = KIND_ICON[n.kind];
          return (
            <div
              key={n.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${(n.x / W) * 100}%`, top: `${(n.y / H) * 100}%` }}
            >
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.5)] transition-colors duration-500",
                  NODE_CLASS[st]
                )}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", ICON_CLASS[st])} />
                <div className="leading-none">
                  <div className="font-mono text-[11px] text-foreground">{n.label}</div>
                  <div className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                    {n.tier}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GraphLegend({ className }: { className?: string }) {
  const items: { label: string; swatch: string }[] = [
    { label: "affected", swatch: "border-[hsl(var(--primary)/0.6)] bg-[hsl(var(--primary)/0.12)]" },
    { label: "dependency", swatch: "border-foreground/25 bg-card" },
    { label: "scoped fix", swatch: "border-[hsl(var(--lg-ok)/0.5)] bg-[hsl(var(--lg-ok)/0.07)]" },
    { label: "blast radius", swatch: "border-[hsl(var(--lg-alert)/0.65)] bg-[hsl(var(--lg-alert)/0.12)]" },
    { label: "healthy", swatch: "border-border bg-card" },
  ];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5">
          <span className={cn("h-3 w-3 rounded-sm border", it.swatch)} />
          <span className="text-[11px] text-muted-foreground">{it.label}</span>
        </div>
      ))}
    </div>
  );
}
