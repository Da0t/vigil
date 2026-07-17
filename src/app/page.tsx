import Link from "next/link";
import {
  Siren,
  Gauge,
  KeyRound,
  Wallet,
  ArrowRight,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat";
import { SeverityChip, Pill, SourceChip } from "@/components/ui/chip";
import { Sparkline } from "@/components/ui/sparkline";
import { Button } from "@/components/ui/button";
import { incidents, connectors, recentActions, PRIMARY_INCIDENT_ID } from "@/lib/mock-data";

export default function DashboardPage() {
  const primary = incidents.find((i) => i.id === PRIMARY_INCIDENT_ID)!;
  const active = incidents.filter((i) => i.status !== "resolved").length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      {/* hero row */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-[hsl(var(--primary))]">
            Agent online · watching
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            On-call, autonomously.
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Vigil diagnoses and fixes production incidents on its own. It holds no
            keys to production and can only act through a gate that grants one
            scoped, single-use permission at a time.
          </p>
        </div>
      </div>

      {/* stat tiles */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Active incidents" value={active} tone="signal" hint="worked with no page" icon={<Siren className="h-4 w-4" />} />
        <StatTile label="Mean time to remediate" value="2.4" unit="min" tone="ok" hint="last 24h" icon={<Gauge className="h-4 w-4" />} />
        <StatTile label="Standing credentials" value={0} tone="ok" hint="held by the agent" icon={<KeyRound className="h-4 w-4" />} />
        <StatTile label="Spend today" value="$1.84" tone="default" hint="within wallet budget" icon={<Wallet className="h-4 w-4" />} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* spotlight incident */}
        <GlassCard glow className="lg:col-span-7">
          <div className="flex items-center justify-between border-b border-border/50 p-5">
            <div className="text-sm font-semibold tracking-tight">Live incident</div>
            <SeverityChip severity={primary.severity} />
          </div>
          <div className="p-5">
            <h2 className="text-base font-semibold tracking-tight">{primary.title}</h2>
            <p className="tabular mt-1 font-mono text-[11px] text-muted-foreground">
              {primary.service} · started {primary.startedAt} · deploy {primary.deploy}
            </p>
            <div className="my-4">
              <Sparkline series={primary.metric.series} height={92} tone="signal" showHead={false} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Pill tone="alert">Active</Pill>
                <span className="tabular text-xs text-muted-foreground">
                  {primary.metric.label} {primary.metric.value}
                  {primary.metric.unit}
                </span>
              </div>
              <Link href={`/incidents/${primary.id}`}>
                <Button size="sm">
                  Watch Vigil work <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        </GlassCard>

        {/* connected systems */}
        <GlassCard className="lg:col-span-5">
          <div className="flex items-center justify-between border-b border-border/50 p-5">
            <div className="text-sm font-semibold tracking-tight">Connected systems</div>
            <Link
              href="/connectors"
              className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              manage
            </Link>
          </div>
          <div className="divide-y divide-border/40">
            {connectors.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <div className="text-xs font-medium text-foreground">{c.name}</div>
                  <div className="text-[11px] text-muted-foreground">{c.role}</div>
                </div>
                <SourceChip source={c.accent} />
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* recent decisions */}
      <GlassCard className="mt-4">
        <div className="flex items-center justify-between border-b border-border/50 p-5">
          <div className="text-sm font-semibold tracking-tight">Recent gate decisions</div>
          <Link
            href="/actions"
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            view all
          </Link>
        </div>
        <div className="divide-y divide-border/40">
          {recentActions.slice(0, 4).map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {a.verdict === "allowed" ? (
                  <ShieldCheck className="h-4 w-4 shrink-0 text-ok" />
                ) : (
                  <ShieldX className="h-4 w-4 shrink-0 text-alert" />
                )}
                <span className="truncate font-mono text-[11px] text-foreground">
                  {a.action}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Pill tone={a.verdict === "allowed" ? "ok" : "alert"}>{a.verdict}</Pill>
                <span className="tabular hidden text-[11px] text-muted-foreground sm:inline">
                  {a.at}
                </span>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
