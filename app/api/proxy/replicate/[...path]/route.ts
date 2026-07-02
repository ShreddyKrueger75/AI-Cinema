import { NextResponse } from "next/server";
import { isAllowedOrigin } from "@/lib/app-url";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

// Server-side proxy for api.replicate.com.
// Replicate doesn't send CORS headers, so browser calls fail with
// "Failed to fetch" before any response is read. This route relays
// the call server-side using the user's key from x-provider-key.
// The key is read from the header per request and never persisted
// or logged.

const REPLICATE_BASE = "https://api.replicate.com";
const REPLICATE_HOST = "api.replicate.com";

export const runtime = "nodejs";

async function relay(request: Request, pathParts: string[]) {
  // Origin check: refuse cross-site or scripted invocations. Our own
  // browser code always sends a same-origin Origin header; curl / random
  // sites either omit it or send something else.
  if (!isAllowedOrigin(request)) {
    return NextResponse.json(
      { error: "Forbidden: origin not allowed" },
      { status: 403 },
    );
  }

  // Rate limit AFTER the origin check (don't let junk traffic consume the
  // budget of legit users behind the same IP) but BEFORE the upstream call.
  // 120/min per IP is generous for real editing (status polling runs ~1/s
  // per active job) while capping relay abuse.
  const rl = await rateLimit(request, { name: "replicate", limit: 120 });
  if (!rl.ok) return rateLimitResponse(rl);

  const key = request.headers.get("x-provider-key");
  if (!key) {
    return NextResponse.json(
      { error: "Missing x-provider-key header" },
      { status: 401 },
    );
  }

  const path = pathParts.join("/");
  const incomingUrl = new URL(request.url);
  const target = `${REPLICATE_BASE}/${path}${incomingUrl.search}`;

  // Defense in depth: confirm the resolved URL stays on the Replicate host.
  // WHATWG URL parsing handles most weird inputs, but a future routing change
  // (or a userinfo-laden path) shouldn't be able to swap upstreams silently.
  try {
    const parsed = new URL(target);
    if (parsed.host !== REPLICATE_HOST) {
      return NextResponse.json({ error: "Invalid upstream" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid upstream URL" }, { status: 400 });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
  };
  const ct = request.headers.get("content-type");
  if (ct) headers["Content-Type"] = ct;
  const prefer = request.headers.get("prefer");
  if (prefer) headers["Prefer"] = prefer;

  const init: RequestInit = {
    method: request.method,
    headers,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const upstream = await fetch(target, init);
  const responseHeaders: Record<string, string> = {};
  const upstreamCt = upstream.headers.get("content-type");
  if (upstreamCt) responseHeaders["Content-Type"] = upstreamCt;
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return relay(request, path);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return relay(request, path);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return relay(request, path);
}
