"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useIncidentSim } from "@/lib/use-incident-sim";
import { useIncidentLive, type LiveStatus } from "@/lib/use-incident-live";
import { GlassCard } from "@/components/ui/card";
import { SimControls } from "./sim-controls";
import { TelemetryPanel } from "./telemetry-panel";
import { AgentTimeline } from "./agent-timeline";
import { GatePanel } from "./gate-panel";
import { AuditStrip } from "./audit-strip";
import { BlastRadiusPanel } from "./blast-radius-panel";
import type { Incident } from "@/lib/types";

/** Connection badge copy + styling. Only "off" reads as the scripted sim. */
const STATUS_BADGE: Record<LiveStatus, { label: string; className: string; pulse: boolean }> = {
  off: { label: "SIM · scripted", className: "bg-secondary text-muted-foreground", pulse: false },
  connecting: { label: "CONNECTING", className: "bg-amber-500/15 text-amber-500", pulse: true },
  live: { label: "LIVE · real services", className: "bg-emerald-500/15 text-emerald-500", pulse: false },
  reconnecting: { label: "RECONNECTING", className: "bg-amber-500/15 text-amber-500", pulse: true },
  lost: { label: "STREAM LOST", className: "bg-red-500/15 text-red-500", pulse: true },
};

export function IncidentHero({ incident }: { incident: Incident }) {
  const sim = useIncidentSim();
  const live = useIncidentLive();
  // Agent configured → the live stream is authoritative. Only "off" falls
  // back to the scripted sim; a dropped stream RETAINS the last snapshot.
  const agentMode = live.status !== "off";
  const hasLiveSnapshot = agentMode && live.state !== null;
  const state = hasLiveSnapshot ? live.state! : sim.state;
  const onToggle = agentMode
    ? (!state.started || state.finished ? live.start : live.reset)
    : sim.toggle;
  const onRestart = agentMode ? live.reset : sim.restart;

  const badge = STATUS_BADGE[live.status];
  const interrupted = live.status === "reconnecting" || live.status === "lost";

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
        <div className="flex items-center">
          <div className="flex-1">
            <SimControls
              state={state}
              onToggle={onToggle}
              onRestart={onRestart}
              disabled={live.controlsDisabled}
            />
          </div>
          <span
            className={
              "ml-3 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide " +
              badge.className
            }
          >
            {badge.pulse && (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            )}
            {badge.label}
          </span>
        </div>

        {agentMode && interrupted && (
          <p className="mt-2 text-[11px] text-amber-500">
            Stream interrupted — showing the last live snapshot,{" "}
            {live.status === "lost" ? "still retrying" : "reconnecting"}…
          </p>
        )}
        {live.controlError && (
          <p className="mt-2 text-[11px] text-red-500">{live.controlError}</p>
        )}
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

      {/* infrastructure knowledge graph */}
      <div className="mt-4">
        <BlastRadiusPanel state={state} />
      </div>

      {/* audit */}
      <div className="mt-4">
        <AuditStrip audit={state.audit} />
      </div>
    </div>
  );
}
