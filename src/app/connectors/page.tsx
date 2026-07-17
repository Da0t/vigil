import { Check, Radio, Lock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { GlassCard } from "@/components/ui/card";
import { Pill, SourceChip } from "@/components/ui/chip";
import { connectors } from "@/lib/mock-data";
import type { Connector } from "@/lib/types";

const STATUS_META: Record<
  Connector["status"],
  { tone: "ok" | "signal"; label: string; icon: typeof Check }
> = {
  connected: { tone: "ok", label: "Connected", icon: Check },
  streaming: { tone: "signal", label: "Streaming", icon: Radio },
  armed: { tone: "signal", label: "Armed", icon: Lock },
};

export default function ConnectorsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
      <PageHeader
        title="Connectors"
        subtitle="The systems Vigil acts through. It buys capabilities per call on Zero, reproduces on Akash, and can only act through the Pomerium gate."
        action={<Pill tone="ok">5 connected</Pill>}
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {connectors.map((c) => {
          const meta = STATUS_META[c.status];
          const Icon = meta.icon;
          const armed = c.status === "armed";
          return (
            <GlassCard key={c.id} glow={armed} className="flex flex-col p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">{c.name}</h3>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{c.role}</p>
                </div>
                <SourceChip source={c.accent} />
              </div>

              <p className="mt-3 flex-1 text-xs leading-relaxed text-muted-foreground">
                {c.detail}
              </p>

              <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                <span className="text-[11px] text-foreground">{meta.label}</span>
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </GlassCard>
          );
        })}

        {/* add connector tile */}
        <GlassCard className="flex min-h-[180px] items-center justify-center border-dashed p-5">
          <div className="text-center">
            <div className="text-xs font-medium text-muted-foreground">
              + Add a source
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              Route it through the gate before the agent can act on it.
            </p>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
