import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyUser, isKvConfigured } from "@/lib/users";

// Auth.js refuses to start without AUTH_SECRET. On preview deploys where the
// dashboard env var isn't set yet, fall back to a per-commit deterministic
// secret so /api/auth/session returns 200 + an empty body instead of 500ing
// 16× per page load. Production must set a real AUTH_SECRET (see issue #3).
const AUTH_SECRET =
  process.env.AUTH_SECRET ||
  `ai-cinema-preview-fallback-${process.env.VERCEL_GIT_COMMIT_SHA ?? "local"}-do-not-use-in-prod`;

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
