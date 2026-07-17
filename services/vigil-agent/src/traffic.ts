const results: { t: number; ok: boolean }[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

export function startTraffic(paymentsUrl: string, intervalMs = 100) {
  stopTraffic();
  timer = setInterval(async () => {
    // Skip this tick if the prior request is still pending — no overlapping,
    // unbounded pile-up of un-awaited fetches when payments-api is slow/down.
    if (inFlight) return;
    inFlight = true;
    try {
      // A hung payments-api must read as a FAILED request (outage), not a
      // stale-zero gap, so time each request out and count timeouts as failures.
      const r = await fetch(`${paymentsUrl}/pay`, { signal: AbortSignal.timeout(2000) });
      results.push({ t: Date.now(), ok: r.ok });
    } catch {
      results.push({ t: Date.now(), ok: false });
    } finally {
      inFlight = false;
      if (results.length > 1500) results.splice(0, results.length - 1500);
    }
  }, intervalMs);
}

export function stopTraffic() { if (timer) clearInterval(timer); timer = null; }
export function clearTraffic() { results.length = 0; }

export function errorRate(windowMs = 3000): number {
  const cut = Date.now() - windowMs;
  const w = results.filter((r) => r.t >= cut);
  if (!w.length) return 0;
  return (100 * w.filter((r) => !r.ok).length) / w.length;
}

/** 54 bucketed samples over the last 9s — matches the sparkline the UI expects. */
export function series(samples = 54, windowMs = 9000): number[] {
  const now = Date.now();
  const bucket = windowMs / samples;
  const out: number[] = [];
  for (let i = 0; i < samples; i++) {
    const end = now - windowMs + (i + 1) * bucket;
    const w = results.filter((r) => r.t >= end - bucket * 3 && r.t < end);
    out.push(w.length ? (100 * w.filter((r) => !r.ok).length) / w.length : 0);
  }
  return out;
}
