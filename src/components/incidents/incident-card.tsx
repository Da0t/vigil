import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { SeverityChip, Pill } from "@/components/ui/chip";
import { Sparkline } from "@/components/ui/sparkline";
import type { Incident, IncidentStatus } from "@/lib/types";

const STATUS: Record<
  IncidentStatus,
  { tone: "alert" | "signal" | "ok"; label: string }
> = {
  active: { tone: "alert", label: "Active" },
  resolving: { tone: "signal", label: "Resolving" },
  resolved: { tone: "ok", label: "Resolved" },
  failed: { tone: "alert", label: "Not resolved" },
};

export function IncidentCard({ incident }: { incident: Incident }) {
  const s = STATUS[incident.status];
  return (
    <Link href={`/incidents/${incident.id}`} className="group block">
      <GlassCard
        glow={incident.status === "active"}
        className="p-5 transition-transform duration-200 group-hover:-translate-y-0.5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-tight">
              {incident.title}
            </h3>
            <p className="tabular mt-1 font-mono text-[11px] text-muted-foreground">
              {incident.service} · {incident.startedAt}
              {incident.deploy ? ` · ${incident.deploy}` : ""}
            </p>
          </div>
          <SeverityChip severity={incident.severity} />
        </div>

        <div className="my-4 opacity-90">
          <Sparkline
            series={incident.metric.series}
            height={44}
            tone={incident.status === "resolved" ? "ok" : "signal"}
            showHead={false}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Pill tone={s.tone}>{s.label}</Pill>
            <span className="tabular text-[11px] text-muted-foreground">
              {incident.metric.label} {incident.metric.value}
              {incident.metric.unit}
            </span>
          </div>
          <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground transition-colors group-hover:text-foreground">
            {incident.owner}
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </GlassCard>
    </Link>
  );
}
