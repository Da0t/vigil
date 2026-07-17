"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useIncidentSim } from "@/lib/use-incident-sim";
import { GlassCard } from "@/components/ui/card";
import { SimControls } from "./sim-controls";
import { TelemetryPanel } from "./telemetry-panel";
import { AgentTimeline } from "./agent-timeline";
import { GatePanel } from "./gate-panel";
import { AuditStrip } from "./audit-strip";
import type { Incident } from "@/lib/types";

export function IncidentHero({ incident }: { incident: Incident }) {
  const { state, toggle, restart } = useIncidentSim();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <Link
        href="/incidents"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Incidents
      </Link>

      {/* control bar */}
      <GlassCard className="mt-4 p-4">
        <SimControls state={state} onToggle={toggle} onRestart={restart} />
      </GlassCard>

      {/* main grid */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-7">
          <TelemetryPanel
            incident={incident}
            status={state.incidentStatus}
            errorRate={state.started ? state.errorRate : incident.metric.value}
            series={state.started ? state.series : incident.metric.series}
          />
          <GlassCard className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">Agent reasoning</h2>
              <span className="text-[11px] text-muted-foreground">
                plan · act · observe · re-plan
              </span>
            </div>
            <AgentTimeline
              steps={state.steps}
              sandbox={state.sandbox}
              started={state.started}
            />
          </GlassCard>
        </div>

        <div className="lg:col-span-5">
          <GatePanel state={state} />
        </div>
      </div>

      {/* audit */}
      <div className="mt-4">
        <AuditStrip audit={state.audit} />
      </div>
    </div>
  );
}
