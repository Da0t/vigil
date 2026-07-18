"use client";

import { Play, Pause, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SimState } from "@/lib/use-incident-sim";

function phaseLabel(s: SimState): string {
  if (!s.started) return "Idle · press play to watch Vigil work";
  if (s.gateState === "denied") return "Behavior-reactive clamp engaged";
  if (s.incidentStatus === "resolved" && !s.finished) return "Resolved · watching for drift";
  if (s.gateState === "allowed") return "Remediation granted · applying rollback";
  if (s.gateState === "pending") return "At the gate · awaiting decision";
  if (s.steps.find((x) => x.id === "sandbox")?.state === "active")
    return "Reproducing in disposable sandbox";
  if (s.finished) return "Loop complete";
  return "Diagnosing on live data";
}

export function SimControls({
  state,
  onToggle,
  onRestart,
  disabled = false,
}: {
  state: SimState;
  onToggle: () => void;
  onRestart: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onToggle} disabled={disabled} className="min-w-[104px]">
          {state.playing ? (
            <>
              <Pause className="h-3.5 w-3.5" /> Pause
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              {state.finished ? "Replay" : state.started ? "Resume" : "Play incident"}
            </>
          )}
        </Button>
        <Button size="sm" variant="ghost" onClick={onRestart} disabled={disabled} aria-label="restart">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex flex-1 items-center gap-3 sm:max-w-md">
        <span className="tabular text-[11px] text-muted-foreground">
          {state.started ? `T+${state.clock.toFixed(1)}s` : "T+0.0s"}
        </span>
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-secondary/70">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[hsl(var(--primary))] transition-[width] duration-200 ease-linear"
            style={{ width: `${state.progress * 100}%` }}
          />
        </div>
      </div>

      <span className="text-[11px] text-muted-foreground sm:min-w-[220px] sm:text-right">
        {phaseLabel(state)}
      </span>
    </div>
  );
}
