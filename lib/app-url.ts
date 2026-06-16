// Canonical app URL + allowed-origin checks.
//
// Security context: we cannot trust the `Host` / `x-forwarded-host` headers
// for things that the user will *act on* (password-reset emails, redirect
// targets, allow-list checks). An attacker who sets `Host: attacker.com` on
// a forged POST to /forgot-password would otherwise receive the reset link
// for the victim's account.
//
// Source of truth (in order):
//   1. APP_URL (env, set explicitly per environment)
//   2. NEXT_PUBLIC_APP_URL (env, public)
//   3. VERCEL_PROJECT_PRODUCTION_URL (system env, only on Vercel production)
//   4. http://localhost:3000 (dev fallback)
//
// In production, if none of (1)–(3) are set, log a loud warning — the
// fallback is fine for first-deploy but should be replaced.

function trim(u: string): string {
  return u.replace(/\/+$/, "");
}

export function getAppUrl(): string {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return trim(explicit);
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return trim(`https://${vercel}`);
  return "http://localhost:3000";
}

// Origins from which our own browser code is allowed to call our proxy
// routes. Anything else (curl, scripts, third-party sites) gets 403 — we
// don't want random scripts using our deployment to relay calls to
// Replicate / Runway / Pollinations and bill us for the function time.
export function getAllowedOrigins(): Set<string> {
  const set = new Set<string>();
  set.add(getAppUrl());
  // Vercel preview deploys vary per branch; allow each branch's own origin.
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) set.add(`https://${trim(vercelUrl)}`);
  const vercelBranchUrl = process.env.VERCEL_BRANCH_URL;
  if (vercelBranchUrl) set.add(`https://${trim(vercelBranchUrl)}`);
  // Dev convenience.
  if (process.env.NODE_ENV !== "production") {
    set.add("http://localhost:3000");
    set.add("http://127.0.0.1:3000");
  }
  return set;
}

export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = getAllowedOrigins();
  return allowed.has(trim(origin));
}
