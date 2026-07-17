"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentStep, AuditEntry } from "@/lib/types";
import type { GateState, LoopState } from "@/lib/contract";

export type { GateState };

/** The sim and the live orchestrator share one state shape — see contract.ts. */
export type SimState = LoopState;

const TICK = 0.2;
const END = 15.6;
const WINDOW_SECONDS = 9;
const SAMPLES = 54;

const ease = (p: number) => 1 - (1 - p) * (1 - p);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const noise = (t: number, amp = 0.35) =>
  Math.sin(t * 6.7) * amp + Math.sin(t * 2.3 + 1.1) * amp * 0.6;

/** Error rate as a function of the sim clock (percent 5xx). */
function rateAt(t: number): number {
  if (t <= 0) return 6;
  if (t <= 0.5) return lerp(6, 13, t / 0.5);
  if (t <= 8.4) return 13 + ((t - 0.5) / 7.9) * 1.7 + noise(t, 0.32);
  if (t <= 10.8) {
    const p = ease((t - 8.4) / 2.4);
    return Math.max(0.3, lerp(14.6, 0.4, p) + noise(t, 0.12));
  }
  return 0.32 + Math.abs(noise(t, 0.06));
}

function windowSeries(clock: number): number[] {
  const out: number[] = [];
  const start = clock - WINDOW_SECONDS;
  for (let i = 0; i < SAMPLES; i++) {
    const t = start + (WINDOW_SECONDS * i) / (SAMPLES - 1);
    out.push(Math.max(0, rateAt(t)));
  }
  return out;
}

const STEP_DEFS: Omit<AgentStep, "state">[] = [
  {
    id: "detect",
    label: "Detected from live traffic",
    source: "agent",
    detail: "5xx over threshold · no page raised",
  },
  {
    id: "context",
    label: "Pulled incident context",
    source: "agent",
    detail: "deploy #4821 · read of recent change set",
  },
  {
    id: "capability",
    label: "Found a capability it lacked",
    source: "zero",
    detail: "log-parser · called per use",
    cost: 0.04,
  },
  {
    id: "sandbox",
    label: "Reproduced in sandbox",
    source: "akash",
    detail: "sandbox_passed=true · recommended_action=rollback",
  },
  {
    id: "remediation",
    label: "Requesting remediation",
    source: "pomerium",
    detail: "rollback payments-api",
  },
];

function freshState(): SimState {
  return {
    clock: 0,
    playing: false,
    started: false,
    finished: false,
    progress: 0,
    incidentStatus: "active",
    errorRate: 14.2,
    series: [6.1, 9.4, 11.2, 12.8, 13.1, 13.9, 14.2, 14.0, 14.4, 14.2],
    steps: STEP_DEFS.map((s) => ({ ...s, state: "pending" as const })),
    sandbox: {
      provider: "akash",
      lifecycle: "provisioning",
      sandboxPassed: false,
      recommendedAction: "rollback",
      region: "akash · us-west",
    },
    gateState: "idle",
    gate: null,
    denial: null,
    grantWindow: 1,
    grantConsumed: false,
    budgetUsed: 0,
    budgetMax: 5,
    blastRadius: 0,
    blastMax: 12,
    blastThreshold: 3,
    consecutiveFailures: 0,
    standingCredentials: 0,
    audit: [],
  };
}

interface SimEvent {
  id: string;
  at: number;
  apply: (s: SimState) => void;
}

const stamp = (t: number) => `T+${t.toFixed(1)}s`;

function setStep(s: SimState, id: string, state: AgentStep["state"]) {
  s.steps = s.steps.map((st) => (st.id === id ? { ...st, state, at: stamp(s.clock) } : st));
}

function audit(
  s: SimState,
  event: string,
  actor: string,
  tone: AuditEntry["tone"] = "neutral",
  detail?: string
) {
  s.audit = [
    ...s.audit,
    { id: `${event}-${s.audit.length}`, at: stamp(s.clock), actor, event, tone, detail },
  ];
}

