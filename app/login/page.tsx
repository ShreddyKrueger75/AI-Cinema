import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { isKvConfigured } from "@/lib/users";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const params = await searchParams;
  const error = params.error;
  const callbackUrl = params.callbackUrl ?? "/";
  const kvReady = isKvConfigured();

  async function doLogin(formData: FormData) {
    "use server";
    if (!isKvConfigured()) {
      redirect(
        `/login?error=${encodeURIComponent(
          "Cloud accounts are not configured. Set up Vercel KV to enable sign-in.",
        )}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    try {
      await signIn("credentials", {
        email,
        password,
        redirectTo: callbackUrl,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "NEXT_REDIRECT") throw err;
      const message = err instanceof Error ? err.message : "Sign-in failed";
      const url = new URL(`/login`, "http://x");
      url.searchParams.set("error", message);
      url.searchParams.set("callbackUrl", callbackUrl);
      redirect(`/login?${url.searchParams.toString()}`);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-head">
          <div className="auth-wordmark">
            <span className="auth-brand">Cinema <span className="ai">AI</span></span>
          </div>
          <div className="auth-tagline">Cinematic video, made easy. Bring your own model.</div>
        </div>

        <h1 className="auth-title">// SIGN IN</h1>
        <p className="auth-sub">The editor works without an account. Sign in to sync your library and projects across devices.</p>

        {!kvReady ? (
          <div className="auth-error">⚠ Cloud accounts are not configured. Set up Vercel KV to enable sign-in.</div>
        ) : null}
        {error ? <div className="auth-error">⚠ {decodeURIComponent(error)}</div> : null}

        <form action={doLogin} className="auth-form">
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder="you@studio.com"
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              minLength={8}
              placeholder="At least 8 characters"
            />
          </label>
          <button type="submit" className="auth-submit">Sign in →</button>
        </form>

        <div className="auth-foot">
          <Link href={`/signup${callbackUrl !== "/" ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}>
            Create an account
          </Link>
          <Link href="/">← Back to the editor</Link>
        </div>
      </div>
    </main>
  );
}
