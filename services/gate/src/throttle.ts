/**
 * Behavior-reactive denial throttle.
 *
 * The gate tightens policy after repeated denials for the same authenticated
 * caller+action — but this MUST NOT be a permanent self-lock, and it must be
 * keyed on the authenticated identity (from the request signature), never on a
 * spoofable request-body string.
 *
 * Two guarantees this class provides:
 *   - reset on success: a granted request clears the counter for its key.
 *   - expiry: counters older than `windowMs` are treated as zero (and dropped),
 *     so a transient burst of denials heals over time on its own.
 *
 * (Phase 2 moves this state into the shared store so it holds across replicas.)
 */
export interface ThrottleEntry {
  count: number;
  firstAt: number;
}

export class DenialThrottle {
  private entries = new Map<string, ThrottleEntry>();

  constructor(private readonly windowMs = 5 * 60_000) {}

  /** Observed failures for a key, honoring the expiry window (auto-clears stale entries). */
  observed(key: string, now: number = Date.now()): number {
    const e = this.entries.get(key);
    if (!e) return 0;
    if (now - e.firstAt > this.windowMs) {
      this.entries.delete(key);
      return 0;
    }
    return e.count;
  }

  /** Record one denial for a key; a stale window restarts the count at 1. */
  recordDenial(key: string, now: number = Date.now()): void {
    const e = this.entries.get(key);
    if (!e || now - e.firstAt > this.windowMs) {
      this.entries.set(key, { count: 1, firstAt: now });
    } else {
      e.count += 1;
    }
  }

  /** Reset a key after a successful grant. */
  reset(key: string): void {
    this.entries.delete(key);
  }

  /** Drop all expired entries — call periodically to bound memory. */
  sweep(now: number = Date.now()): void {
    for (const [key, e] of this.entries) {
      if (now - e.firstAt > this.windowMs) this.entries.delete(key);
    }
  }

  size(): number {
    return this.entries.size;
  }
}