const EVENTS: SimEvent[] = [
  {
    id: "start",
    at: 0,
    apply: (s) => {
      setStep(s, "detect", "active");
      audit(s, "Alert raised · 5xx over threshold", "agent", "signal", "payments-api 5xx");
    },
  },
  {
    id: "context",
    at: 1.2,
    apply: (s) => {
      setStep(s, "detect", "done");
      setStep(s, "context", "active");
      audit(s, "Incident context pulled", "agent", "neutral", "read · deploy #4821");
    },
  },
  {
    id: "capability",
    at: 2.6,
    apply: (s) => {
      setStep(s, "context", "done");
      setStep(s, "capability", "active");
      audit(s, "Shopped Zero for a log parser", "zero", "neutral", "capability the loop lacked");
    },
  },
  {
    id: "capability-call",
    at: 3.4,
    apply: (s) => {
      s.budgetUsed = 0.04;
      audit(s, "Capability called · $0.04", "zero", "neutral", "wallet within budget");
    },
  },
  {
    id: "sandbox-provision",
    at: 4.0,
    apply: (s) => {
      setStep(s, "capability", "done");
      setStep(s, "sandbox", "active");
      s.sandbox = { ...s.sandbox, lifecycle: "provisioning" };
      s.budgetUsed = 0.06;
      audit(s, "Provisioning disposable sandbox", "akash", "neutral", "ephemeral box");
    },
  },
  {
    id: "sandbox-run",
    at: 4.8,
    apply: (s) => {
      s.sandbox = { ...s.sandbox, lifecycle: "running" };
      audit(s, "Sandbox running · replaying traffic", "akash", "neutral");
    },
  },
  {
    id: "sandbox-pass",
    at: 6.2,
    apply: (s) => {
      s.sandbox = { ...s.sandbox, lifecycle: "done", sandboxPassed: true };
      setStep(s, "sandbox", "done");
      audit(s, "Sandbox passed", "akash", "ok", "recommended_action=rollback");
    },
  },
  {
    id: "sandbox-teardown",
    at: 6.8,
    apply: (s) => {
      s.sandbox = { ...s.sandbox, lifecycle: "torn_down" };
      audit(s, "Sandbox torn down · no residue", "akash", "neutral");
    },
  },
  {
    id: "request",
    at: 7.2,
    apply: (s) => {
      setStep(s, "remediation", "active");
      s.gateState = "pending";
      audit(s, "Requesting remediation at the gate", "pomerium", "signal", "no standing credential held");
    },
  },
  {
    id: "allowed",
    at: 8.6,
    apply: (s) => {
      s.gateState = "allowed";
      s.blastRadius = 1;
      s.grantWindow = 1;
      s.grantConsumed = false;
      s.gate = {
        action: "rollback payments-api",
        verdict: "allowed",
        scope: "payments-api only",
        credential: { singleUse: true, ttlSeconds: 60 },
        budgetOk: true,
        attributedTo: "vigil-agent",
        at: stamp(s.clock),
      };
      setStep(s, "remediation", "done");
      s.incidentStatus = "resolving";
      audit(s, "Gate allowed · scoped, single-use, 60s TTL", "pomerium", "ok", "payments-api only");
    },
  },
  {
    id: "apply",
    at: 8.9,
    apply: (s) => {
      audit(s, "Rollback applied to payments-api", "agent", "signal", "deploy #4821 reverted");
    },
  },
  {
    id: "resolved",
    at: 10.9,
    apply: (s) => {
      s.incidentStatus = "resolved";
      audit(s, "Error rate recovered · incident resolved", "agent", "ok");
    },
  },
  {
    id: "expire",
    at: 11.6,
    apply: (s) => {
      s.grantConsumed = true;
      s.grantWindow = 0;
      audit(s, "Single-use credential expired", "pomerium", "ok", "0 standing credentials held");
    },
  },
  {
    id: "thrash-attempt",
    at: 12.8,
    apply: (s) => {
      s.gateState = "pending";
      s.blastRadius = 12;
      audit(s, "Agent attempts escalation", "agent", "signal", "mass-restart across 12 services");
    },
  },
  {
    id: "denied",
    at: 13.9,
    apply: (s) => {
      s.gateState = "denied";
      s.consecutiveFailures = 2;
      s.denial = {
        action: "mass-restart across 12 services",
        verdict: "denied",
        scope: "requested: 12 services",
        reason: "blast radius over limit · policy tightened after repeat failure",
        budgetOk: true,
        attributedTo: "vigil-agent",
        at: stamp(s.clock),
      };
      audit(s, "Gate denied · blast radius over limit", "pomerium", "alert", "12 services requested");
      audit(s, "Policy tightened · escalation refused", "pomerium", "alert");
    },
  },
  {
    id: "replan",
    at: 14.6,
    apply: (s) => {
      audit(s, "Vigil re-planned around the denial", "agent", "neutral", "held scope to single service");
    },
  },
];

/**
 * Drives the payments-api incident as a scripted live loop:
 * detect, plan, acquire, reproduce, request, gate (allow), then a thrash
 * that trips the behavior-reactive clamp.
 */
export function useIncidentSim() {
  const [state, setState] = useState<SimState>(freshState);
  const ref = useRef(state);
  const firedRef = useRef<Set<string>>(new Set());
  ref.current = state;

  const tick = useCallback(() => {
    const prev = ref.current;
    if (!prev.playing) return;

    const clock = Math.min(END, prev.clock + TICK);
    const next: SimState = {
      ...prev,
      clock,
      progress: Math.min(1, clock / END),
    };

    for (const ev of EVENTS) {
      if (ev.at <= clock && !firedRef.current.has(ev.id)) {
        firedRef.current.add(ev.id);
        ev.apply(next);
      }
    }

    next.errorRate = rateAt(clock);
    next.series = windowSeries(clock);

    // grant window drains after the allow, until the expire beat consumes it
    if (next.gateState !== "idle" && next.gate && !next.grantConsumed) {
      const drain = Math.max(0, 1 - (clock - 8.6) / 3);
      next.grantWindow = next.gateState === "denied" ? next.grantWindow : drain;
    }

    if (clock >= END) {
      next.playing = false;
      next.finished = true;
    }

    setState(next);
  }, []);

  useEffect(() => {
    const h = setInterval(tick, TICK * 1000);
    return () => clearInterval(h);
  }, [tick]);

  const play = useCallback(() => {
    setState((s) => {
      if (s.finished) {
        firedRef.current = new Set();
        return { ...freshState(), playing: true, started: true };
      }
      return { ...s, playing: true, started: true };
    });
  }, []);

  const pause = useCallback(() => setState((s) => ({ ...s, playing: false })), []);

  const restart = useCallback(() => {
    firedRef.current = new Set();
    setState({ ...freshState(), playing: true, started: true });
  }, []);

  const toggle = useCallback(() => {
    setState((s) => {
      if (s.finished) {
        firedRef.current = new Set();
        return { ...freshState(), playing: true, started: true };
      }
      return { ...s, playing: !s.playing, started: true };
    });
  }, []);

  return { state, play, pause, restart, toggle };
}
