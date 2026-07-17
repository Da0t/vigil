"use client";

import { useCallback, useEffect, useState } from "react";
import type { LoopState } from "@/lib/contract";
import { AGENT_ROUTES } from "@/lib/contract";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "";

export type LiveStatus = "off" | "connecting" | "live" | "lost";

/**
 * Subscribes to the vigil-agent SSE stream. Each message is a full
 * LoopState snapshot — no event replay, no drift. When
 * NEXT_PUBLIC_AGENT_URL is unset the hook stays "off" and the caller
 * falls back to the scripted sim.
 */
export function useIncidentLive() {
  const [state, setState] = useState<LoopState | null>(null);
  const [status, setStatus] = useState<LiveStatus>(AGENT_URL ? "connecting" : "off");

  useEffect(() => {
    if (!AGENT_URL) return;
    const es = new EventSource(`${AGENT_URL}${AGENT_ROUTES.events}`);
    es.onopen = () => setStatus("live");
    es.onmessage = (e) => setState(JSON.parse(e.data) as LoopState);
    es.onerror = () => setStatus((s) => (s === "connecting" ? "connecting" : "lost"));
    return () => es.close();
  }, []);

  const post = useCallback((route: string) => {
    void fetch(`${AGENT_URL}${route}`, { method: "POST" }).catch(() => {});
  }, []);

  return {
    state,
    status,
    start: useCallback(() => post(AGENT_ROUTES.start), [post]),
    thrash: useCallback(() => post(AGENT_ROUTES.thrash), [post]),
    reset: useCallback(() => post(AGENT_ROUTES.reset), [post]),
  };
}
