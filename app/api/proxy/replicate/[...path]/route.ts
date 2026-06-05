import { NextResponse } from "next/server";

// Server-side proxy for api.replicate.com.
// Replicate doesn't send CORS headers, so browser calls fail with
// "Failed to fetch" before any response is read. This route relays
// the call server-side using the user's key from x-provider-key.
// The key is read from the header per request and never persisted
// or logged.

const REPLICATE_BASE = "https://api.replicate.com";

export const runtime = "nodejs";

async function relay(request: Request, pathParts: string[]) {
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
