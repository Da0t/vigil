import { GlassCard } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  unit,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: "default" | "signal" | "ok" | "alert";
  icon?: React.ReactNode;
}) {
  const valueTone =
    tone === "signal"
      ? "text-[hsl(var(--primary))]"
      : tone === "alert"
        ? "text-alert"
        : tone === "ok"
          ? "text-ok"
          : "text-foreground";
  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {icon && <span className="text-muted-foreground/70">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className={cn("tabular text-2xl font-semibold tracking-tight", valueTone)}>
          {value}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </GlassCard>
  );
}
