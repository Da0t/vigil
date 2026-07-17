import { randomBytes } from "node:crypto";

export interface Grant {
  token: string;
  action: string;
  service: string;
  mintedAt: number;
  expiresAt: number;
  consumed: boolean;
  consumedAt?: number;
}

export class GrantStore {
  private grants = new Map<string, Grant>();

  mint(action: string, service: string, ttlSeconds = 60, now = Date.now()): Grant {
    const g: Grant = {
      token: `vg_${randomBytes(18).toString("base64url")}`,
      action, service, mintedAt: now,
      expiresAt: now + ttlSeconds * 1000,
      consumed: false,
    };
    this.grants.set(g.token, g);
    return g;
  }

  verifyAndConsume(token: string, action: string, service: string, now = Date.now()): { valid: boolean; reason?: string } {
    const g = this.grants.get(token);
    if (!g) return { valid: false, reason: "unknown grant" };
    if (g.consumed) return { valid: false, reason: "grant already used" };
    if (now > g.expiresAt) return { valid: false, reason: "grant expired" };
    if (g.action !== action || g.service !== service) return { valid: false, reason: "grant scope mismatch" };
    g.consumed = true;
    g.consumedAt = now;
    return { valid: true };
  }

  list(): Grant[] { return [...this.grants.values()]; }

  /** Count of live, unconsumed grants — should be 0 at rest. */
  standing(now = Date.now()): number {
    return this.list().filter((g) => !g.consumed && now <= g.expiresAt).length;
  }
}
