import { NextResponse } from "next/server";

// Server-side proxy for image.pollinations.ai used ONLY when the user
// has a Pollinations token saved. Keeps the token out of the URL
// (where it would leak via access logs, browser history, and Referer).
// Read per request from the x-provider-key header; never persisted or
// logged. Anonymous (no-token) Pollinations calls stay direct from the
// browser — they don't need a proxy.

const POLLINATIONS_BASE = "https://image.pollinations.ai";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
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
