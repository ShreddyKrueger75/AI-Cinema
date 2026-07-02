import { NextResponse } from "next/server";
import { isAllowedOrigin } from "@/lib/app-url";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

// Server-side proxy for image.pollinations.ai used ONLY when the user
// has a Pollinations token saved. Keeps the token out of the URL
// (where it would leak via access logs, browser history, and Referer).
// Read per request from the x-provider-key header; never persisted or
// logged. Anonymous (no-token) Pollinations calls stay direct from the
// browser — they don't need a proxy.

const POLLINATIONS_BASE = "https://image.pollinations.ai";
const POLLINATIONS_HOST = "image.pollinations.ai";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (!isAllowedOrigin(request)) {
    return NextResponse.json(
      { error: "Forbidden: origin not allowed" },
      { status: 403 },
    );
  }

  // Image fetches are bursty (a section's worth of stills at once) but not
  // sustained; 60/min per IP covers real use and caps relay abuse.
  const rl = await rateLimit(request, { name: "pollinations", limit: 60 });
  if (!rl.ok) return rateLimitResponse(rl);

  const key = request.headers.get("x-provider-key");
  if (!key) {
    return NextResponse.json(
      { error: "Missing x-provider-key header" },
      { status: 401 },
    );
  }

  const { path } = await params;
  const incomingUrl = new URL(request.url);
  const target = `${POLLINATIONS_BASE}/${path.join("/")}${incomingUrl.search}`;

  try {
    const parsed = new URL(target);
    if (parsed.host !== POLLINATIONS_HOST) {
      return NextResponse.json({ error: "Invalid upstream" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid upstream URL" }, { status: 400 });
  }

  const upstream = await fetch(target, {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });

  const responseHeaders: Record<string, string> = {};
  const ct = upstream.headers.get("content-type");
  if (ct) responseHeaders["Content-Type"] = ct;
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
