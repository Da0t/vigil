"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  ShieldX,
  ShieldQuestion,
  Lock,
  KeyRound,
  Check,
} from "lucide-react";
import { GlassCard } from "@/components/ui/card";
import { SourceChip, Pill } from "@/components/ui/chip";
import { Meter } from "@/components/ui/meter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SimState } from "@/lib/use-incident-sim";

function VerdictHeader({ state }: { state: SimState }) {
  const g = state.gateState;
  if (g === "allowed") {
    return (
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--lg-ok)/0.12)] ring-1 ring-[hsl(var(--lg-ok)/0.3)]">
          <ShieldCheck className="h-5 w-5 text-ok" />
        </span>
        <div>
          <div className="text-base font-semibold text-ok">Allowed</div>
          <div className="text-xs text-muted-foreground">scoped · single-use · time-boxed</div>
        </div>
      </div>
    );
  }
  if (g === "denied") {
    return (
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-[hsl(var(--lg-alert)/0.14)] ring-1 ring-[hsl(var(--lg-alert)/0.4)]">
          <ShieldX className="h-5 w-5 text-alert" />
        </span>
        <div>
          <div className="text-base font-semibold text-alert">Denied</div>
          <div className="text-xs text-muted-foreground">escalation refused · policy tightened</div>
        </div>
      </div>
    );
  }
  if (g === "pending") {
    return (
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/12 ring-1 ring-primary/40">
          <ShieldQuestion className="h-5 w-5 text-[hsl(var(--primary))]" />
        </span>
        <div>
          <div className="text-base font-semibold text-foreground">Evaluating</div>
          <div className="text-xs text-muted-foreground">policy querying live loop state</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary/50 ring-1 ring-border/70">
        <Lock className="h-5 w-5 text-muted-foreground" />
      </span>
      <div>
        <div className="text-base font-semibold text-foreground">Gate armed</div>
        <div className="text-xs text-muted-foreground">holds the only path to a credential</div>
      </div>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "ok" | "alert" | "amber" }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span
        className={cn(
          "tabular text-right font-mono text-xs",
          tone === "ok" && "text-ok",
          tone === "alert" && "text-alert",
          tone === "amber" && "text-amber",
          !tone && "text-foreground"
        )}
      >
        {v}
      </span>
    </div>
  );
}

export function GatePanel({ state }: { state: SimState }) {
  const g = state.gateState;
  const thrash = state.blastRadius >= 12;

  const req =
    g === "denied"
      ? { action: state.denial?.action ?? "mass-restart across 12 services", scope: state.denial?.scope ?? "requested: 12 services" }
      : g === "allowed"
        ? { action: state.gate?.action ?? "rollback payments-api", scope: state.gate?.scope ?? "payments-api only" }
        : thrash
          ? { action: "mass-restart across 12 services", scope: "requested: 12 services" }
          : { action: "rollback payments-api", scope: "payments-api only" };

  const decisions = [
    state.gate && { ...state.gate },
    state.denial && { ...state.denial },
  ].filter(Boolean) as NonNullable<SimState["gate"]>[];

  return (
    <GlassCard
      glow={g === "allowed"}
      alert={g === "denied"}
      className="flex flex-col"
    >
      <div className="flex items-center justify-between border-b border-border/50 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          Remediation gate
        </div>
        <SourceChip source="pomerium" />
      </div>

      <div className="space-y-4 p-5">
        <VerdictHeader state={state} />

        {/* pending scan sweep */}
        <AnimatePresence>
          {g === "pending" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative h-1 overflow-hidden rounded-full bg-secondary/70"
            >
              <div
                className="absolute inset-y-0 w-1/3 rounded-full bg-[hsl(var(--primary))]"
                style={{
                  animation: "shimmer 1.1s linear infinite",
                  background:
                    "linear-gradient(90deg, transparent, hsl(var(--primary)), transparent)",
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* request detail */}
        <div className="rounded-xl border border-border/60 bg-secondary/25 px-4 py-2">
          <Row k="Action" v={req.action} tone={g === "denied" ? "alert" : undefined} />
          <Row k="Scope" v={req.scope} tone={g === "allowed" ? "ok" : g === "denied" ? "alert" : undefined} />
          <Row
            k="Credential"
            v={
              g === "allowed"
                ? state.grantConsumed
                  ? "consumed · expired"
                  : "single-use · 60s TTL"
                : g === "denied"
                  ? "not issued"
                  : "not yet issued"
            }
            tone={g === "allowed" ? "ok" : g === "denied" ? "alert" : undefined}
          />
          <Row k="Budget" v={state.gate?.budgetOk === false ? "over limit" : "under limit"} tone="ok" />
        </div>

        {/* live grant window */}
        <AnimatePresence>
          {g === "allowed" && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="space-y-1.5"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Grant window</span>
                <span className={cn("tabular", state.grantConsumed ? "text-ok" : "text-foreground")}>
                  {state.grantConsumed ? "credential evaporated" : "consuming…"}
                </span>
              </div>
              <div className="relative h-1.5 overflow-hidden rounded-full bg-secondary/70">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-[hsl(var(--lg-ok))] transition-[width] duration-200 ease-linear"
                  style={{ width: `${state.grantWindow * 100}%` }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* deny reason */}
        <AnimatePresence>
          {g === "denied" && state.denial?.reason && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-[hsl(var(--lg-alert)/0.35)] bg-[hsl(var(--lg-alert)/0.08)] px-4 py-3"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-alert">
                <ShieldX className="h-3.5 w-3.5" />
                Behavior-reactive clamp
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {state.denial.reason}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* behavior-reactive policy state */}
        <div className="space-y-3 rounded-xl border border-border/60 bg-secondary/20 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Policy state
            </span>
            <span className="text-[10px] text-muted-foreground/70">read on every request</span>
          </div>
          <Meter label="Spend budget" value={Number(state.budgetUsed.toFixed(2))} max={state.budgetMax} unit={` / $${state.budgetMax}`} />
          <Meter
            label="Blast radius"
            value={state.blastRadius}
            max={state.blastMax}
            unit={` svc`}
            threshold={state.blastThreshold}
            over={state.blastRadius > state.blastThreshold}
          />
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Consecutive failures</span>
            <span
              className={cn(
                "tabular font-medium",
                state.consecutiveFailures >= 2 ? "text-alert" : "text-foreground"
              )}
            >
              {state.consecutiveFailures}
            </span>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground/80">
            Authorization is a function of live loop state. Thrash and the policy
            tightens on its own.
          </p>
        </div>

        {/* decision log */}
        {decisions.length > 0 && (
          <div className="space-y-1.5">
            {decisions.map((d, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-secondary/20 px-3 py-1.5"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Pill tone={d.verdict === "allowed" ? "ok" : "alert"}>
                    {d.verdict}
                  </Pill>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {d.action}
                  </span>
                </div>
                <span className="tabular shrink-0 text-[10px] text-muted-foreground/70">
                  {d.at}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* actions */}
        <div className="flex gap-2 pt-1">
          <Button
            className="flex-1"
            variant={g === "allowed" ? "outline" : "default"}
            disabled={g !== "pending"}
          >
            {g === "allowed" ? (
              <>
                <Check className="h-3.5 w-3.5 text-ok" /> Approved
              </>
            ) : (
              "Approve rollback"
            )}
          </Button>
          <Button variant="outline" className="flex-1" disabled={g !== "pending"}>
            Hold
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}
