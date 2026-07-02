import "server-only";
import { kv } from "@vercel/kv";
import { isKvConfigured } from "@/lib/users";

// Per-IP fixed-window rate limiting for the proxy routes.
//
// Security context: the Origin allow-list on the proxies stops browsers,
// but not scripts — curl can send any Origin header. Rate limiting caps
// how hard a script can relay through our deployment (each relayed call
// bills us a function invocation, even though the provider cost is on
// the caller's own API key).
//
// Backing store: Vercel KV when configured (shared across lambdas),
// otherwise an in-process Map (per-instance — fine for dev, and still
// better than nothing if KV is missing in prod). KV errors fail OPEN:
// a KV outage should degrade to "no rate limit", not "app down".

type RateLimitResult = { ok: true } | { ok: false; retryAfterS: number };

const memory = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function memoryLimit(key: string, limit: number, windowS: number): RateLimitResult {
  const now = Date.now();
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    // Opportunistic sweep so the map doesn't grow unbounded.
    if (memory.size > 10_000) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    }
    memory.set(key, { count: 1, resetAt: now + windowS * 1000 });
    return { ok: true };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { ok: false, retryAfterS: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { ok: true };
}

async function kvLimit(key: string, limit: number, windowS: number): Promise<RateLimitResult> {
  const count = await kv.incr(key);
  if (count === 1) await kv.expire(key, windowS);
  if (count > limit) {
    const ttl = await kv.ttl(key);
    return { ok: false, retryAfterS: ttl > 0 ? ttl : windowS };
  }
  return { ok: true };
}

export async function rateLimit(
  request: Request,
  opts: { name: string; limit: number; windowS?: number },
): Promise<RateLimitResult> {
  const windowS = opts.windowS ?? 60;
  const key = `ai-cinema:rl:${opts.name}:${clientIp(request)}`;
  try {
    if (isKvConfigured()) return await kvLimit(key, opts.limit, windowS);
    return memoryLimit(key, opts.limit, windowS);
  } catch {
    return { ok: true }; // fail open
  }
}

export function rateLimitResponse(result: { ok: false; retryAfterS: number }): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests — slow down and retry." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterS),
      },
    },
  );
}
