import { KeyRound, Wallet, ShieldAlert, Gauge } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { GlassCard } from "@/components/ui/card";
import { Pill } from "@/components/ui/chip";
import { Meter } from "@/components/ui/meter";

function Toggle({ on }: { on?: boolean }) {
  return (
    <span
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        on ? "bg-primary/70" : "bg-secondary"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-foreground transition-transform ${
          on ? "translate-x-4" : "translate-x-1"
        }`}
      />
    </span>
  );
}

export default function SettingsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader
        title="Settings"
        subtitle="Policy limits the agent operates under. The gate reads these on every request."
      />

      <div className="mt-6 space-y-4">
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            Behavior-reactive policy
          </div>
          <div className="mt-4 space-y-4">
            <Meter label="Blast radius limit" value={3} max={12} unit=" svc" threshold={3} />
            <Meter label="Wallet budget" value={1.84} max={5} unit=" / $5.00" />
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-foreground">
                  Auto-tighten on repeat failure
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Refuse escalation after 2 consecutive failed actions.
                </div>
              </div>
              <Toggle on />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-foreground">
                  Standing credentials
                </div>
                <div className="text-[11px] text-muted-foreground">
                  The agent may never hold a long-lived credential.
                </div>
              </div>
              <Pill tone="ok">disabled by design</Pill>
            </div>
          </div>
        </GlassCard>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <GlassCard className="p-5">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <div className="mt-3 text-2xl font-semibold tracking-tight text-ok tabular">60s</div>
            <div className="mt-1 text-[11px] text-muted-foreground">Default grant TTL</div>
          </GlassCard>
          <GlassCard className="p-5">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground tabular">
              $5.00
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">Per-incident wallet</div>
          </GlassCard>
          <GlassCard className="p-5">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground tabular">
              2
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">Failures before clamp</div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
