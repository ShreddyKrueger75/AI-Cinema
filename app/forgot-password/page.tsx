import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import {
  createPasswordResetToken,
  isKvConfigured,
  isResendConfigured,
} from "@/lib/users";
import { sendPasswordResetEmail } from "@/lib/email";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const params = await searchParams;
  const kvReady = isKvConfigured();
  const emailReady = isResendConfigured();
  const ready = kvReady && emailReady;

  async function doForgot(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!email) redirect("/forgot-password?error=Email+required.");

    try {
      const token = await createPasswordResetToken(email);
      if (token) {
        const hdrs = await headers();
        const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "localhost:3000";
        const proto =
          hdrs.get("x-forwarded-proto") ??
          (host.includes("localhost") ? "http" : "https");
        const resetUrl = `${proto}://${host}/reset-password/${token}`;
        await sendPasswordResetEmail(email, resetUrl);
      }
      // Always show the same screen — never reveal whether the email exists.
      redirect("/forgot-password?sent=1");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send reset email.";
      redirect(`/forgot-password?error=${encodeURIComponent(msg)}`);
    }
  }

  if (params.sent) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <div className="auth-head">
            <div className="auth-wordmark">
              <span className="auth-brand">
                Cinema <span className="ai">AI</span>
              </span>
            </div>
          </div>

          <h1 className="auth-title">// CHECK YOUR EMAIL</h1>
          <p className="auth-sub">
            If that address has an account, we just sent a reset link. It expires in{" "}
            <strong>1 hour</strong>. Check your spam folder if you don&apos;t see it.
          </p>

          <div className="auth-foot">
            <Link href="/login">← Back to sign in</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-head">
          <div className="auth-wordmark">
            <span className="auth-brand">
              Cinema <span className="ai">AI</span>
            </span>
          </div>
          <div className="auth-tagline">Cinematic video, made easy. Bring your own model.</div>
        </div>

        <h1 className="auth-title">// FORGOT PASSWORD</h1>
        <p className="auth-sub">
          Enter your account email and we&apos;ll send a one-time reset link. It expires in 1 hour.
        </p>

        {!kvReady && (
          <div className="auth-error">
            ⚠ Cloud accounts are not configured. Set up Vercel KV to enable password reset.
          </div>
        )}
        {kvReady && !emailReady && (
          <div className="auth-error">
            ⚠ Email sending is not configured. Add{" "}
            <code>RESEND_API_KEY</code> to your environment variables.
          </div>
        )}
        {params.error && (
          <div className="auth-error">⚠ {decodeURIComponent(params.error)}</div>
        )}

        <form action={doForgot} className="auth-form">
          <label className="auth-field">
            <span>Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder="you@studio.com"
              disabled={!ready}
            />
          </label>
          <button type="submit" className="auth-submit" disabled={!ready}>
            Send reset link →
          </button>
        </form>

        <div className="auth-foot">
          <Link href="/login">← Back to sign in</Link>
        </div>
      </div>
    </main>
  );
}
