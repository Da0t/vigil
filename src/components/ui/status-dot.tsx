import { cn } from "@/lib/utils";

/**
 * A small status dot. `signal` (red) = active/alerting, `ok` (bone) = healthy,
 * `alert` = critical. `pulse` adds the live heartbeat.
 */
export function StatusDot({
  tone = "signal",
  pulse = false,
  className,
}: {
  tone?: "signal" | "ok" | "alert" | "amber" | "muted";
  pulse?: boolean;
  className?: string;
}) {
  const colors: Record<string, string> = {
    signal: "bg-[hsl(var(--primary))] shadow-[0_0_10px_hsl(var(--primary)/0.8)]",
    alert: "bg-[hsl(var(--lg-alert))] shadow-[0_0_12px_hsl(var(--lg-alert)/0.9)]",
    ok: "bg-[hsl(var(--lg-ok))] shadow-[0_0_8px_hsl(var(--lg-ok)/0.5)]",
    amber: "bg-[hsl(var(--lg-amber))] shadow-[0_0_10px_hsl(var(--lg-amber)/0.8)]",
    muted: "bg-muted-foreground/50",
  };
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)}>
      {pulse && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            colors[tone].split(" ")[0]
          )}
        />
      )}
      <span
        className={cn(
          "relative inline-flex h-2 w-2 rounded-full",
          colors[tone]
        )}
      />
    </span>
  );
}
