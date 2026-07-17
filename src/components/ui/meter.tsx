import { cn } from "@/lib/utils";

/**
 * A thin horizontal meter for budget / blast-radius. `over` flips it to the
 * alert treatment when a threshold is breached.
 */
export function Meter({
  label,
  value,
  max = 100,
  unit = "%",
  over = false,
  threshold,
  className,
}: {
  label: string;
  value: number;
  max?: number;
  unit?: string;
  over?: boolean;
  threshold?: number;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const tone = over ? "hsl(var(--lg-alert))" : "hsl(var(--lg-ok))";
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={cn(
            "tabular font-medium",
            over ? "text-alert" : "text-ok"
          )}
        >
          {value}
          {unit}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary/70">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: tone,
          }}
        />
        {typeof threshold === "number" && (
          <div
            className="absolute inset-y-0 w-px bg-foreground/40"
            style={{ left: `${Math.min(100, (threshold / max) * 100)}%` }}
            title="limit"
          />
        )}
      </div>
    </div>
  );
}
