import Link from "next/link";
import { ArrowLeft, ShieldCheck, ShieldX, ScrollText } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { SeverityChip, Pill, SourceChip } from "@/components/ui/chip";
import { Sparkline } from "@/components/ui/sparkline";
import type { Incident } from "@/lib/types";

export function StaticIncidentDetail({ incident }: { incident: Incident }) {
  const resolved = incident.status === "resolved";
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <Link
        href="/incidents"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Incidents
      </Link>

      <GlassCard glow={incident.status === "active"} className="mt-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{incident.title}</h1>
            <p className="tabular mt-1 font-mono text-[11px] text-muted-foreground">
              {incident.service} · started {incident.startedAt}
              {incident.deploy ? ` · deploy ${incident.deploy}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SeverityChip severity={incident.severity} />
            <Pill tone={resolved ? "ok" : "signal"}>
              {resolved ? "Resolved" : "Resolving"}
            </Pill>
          </div>
        </div>

        {incident.summary && (
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {incident.summary}
          </p>
        )}

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{incident.metric.label}</span>
            <span className="tabular">
              {incident.metric.value}
              {incident.metric.unit}
            </span>
          </div>
          <Sparkline
            series={incident.metric.series}
            height={96}
            tone={resolved ? "ok" : "signal"}
            showHead={false}
          />
        </div>
      </GlassCard>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Remediation
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-[hsl(var(--lg-ok)/0.25)] bg-[hsl(var(--lg-ok)/0.06)] px-3 py-2">
              <span className="font-mono text-[11px] text-foreground">scoped fix applied</span>
              <Pill tone="ok">allowed</Pill>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                credential · single-use · 60s TTL
              </span>
              <SourceChip source="pomerium" />
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <ScrollText className="h-4 w-4 text-muted-foreground" />
            Attribution
          </div>
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-ok" />
              Worked entirely by {incident.owner}
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-ok" />
              Held no standing credential
            </li>
            <li className="flex items-center gap-2">
              <ShieldX className="h-3.5 w-3.5 text-alert" />
              Any over-scoped escalation was refused
            </li>
          </ul>
        </GlassCard>
      </div>
    </div>
  );
}
