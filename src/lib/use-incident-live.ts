"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LoopState } from "@/lib/contract";
import { AGENT_ROUTES } from "@/lib/contract";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "";

export type LiveStatus =
  | "off"
  | "connecting"
  | "live"
  | "reconnecting"
  | "lost";

/** Reconnect backoff: 1s, 2s, 4s, 8s … capped at 15s. */
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 15_000;
/** After this many consecutive failed attempts we surface "lost" (still retrying). */
const LOST_AFTER_ATTEMPTS = 4;

/**
 * Subscribes to the vigil-agent SSE stream. Each message is a full
 * LoopState snapshot — no event replay, no drift. When
 * NEXT_PUBLIC_AGENT_URL is unset the hook stays "off" and the caller
 * falls back to the scripted sim.
 *
 * On a dropped stream the last snapshot is RETAINED (never reverted to
 * sim) while the hook reconnects with exponential backoff, surfacing a
 * "reconnecting" → "lost" status and recovering to "live" on reopen.
 * Control POSTs report failures via `controlError`, and the connection
 * status drives `controlsDisabled` so the UI can lock the buttons while
 * the backend is unreachable.
 */
export function useIncidentLive() {
  const [state, setState] = useState<LoopState | null>(null);
  const [status, setStatus] = useState<LiveStatus>(AGENT_URL ? "connecting" : "off");
  const [controlError, setControlError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!AGENT_URL) return;
    closedRef.current = false;

    const clearRetry = () => {
      if (retryRef.current) {
        clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };

    // We own reconnection instead of leaning on EventSource's implicit retry,
    // so the UI can reflect "reconnecting"/"lost" and back off deterministically.
    const connect = () => {
      if (closedRef.current) return;
      const es = new EventSource(`${AGENT_URL}${AGENT_ROUTES.events}`);
      esRef.current = es;

      es.onopen = () => {
        attemptsRef.current = 0;
        clearRetry();
        setStatus("live");
      };

      es.onmessage = (e) => {
        try {
          setState(JSON.parse(e.data) as LoopState);
        } catch {
          // Malformed snapshot — drop it, keep the last good state and the
          // stream alive rather than crashing the loop or the app.
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        if (closedRef.current) return;

        const attempt = (attemptsRef.current += 1);
        // Retained snapshot is left untouched; only the status changes.
        setStatus(attempt >= LOST_AFTER_ATTEMPTS ? "lost" : "reconnecting");

        const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
        clearRetry();
        retryRef.current = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      clearRetry();
      esRef.current?.close();
      esRef.current = null;
    };
  }, []);

  const post = useCallback(async (route: string, action: string) => {
    if (!AGENT_URL) return;
    try {
      const res = await fetch(`${AGENT_URL}${route}`, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setControlError(null);
    } catch {
      setControlError(`Couldn't ${action} — agent unreachable.`);
    }
  }, []);

  const controlsDisabled = status === "reconnecting" || status === "lost";

  return {
    state,
    status,
    controlsDisabled,
    controlError,
    start: useCallback(() => post(AGENT_ROUTES.start, "start the incident"), [post]),
    thrash: useCallback(() => post(AGENT_ROUTES.thrash, "trigger the thrash"), [post]),
    reset: useCallback(() => post(AGENT_ROUTES.reset, "reset the loop"), [post]),
  };
}
