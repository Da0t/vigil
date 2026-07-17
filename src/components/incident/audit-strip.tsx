"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ScrollText, ShieldCheck } from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { SourceChip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import type { AuditEntry, SourceTag } from "@/lib/types";

const TONE_DOT: Record<NonNullable<AuditEntry["tone"]>, string> = {
  neutral: "bg-muted-foreground/50",
  signal: "bg-[hsl(var(--primary))]",
  ok: "bg-[hsl(var(--lg-ok))]",
  alert: "bg-[hsl(var(--lg-alert))]",
};

const ACTORS: SourceTag[] = ["zero", "akash", "pomerium", "agent"];

export function AuditStrip({ audit }: { audit: AuditEntry[] }) {
  const rows = [...audit].reverse();

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <ScrollText className="h-4 w-4 text-muted-foreground" />
          Audit log
        </div>
        <div className="flex items-center gap-1.5 rounded-md border border-[hsl(var(--lg-ok)/0.25)] bg-[hsl(var(--lg-ok)/0.08)] px-2 py-1 text-[11px] text-ok">
          <ShieldCheck className="h-3.5 w-3.5" />
          Held no standing credential · every action attributable
        </div>
      </div>

      <div className="max-h-[280px] overflow-y-auto p-2">
        {rows.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            No events yet. Press play to watch the loop write its own audit trail.
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {rows.map((e) => {
              const actor = (ACTORS.includes(e.actor as SourceTag)
                ? e.actor
                : "agent") as SourceTag;
              return (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-secondary/30"
                >
                  <span className="tabular w-14 shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground/70">
                    {e.at}
                  </span>
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      TONE_DOT[e.tone ?? "neutral"]
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-xs text-foreground">{e.event}</span>
                      <SourceChip source={actor} />
                    </div>
                    {e.detail && (
                      <p className="tabular mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {e.detail}
                      </p>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </GlassCard>
  );
}
