"use client";

import { Waypoints, Server, Database, Layers, Cloud } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { GlassCard } from "@/components/ui/card";
import { Pill } from "@/components/ui/chip";
import { SimControls } from "@/components/incident/sim-controls";
import {
  ServiceGraph,
  GraphLegend,
  graphModeFromSim,
} from "@/components/graph/service-graph";
import { useIncidentSim } from "@/lib/use-incident-sim";
import {
  NODES,
  computeGraph,
  BLAST,
  type NodeKind,
  type NodeState,
} from "@/lib/topology";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<NodeKind, typeof Server> = {
  edge: Waypoints,
  service: Server,
  datastore: Database,
  queue: Layers,
  external: Cloud,
};

const STATE_LABEL: Record<NodeState, { text: string; tone: "signal" | "ok" | "alert" | "neutral" }> = {
  healthy: { text: "healthy", tone: "neutral" },
  dependency: { text: "dependency", tone: "neutral" },
  affected: { text: "affected", tone: "signal" },
  scoped: { text: "scoped fix", tone: "ok" },
  blast: { text: "in blast radius", tone: "alert" },
  resolved: { text: "recovered", tone: "ok" },
};

export default function InfrastructurePage() {
  const { state, toggle, restart } = useIncidentSim();
  const mode = graphModeFromSim(state);
  const { nodeStates } = computeGraph(mode);

  const modeMeta = {
    active: { tone: "signal" as const, label: "incident active" },
    scoped: { tone: "ok" as const, label: "scoped rollback" },
    mass: { tone: "alert" as const, label: "mass-restart refused" },
    resolved: { tone: "ok" as const, label: "recovered" },
  }[mode];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader
        title="Infrastructure"
        subtitle="The knowledge graph Vigil reasons over. Dependencies define the blast radius the gate scores on every request. Play the incident to watch it react."
        action={<Pill tone={modeMeta.tone}>{modeMeta.label}</Pill>}
      />

      {/* control bar */}
      <GlassCard className="mt-6 p-4">
        <SimControls state={state} onToggle={toggle} onRestart={restart} />
      </GlassCard>

      {/* graph */}
      <GlassCard className="mt-4 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">payments platform · topology</h2>
          <div className="flex items-center gap-2">
            <Pill tone="ok">scoped {BLAST.scoped}</Pill>
            <Pill tone="alert">mass {BLAST.mass}</Pill>
          </div>
        </div>
        <ServiceGraph mode={mode} />
        <GraphLegend className="mt-5 border-t border-border/50 pt-4" />
      </GlassCard>

      {/* service inventory */}
      <GlassCard className="mt-4 overflow-hidden">
        <div className="border-b border-border/60 p-5 text-sm font-semibold tracking-tight">
          Services ({NODES.length})
        </div>
        <div className="grid grid-cols-1 divide-y divide-border/40 sm:grid-cols-2 sm:divide-y-0">
          {NODES.map((n, i) => {
            const st = nodeStates[n.id];
            const meta = STATE_LABEL[st];
            const Icon = KIND_ICON[n.kind];
            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-center justify-between gap-3 px-5 py-3",
                  "sm:border-b sm:border-border/40",
                  i % 2 === 0 ? "sm:border-r sm:border-border/40" : ""
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      st === "affected"
                        ? "text-[hsl(var(--primary))]"
                        : st === "blast"
                          ? "text-alert"
                          : st === "scoped" || st === "resolved"
                            ? "text-ok"
                            : "text-muted-foreground"
                    )}
                  />
                  <div>
                    <div className="font-mono text-xs text-foreground">{n.label}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {n.kind} · {n.tier}
                    </div>
                  </div>
                </div>
                <Pill tone={meta.tone}>{meta.text}</Pill>
              </div>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
