import Link from "next/link";
import { redirect } from "next/navigation";
import { isKvConfigured, updateUserPassword, getUser } from "@/lib/users";

function isAdminResetEnabled(): boolean {
  return !!process.env.ADMIN_RESET_SECRET;
}

export default async function AdminResetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const kvReady = isKvConfigured();
  const adminReady = isAdminResetEnabled();

  async function doAdminReset(formData: FormData) {
    "use server";
    const secret = String(formData.get("secret") ?? "");
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const password = String(formData.get("password") ?? "");

    const expected = process.env.ADMIN_RESET_SECRET;
    if (!expected) {
      redirect(
        `/admin-reset?error=${encodeURIComponent(
          "ADMIN_RESET_SECRET is not set in environment variables.",
        )}`,
      );
    }
    if (secret !== expected) {
      redirect(`/admin-reset?error=${encodeURIComponent("Wrong secret.")}`);
    }
    if (password.length < 8) {
      redirect(
        `/admin-reset?error=${encodeURIComponent(
          "Password must be at least 8 characters.",
        )}`,
      );
    }
    if (!email) {
      redirect(`/admin-reset?error=${encodeURIComponent("Email required.")}`);
    }

    const existing = await getUser(email);
    if (!existing) {
      redirect(
        `/admin-reset?error=${encodeURIComponent(
          `No account exists for ${email}. Sign up first, then come back.`,
        )}`,
      );
    }

    const ok = await updateUserPassword(email, password);
    if (!ok) {
      redirect(
        `/admin-reset?error=${encodeURIComponent("Failed to update password.")}`,
      );
    }

    redirect("/login?message=Password+reset.+Sign+in+with+your+new+password.");
  }

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="auth-head">
          <div className="auth-wordmark">
            <span className="auth-brand">
              <span className="ai">AI</span> Cinema
            </span>
          </div>
          <div className="auth-tagline">Emergency password override</div>
        </div>

        <h1 className="auth-title">// ADMIN RESET</h1>
        <p className="auth-sub">
          One-shot override for lockouts before the email-based reset is wired up. Requires the{" "}
          <code>ADMIN_RESET_SECRET</code> env var to match.
        </p>

        {!kvReady && (
          <div className="auth-error">⚠ Cloud accounts are not configured.</div>
        )}
        {kvReady && !adminReady && (
          <div className="auth-error">
            ⚠ Set <code>ADMIN_RESET_SECRET</code> in Vercel → Settings → Environment
            Variables, redeploy, then come back.
          </div>
        )}
        {sp.error && <div className="auth-error">⚠ {decodeURIComponent(sp.error)}</div>}

        <form action={doAdminReset} className="auth-form">
          <label className="auth-field">
            <span>Admin secret</span>
            <input
              type="password"
              name="secret"
              autoComplete="off"
              required
              placeholder="ADMIN_RESET_SECRET value"
              disabled={!adminReady || !kvReady}
            />
          </label>
          <label className="auth-field">
            <span>Account email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder="you@studio.com"
              disabled={!adminReady || !kvReady}
            />
          </label>
          <label className="auth-field">
            <span>New password</span>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              placeholder="At least 8 characters"
              disabled={!adminReady || !kvReady}
            />
          </label>
          <button
            type="submit"
            className="auth-submit"
            disabled={!adminReady || !kvReady}
          >
            Reset password →
          </button>
        </form>

        <div className="auth-foot">
          <Link href="/login">← Back to sign in</Link>
        </div>
      </div>
    </main>
  );
}
