import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { createUser, isKvConfigured } from "@/lib/users";

export default async function SignupPage({
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

  async function doSignup(formData: FormData) {
    "use server";
    if (!isKvConfigured()) {
      redirect(
        `/signup?error=${encodeURIComponent(
          "Cloud accounts are not configured. Set up Vercel KV to enable sign-up.",
        )}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    const display_name = String(formData.get("display_name") ?? "");
    if (password !== confirm) {
      redirect(
        `/signup?error=${encodeURIComponent("Passwords do not match.")}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    const result = await createUser({ email, password, display_name });
    if (!result.ok) {
      redirect(
        `/signup?error=${encodeURIComponent(result.error)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
      );
    }
    await signIn("credentials", {
      email,
      password,
      redirectTo: callbackUrl,
    });
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-head">
          <div className="auth-wordmark">
            <span className="auth-brand"><span className="ai">AI</span> Cinema</span>
          </div>
          <div className="auth-tagline">Cinematic video, made easy. Bring your own model.</div>
        </div>

        <h1 className="auth-title">// CREATE ACCOUNT</h1>
        <p className="auth-sub">Cloud sync for your project library, briefs, grades, and music presets. The editor itself stays open without an account.</p>

        {!kvReady ? (
          <div className="auth-error">⚠ Cloud accounts are not configured. Set up Vercel KV to enable sign-up.</div>
        ) : null}
        {error ? <div className="auth-error">⚠ {decodeURIComponent(error)}</div> : null}

        <form action={doSignup} className="auth-form">
          <label className="auth-field">
            <span>Display name <em>(optional)</em></span>
            <input type="text" name="display_name" autoComplete="name" placeholder="What should we call you?" />
          </label>
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
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="At least 8 characters"
            />
          </label>
          <label className="auth-field">
            <span>Confirm password</span>
            <input
              type="password"
              name="confirm"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="One more time"
            />
          </label>
          <button type="submit" className="auth-submit">Create account →</button>
        </form>

        <div className="auth-foot">
          <Link href={`/login${callbackUrl !== "/" ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ""}`}>
            Already have an account? Sign in
          </Link>
          <Link href="/">← Back to the editor</Link>
        </div>
      </div>
    </main>
  );
}
