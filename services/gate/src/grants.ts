import { randomBytes } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

export interface Grant {
  token: string;
  action: string;
  service: string;
  mintedAt: number;
  expiresAt: number;
  consumed: boolean;
  consumedAt?: number;
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

/**
 * A grant store issues single-use, scoped, TTL'd grants and consumes them
 * exactly once. The interface is async so it can be backed by a shared store
 * (Redis) in prod — which is what makes single-use hold across replicas and
 * survive restarts — while dev keeps a zero-dependency in-memory store.
 */
export interface GrantStore {
  mint(action: string, service: string, ttlSeconds?: number, now?: number): Promise<Grant>;
  verifyAndConsume(token: string, action: string, service: string, now?: number): Promise<VerifyResult>;
  list(): Promise<Grant[]>;
  standing(now?: number): Promise<number>;
  sweep(now?: number): void | Promise<void>;
  close(): Promise<void>;
}

function newToken(): string {
  return `vg_${randomBytes(18).toString("base64url")}`;
}

/** Single-threaded JS makes each check-and-set atomic within one process. */
export class MemoryGrantStore implements GrantStore {
  private grants = new Map<string, Grant>();

  async mint(action: string, service: string, ttlSeconds = 60, now = Date.now()): Promise<Grant> {
    const g: Grant = {
      token: newToken(),
      action,
      service,
      mintedAt: now,
      expiresAt: now + ttlSeconds * 1000,
      consumed: false,
    };
    this.grants.set(g.token, g);
    return g;
  }

  async verifyAndConsume(token: string, action: string, service: string, now = Date.now()): Promise<VerifyResult> {
    const g = this.grants.get(token);
    if (!g) return { valid: false, reason: "unknown grant" };
    if (g.consumed) return { valid: false, reason: "grant already used" };
    if (now > g.expiresAt) return { valid: false, reason: "grant expired" };
    if (g.action !== action || g.service !== service) return { valid: false, reason: "grant scope mismatch" };
    g.consumed = true;
    g.consumedAt = now;
    return { valid: true };
  }

  async list(): Promise<Grant[]> {
    return [...this.grants.values()];
  }

  async standing(now = Date.now()): Promise<number> {
    return [...this.grants.values()].filter((g) => !g.consumed && now <= g.expiresAt).length;
  }

  sweep(now = Date.now()): void {
    for (const [token, g] of this.grants) {
      if (g.consumed || now > g.expiresAt) this.grants.delete(token);
    }
  }

  async close(): Promise<void> {
    this.grants.clear();
  }
}

/**
 * Redis-backed store. verifyAndConsume is a Lua script (GET → validate → set
 * consumed) which Redis runs atomically, so with N gate replicas sharing one
 * Redis a single token is spent exactly once. Grants carry a Redis TTL, so
 * expired keys evict themselves (bounded growth).
 */
const KEY = (token: string) => `vigil:grant:${token}`;

// Returns "OK" on success, otherwise a human reason. Atomic under Redis.
const CONSUME_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'unknown grant' end
local g = cjson.decode(raw)
if g.consumed then return 'grant already used' end
if tonumber(ARGV[3]) > tonumber(g.expiresAt) then return 'grant expired' end
if g.action ~= ARGV[1] or g.service ~= ARGV[2] then return 'grant scope mismatch' end
g.consumed = true
g.consumedAt = tonumber(ARGV[3])
redis.call('SET', KEYS[1], cjson.encode(g), 'KEEPTTL')
return 'OK'
`;

export class RedisGrantStore implements GrantStore {
  private client: RedisClientType;
  private ready: Promise<void>;

  constructor(url: string) {
    this.client = createClient({ url });
    this.client.on("error", (e) => console.error("[gate] redis error:", (e as Error).message));
    this.ready = this.client.connect().then(() => undefined);
  }

  private async db(): Promise<RedisClientType> {
    await this.ready;
    return this.client;
  }

  async mint(action: string, service: string, ttlSeconds = 60, now = Date.now()): Promise<Grant> {
    const g: Grant = {
      token: newToken(),
      action,
      service,
      mintedAt: now,
      expiresAt: now + ttlSeconds * 1000,
      consumed: false,
    };
    const db = await this.db();
    // TTL a little past logical expiry so a just-expired grant still reports
    // "expired" rather than "unknown", then evicts itself.
    await db.set(KEY(g.token), JSON.stringify(g), { EX: ttlSeconds + 30 });
    return g;
  }

  async verifyAndConsume(token: string, action: string, service: string, now = Date.now()): Promise<VerifyResult> {
    const db = await this.db();
    const res = (await db.eval(CONSUME_LUA, {
      keys: [KEY(token)],
      arguments: [action, service, String(now)],
    })) as string;
    return res === "OK" ? { valid: true } : { valid: false, reason: res };
  }

  async list(): Promise<Grant[]> {
    const db = await this.db();
    const out: Grant[] = [];
    for await (const key of db.scanIterator({ MATCH: KEY("*"), COUNT: 100 })) {
      const raw = await db.get(key as string);
      if (raw) out.push(JSON.parse(raw) as Grant);
    }
    return out;
  }

  async standing(now = Date.now()): Promise<number> {
    return (await this.list()).filter((g) => !g.consumed && now <= g.expiresAt).length;
  }

  sweep(): void {
    // No-op: Redis TTL evicts expired keys automatically.
  }

  async close(): Promise<void> {
    await this.ready.catch(() => {});
    await this.client.quit().catch(() => {});
  }
}

/** Pick the store from config: Redis when a URL is given, else in-memory (dev). */
export function createGrantStore(redisUrl?: string): GrantStore {
  if (redisUrl) {
    console.log(`[gate] grant store: Redis (${redisUrl.replace(/\/\/.*@/, "//***@")})`);
    return new RedisGrantStore(redisUrl);
  }
  console.log("[gate] grant store: in-memory (dev)");
  return new MemoryGrantStore();
}
