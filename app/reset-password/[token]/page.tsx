import Link from "next/link";
import { redirect } from "next/navigation";
import {
  consumePasswordResetToken,
  updateUserPassword,
  isKvConfigured,
} from "@/lib/users";

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const kvReady = isKvConfigured();

  async function doReset(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    if (password.length < 8) {
      redirect(
        `/reset-password/${token}?error=${encodeURIComponent(
          "Password must be at least 8 characters.",
        )}`,
      );
    }
    if (password !== confirm) {
      redirect(
        `/reset-password/${token}?error=${encodeURIComponent("Passwords do not match.")}`,
      );
    }

    const email = await consumePasswordResetToken(token);
    if (!email) {
      redirect(
        `/reset-password/${token}?error=${encodeURIComponent(
          "This reset link has expired or already been used. Request a new one.",
        )}`,
      );
    }

    const ok = await updateUserPassword(email, password);
    if (!ok) {
      redirect(
        `/reset-password/${token}?error=${encodeURIComponent(
          "Could not update password. The account may no longer exist.",
        )}`,
      );
    }

    redirect("/login?message=Password+updated.+Sign+in+with+your+new+password.");
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

        <h1 className="auth-title">// SET NEW PASSWORD</h1>
        <p className="auth-sub">Choose a new password for your account. At least 8 characters.</p>

        {!kvReady && (
          <div className="auth-error">⚠ Cloud accounts are not configured.</div>
        )}
        {sp.error && (
          <div className="auth-error">⚠ {decodeURIComponent(sp.error)}</div>
        )}

        <form action={doReset} className="auth-form">
          <label className="auth-field">
            <span>New password</span>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="At least 8 characters"
              disabled={!kvReady}
            />
          </label>
          <label className="auth-field">
            <span>Confirm new password</span>
            <input
              type="password"
              name="confirm"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="One more time"
              disabled={!kvReady}
            />
          </label>
          <button type="submit" className="auth-submit" disabled={!kvReady}>
            Set new password →
          </button>
        </form>

        <div className="auth-foot">
          <Link href="/forgot-password">Request a new link</Link>
          <Link href="/login">← Back to sign in</Link>
        </div>
      </div>
    </main>
  );
}
