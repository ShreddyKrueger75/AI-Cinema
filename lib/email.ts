import "server-only";

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set.");

  const from = process.env.RESEND_FROM ?? "Cinema AI <onboarding@resend.dev>";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Reset your Cinema AI password</title>
<style>
  body { margin: 0; padding: 0; background: #0c0b0a; font-family: 'JetBrains Mono', 'Courier New', monospace; color: #c8b8aa; }
  .wrap { max-width: 520px; margin: 48px auto; padding: 0 24px; }
  .card { background: #141210; border: 1px solid #2a2520; border-radius: 6px; padding: 40px 36px; }
  .brand { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; color: #e8d8cc; margin: 0 0 4px; }
  .brand .ai { color: #ff4d7e; }
  .tagline { font-size: 11px; color: #7a6a60; margin: 0 0 32px; letter-spacing: 0.04em; }
  .label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: #7a6a60; text-transform: uppercase; margin: 0 0 8px; }
  .title { font-size: 18px; font-weight: 700; color: #e8d8cc; margin: 0 0 12px; }
  p { font-size: 13px; line-height: 1.7; margin: 0 0 24px; color: #9a8a80; }
  .btn { display: inline-block; background: #ff4d7e; color: #fff !important; text-decoration: none; font-size: 13px; font-weight: 700; padding: 12px 28px; border-radius: 4px; letter-spacing: 0.04em; }
  .url { font-size: 11px; color: #7a6a60; word-break: break-all; margin-top: 20px; }
  .url a { color: #7a6a60; }
  .foot { margin-top: 36px; padding-top: 24px; border-top: 1px solid #2a2520; font-size: 11px; color: #5a4a40; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <p class="brand">Cinema <span class="ai">AI</span></p>
    <p class="tagline">Cinematic video, made easy. Bring your own model.</p>

    <p class="label">// RESET PASSWORD</p>
    <p class="title">Set a new password</p>

    <p>Someone (hopefully you) requested a password reset for this account. Click the button below to choose a new password.</p>

    <a href="${resetUrl}" class="btn">Reset password →</a>

    <p class="url">Or copy this link:<br /><a href="${resetUrl}">${resetUrl}</a></p>

    <p style="margin-top:24px;margin-bottom:0;">This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can safely ignore this email.</p>

    <div class="foot">Cinema AI · Cinematic video, made easy.</div>
  </div>
</div>
</body>
</html>`;

  const text = `// RESET PASSWORD — Cinema AI\n\nSet a new password for your account:\n\n${resetUrl}\n\nThis link expires in 1 hour. If you didn't request a reset, ignore this email.`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "// RESET PASSWORD — Cinema AI",
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Email send failed (${res.status}): ${body}`);
  }
}
