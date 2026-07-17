"use client";

import Link from "next/link";
import { Share2, ArrowUpRight } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { Pill } from "@/components/ui/chip";
import { ServiceGraph, GraphLegend, graphModeFromSim } from "@/components/graph/service-graph";
import type { SimState } from "@/lib/use-incident-sim";
import type { GraphMode } from "@/lib/topology";

const META: Record<
  GraphMode,
  { tone: "signal" | "ok" | "alert"; radius: number; text: string }
> = {
  active: {
    tone: "signal",
    radius: 1,
    text: "payments-api degraded. Dependencies mapped from the knowledge graph.",
  },
  scoped: {
    tone: "ok",
    radius: 1,
    text: "Scoped rollback. One service in the blast radius, granted by the gate.",
  },
  mass: {
    tone: "alert",
    radius: 12,
    text: "Mass-restart would touch 12 services. Blast radius over limit, the gate refuses to escalate.",
  },
  resolved: {
    tone: "ok",
    radius: 0,
    text: "Recovered. No active blast radius.",
  },
};

export function BlastRadiusPanel({ state }: { state: SimState }) {
  const mode = graphModeFromSim(state);
  const meta = META[mode];

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Share2 className="h-4 w-4 text-muted-foreground" />
          Infrastructure knowledge graph
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={meta.tone}>
            blast radius {meta.radius} {meta.radius === 1 ? "service" : "services"}
          </Pill>
          <Link
            href="/infrastructure"
            className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            full topology
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="p-5">
        <p className="mb-4 text-xs text-muted-foreground">{meta.text}</p>
        <ServiceGraph mode={mode} />
        <GraphLegend className="mt-5 border-t border-border/50 pt-4" />
      </div>
    </GlassCard>
  );
}
