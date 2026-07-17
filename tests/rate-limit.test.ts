import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/rate-limit";

function req(ip: string): Request {
  return new Request("http://localhost/api/test", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("rateLimit (in-memory fallback)", () => {
  it("allows up to the limit, then 429s with a retry hint", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await rateLimit(req("1.2.3.4"), { name: "t1", limit: 5 })).ok).toBe(true);
    }
    const blocked = await rateLimit(req("1.2.3.4"), { name: "t1", limit: 5 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterS).toBeGreaterThan(0);
  });

  it("tracks IPs independently", async () => {
    for (let i = 0; i < 3; i++) await rateLimit(req("5.5.5.5"), { name: "t2", limit: 3 });
    expect((await rateLimit(req("5.5.5.5"), { name: "t2", limit: 3 })).ok).toBe(false);
    expect((await rateLimit(req("6.6.6.6"), { name: "t2", limit: 3 })).ok).toBe(true);
  });

  it("tracks limiter names independently", async () => {
    for (let i = 0; i < 3; i++) await rateLimit(req("7.7.7.7"), { name: "t3", limit: 3 });
    expect((await rateLimit(req("7.7.7.7"), { name: "t3", limit: 3 })).ok).toBe(false);
    expect((await rateLimit(req("7.7.7.7"), { name: "t4", limit: 3 })).ok).toBe(true);
  });

  it("uses the first hop of x-forwarded-for", async () => {
    const chained = new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
    });
    for (let i = 0; i < 2; i++) await rateLimit(chained, { name: "t5", limit: 2 });
    expect((await rateLimit(chained, { name: "t5", limit: 2 })).ok).toBe(false);
    // Different first hop, same proxy chain tail — separate bucket.
    expect((await rateLimit(req("8.8.8.8"), { name: "t5", limit: 2 })).ok).toBe(true);
  });
});
