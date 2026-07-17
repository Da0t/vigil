"use client";

import { ArrowDownRight, ArrowUpRight, Activity } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { SeverityChip, Pill } from "@/components/ui/chip";
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";
import type { Incident, IncidentStatus } from "@/lib/types";

const STATUS_TONE: Record<IncidentStatus, "alert" | "signal" | "ok"> = {
  active: "alert",
  resolving: "signal",
  resolved: "ok",
  failed: "alert",
};

const STATUS_LABEL: Record<IncidentStatus, string> = {
  active: "Active",
  resolving: "Resolving",
  resolved: "Resolved",
  failed: "Not resolved",
};

export function TelemetryPanel({
  incident,
  status,
  errorRate,
  series,
}: {
  incident: Incident;
  status: IncidentStatus;
  errorRate: number;
  series: number[];
}) {
  const resolved = status === "resolved";
  const rising = !resolved && errorRate > 8;

  return (
    <GlassCard glow={!resolved} className="overflow-hidden">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">{incident.title}</h1>
            <p className="tabular mt-1 font-mono text-[11px] text-muted-foreground">
              {incident.service} · started {incident.startedAt}
              {incident.deploy ? ` · deploy ${incident.deploy}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SeverityChip severity={incident.severity} />
            <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
          </div>
        </div>

        {/* live readout */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Activity className="h-3 w-3" />
              {incident.metric.label}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={cn(
                  "tabular text-4xl font-semibold tracking-tight",
                  resolved ? "text-ok" : "text-[hsl(var(--primary))]"
                )}
              >
                {errorRate.toFixed(errorRate < 1 ? 2 : 1)}
              </span>
              <span className="text-lg text-muted-foreground">{incident.metric.unit}</span>
              <span
                className={cn(
                  "ml-1 inline-flex items-center gap-0.5 text-xs",
                  rising ? "text-[hsl(var(--primary))]" : "text-ok"
                )}
              >
                {rising ? (
                  <ArrowUpRight className="h-3.5 w-3.5" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5" />
                )}
                {rising ? "climbing" : resolved ? "recovered" : "recovering"}
              </span>
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              source
            </div>
            <div className="mt-1 text-xs text-foreground">Live traffic</div>
          </div>
        </div>

        <div className="-mx-1">
          <Sparkline
            series={series}
            height={128}
            tone={resolved ? "ok" : "signal"}
          />
        </div>
      </div>
    </GlassCard>
  );
}
