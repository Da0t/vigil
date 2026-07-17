import { ShieldCheck, ShieldX, Clock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { GlassCard } from "@/components/ui/card";
import { Pill } from "@/components/ui/chip";
import { recentActions } from "@/lib/mock-data";

export default function ActionsPage() {
  const allowed = recentActions.filter((a) => a.verdict === "allowed").length;
  const denied = recentActions.length - allowed;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader
        title="Actions"
        subtitle="Every remediation the agent attempted and how the gate ruled. Read-only work is free; destructive fixes need a scoped, single-use grant."
        action={
          <div className="flex items-center gap-2">
            <Pill tone="ok">{allowed} allowed</Pill>
            <Pill tone="alert">{denied} denied</Pill>
          </div>
        }
      />

      <GlassCard className="mt-6 overflow-hidden">
        {/* header row */}
        <div className="hidden grid-cols-12 gap-3 border-b border-border/50 px-5 py-3 text-[11px] uppercase tracking-wider text-muted-foreground md:grid">
          <span className="col-span-4">Action</span>
          <span className="col-span-2">Verdict</span>
          <span className="col-span-3">Scope</span>
          <span className="col-span-1">TTL</span>
          <span className="col-span-2 text-right">Outcome</span>
        </div>

        <div className="divide-y divide-border/40">
          {recentActions.map((a) => (
            <div
              key={a.id}
              className="grid grid-cols-1 gap-2 px-5 py-4 transition-colors hover:bg-secondary/20 md:grid-cols-12 md:items-center md:gap-3"
            >
              <div className="col-span-4 flex items-center gap-2.5">
                {a.verdict === "allowed" ? (
                  <ShieldCheck className="h-4 w-4 shrink-0 text-ok" />
                ) : (
                  <ShieldX className="h-4 w-4 shrink-0 text-alert" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-mono text-xs text-foreground">{a.action}</div>
                  <div className="text-[11px] text-muted-foreground md:hidden">
                    {a.service} · {a.at}
                  </div>
                </div>
              </div>

              <div className="col-span-2">
                <Pill tone={a.verdict === "allowed" ? "ok" : "alert"}>{a.verdict}</Pill>
              </div>

              <div className="col-span-3 font-mono text-[11px] text-muted-foreground">
                {a.scope}
              </div>

              <div className="col-span-1 tabular text-[11px] text-muted-foreground">
                {a.ttlSeconds ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {a.ttlSeconds}s
                  </span>
                ) : (
                  <span className="text-muted-foreground/50">n/a</span>
                )}
              </div>

              <div className="col-span-2 md:text-right">
                <div className="text-[11px] text-foreground">{a.outcome}</div>
                {a.reason && (
                  <div className="text-[10px] text-alert/80">{a.reason}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
