import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyUser, isKvConfigured } from "@/lib/users";

// Auth.js refuses to start without AUTH_SECRET. The fallback was a
// per-commit deterministic value so preview deploys without a configured
// secret would return 200 instead of 500. That secret is derived from the
// public commit SHA — *anyone* can forge JWTs against it. In production we
// now refuse to *serve requests* without a real AUTH_SECRET; the check is
// deferred past the build-data-collection phase so deploys still succeed
// when an env var is added later in the dashboard. Preview
// (VERCEL_ENV=preview) and dev keep the deterministic fallback.
function resolveAuthSecret(): string {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  // During `next build` the framework imports auth modules to collect page
  // data. Don't throw there — only when serving real traffic.
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  const isProduction =
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL_ENV !== "preview" &&
    !isBuildPhase;
  if (isProduction) {
    throw new Error(
      "AUTH_SECRET is required in production. Generate one with `openssl rand -base64 32` and set it in your Vercel project env.",
    );
  }
  return `ai-cinema-preview-fallback-${process.env.VERCEL_GIT_COMMIT_SHA ?? "local"}-do-not-use-in-prod`;
}
const AUTH_SECRET = resolveAuthSecret();

export const { handlers, signIn, signOut, auth } = NextAuth({
  secret: AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Email + password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!isKvConfigured()) {
          throw new Error(
            "Cloud accounts are not configured. Set up Vercel KV (KV_REST_API_URL + KV_REST_API_TOKEN) to enable sign-in.",
          );
        }
        const email = String(credentials?.email ?? "").trim();
        const password = String(credentials?.password ?? "");
        if (!email || !password) return null;
        const user = await verifyUser(email, password);
        if (!user) return null;
        return {
          id: user.email,
          email: user.email,
          name: user.display_name ?? user.email,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email;
      if (user?.name) token.name = user.name;
      return token;
    },
    async session({ session, token }) {
      if (token?.email) session.user.email = token.email as string;
      if (token?.name) session.user.name = token.name as string;
      return session;
    },
  },
});
