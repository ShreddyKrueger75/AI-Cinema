import { NextResponse } from "next/server";

const RUNWAY_BASE = "https://api.dev.runwayml.com";
const RUNWAY_VERSION = "2024-11-06";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth) {
    return NextResponse.json({ error: "Missing Authorization header" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const r = await fetch(`${RUNWAY_BASE}/v1/image_to_video`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "X-Runway-Version": RUNWAY_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await r.text();
  return new NextResponse(text, {
    status: r.status,
    headers: { "Content-Type": r.headers.get("content-type") ?? "application/json" },
  });
}
