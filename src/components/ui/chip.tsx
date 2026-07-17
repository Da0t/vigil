import * as React from "react";
import { cn } from "@/lib/utils";
import type { Severity, SourceTag } from "@/lib/types";

/* ---- Source chip (Zero / Akash / Pomerium / Vigil) ---- */

const SOURCE_LABELS: Record<SourceTag, string> = {
  zero: "Zero",
  akash: "Akash",
  pomerium: "Pomerium",
  agent: "Vigil",
};

export function SourceChip({
  source,
  className,
}: {
  source: SourceTag;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border border-border bg-secondary/50 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-muted-foreground",
        className
      )}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

/* ---- Severity chip ---- */

export function SeverityChip({
  severity,
  className,
}: {
  severity: Severity;
  className?: string;
}) {
  const hot = severity === "SEV-1";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wider tabular",
        hot
          ? "bg-destructive/15 text-[hsl(var(--destructive))] ring-1 ring-destructive/40"
          : "bg-primary/12 text-[hsl(var(--primary))] ring-1 ring-primary/35",
        className
      )}
    >
      {severity}
    </span>
  );
}

/* ---- Generic pill ---- */

export function Pill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "signal" | "ok" | "alert" | "amber";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-secondary/50 text-muted-foreground border-border/70",
    signal: "bg-primary/12 text-[hsl(var(--primary))] border-primary/30",
    ok: "bg-[hsl(var(--lg-ok)/0.1)] text-ok border-[hsl(var(--lg-ok)/0.22)]",
    alert: "bg-[hsl(var(--lg-alert)/0.14)] text-alert border-[hsl(var(--lg-alert)/0.4)]",
    amber: "bg-[hsl(var(--lg-amber)/0.12)] text-amber border-[hsl(var(--lg-amber)/0.35)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium tracking-wide",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
