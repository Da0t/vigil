"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2, Circle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SourceChip } from "@/components/ui/chip";
import type { AgentStep, SandboxResult } from "@/lib/types";

function StepIcon({ state }: { state: AgentStep["state"] }) {
  if (state === "done")
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[hsl(var(--lg-ok)/0.14)] ring-1 ring-[hsl(var(--lg-ok)/0.3)]">
        <Check className="h-3.5 w-3.5 text-ok" />
      </span>
    );
  if (state === "active")
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 ring-1 ring-primary/50">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--primary))]" />
      </span>
    );
  if (state === "failed")
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-[hsl(var(--lg-alert)/0.14)] ring-1 ring-[hsl(var(--lg-alert)/0.4)]">
        <X className="h-3.5 w-3.5 text-alert" />
      </span>
    );
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary/40 ring-1 ring-border/70">
      <Circle className="h-2 w-2 text-muted-foreground/50" />
    </span>
  );
}

const LIFECYCLE_LABEL: Record<SandboxResult["lifecycle"], string> = {
  provisioning: "provisioning",
  running: "running",
  done: "passed",
  torn_down: "torn down",
  failed: "failed",
};

export function AgentTimeline({
  steps,
  sandbox,
  started,
}: {
  steps: AgentStep[];
  sandbox: SandboxResult;
  started: boolean;
}) {
  return (
    <div className="space-y-1">
      {steps.map((step, i) => {
        const visible = started || i === 0;
        const dim = step.state === "pending";
        return (
          <div key={step.id} className="relative flex gap-3.5 pb-3 last:pb-0">
            {/* connector line */}
            {i < steps.length - 1 && (
              <span
                className={cn(
                  "absolute left-3 top-7 h-[calc(100%-12px)] w-px",
                  step.state === "done" ? "bg-[hsl(var(--lg-ok)/0.25)]" : "bg-border/60"
                )}
              />
            )}
            <div className="relative z-10 pt-0.5">
              <StepIcon state={step.state} />
            </div>
            <div
              className={cn(
                "min-w-0 flex-1 transition-opacity duration-300",
                dim ? "opacity-45" : "opacity-100"
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={cn(
                    "text-sm font-medium",
                    step.state === "active" && "text-foreground"
                  )}
                >
                  {step.label}
                </span>
                <SourceChip source={step.source} />
                {typeof step.cost === "number" && step.state !== "pending" && (
                  <span className="tabular text-[11px] text-amber">
                    ${step.cost.toFixed(2)}/call
                  </span>
                )}
                {step.at && step.state !== "pending" && (
                  <span className="tabular ml-auto text-[10px] text-muted-foreground/70">
                    {step.at}
                  </span>
                )}
              </div>

              <AnimatePresence mode="wait">
                {step.state !== "pending" && step.detail && (
                  <motion.p
                    key={step.detail}
                    initial={{ opacity: 0, y: -3 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="tabular mt-1 font-mono text-[11px] text-muted-foreground"
                  >
                    {step.detail}
                  </motion.p>
                )}
              </AnimatePresence>

              {/* Akash lifecycle chips under the sandbox step */}
              {step.id === "sandbox" && step.state !== "pending" && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {(["provisioning", "running", "done", "torn_down"] as const).map(
                    (phase) => {
                      const order = ["provisioning", "running", "done", "torn_down"];
                      const reached =
                        order.indexOf(sandbox.lifecycle) >= order.indexOf(phase);
                      const current = sandbox.lifecycle === phase;
                      return (
                        <span
                          key={phase}
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-wide transition-colors",
                            current
                              ? "bg-primary/12 text-[hsl(var(--primary))] ring-1 ring-primary/30"
                              : reached
                                ? "bg-[hsl(var(--lg-ok)/0.1)] text-ok"
                                : "bg-secondary/40 text-muted-foreground/50"
                          )}
                        >
                          {LIFECYCLE_LABEL[phase]}
                        </span>
                      );
                    }
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
