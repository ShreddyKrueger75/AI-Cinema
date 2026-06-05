import "server-only";
import crypto from "crypto";
import { kv } from "@vercel/kv";
import bcrypt from "bcryptjs";

export type UserRecord = {
  email: string;
  password_hash: string;
  display_name: string | null;
  created_at: string;
};

export type SafeUser = {
  email: string;
  display_name: string | null;
  created_at: string;
};

const USER_KEY_PREFIX = "ai-cinema:user:";
const RESET_TOKEN_PREFIX = "ai-cinema:reset-token:";
const BCRYPT_ROUNDS = 10;
const RESET_TTL_S = 60 * 60; // 1 hour

export function isKvConfigured(): boolean {
  return !!(
    process.env.KV_REST_API_URL ||
    process.env.KV_URL ||
    process.env.UPSTASH_REDIS_REST_URL
  );
}

export function isResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function safe(user: UserRecord): SafeUser {
  return {
    email: user.email,
    display_name: user.display_name,
    created_at: user.created_at,
  };
}

export async function getUser(email: string): Promise<UserRecord | null> {
  const key = USER_KEY_PREFIX + normaliseEmail(email);
  const record = await kv.get<UserRecord>(key);
  return record ?? null;
}

export async function getSafeUser(email: string): Promise<SafeUser | null> {
  const user = await getUser(email);
  return user ? safe(user) : null;
}

export async function createUser(opts: {
  email: string;
  password: string;
  display_name?: string;
}): Promise<{ ok: true; user: SafeUser } | { ok: false; error: string }> {
  const email = normaliseEmail(opts.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That doesn't look like a valid email." };
  }
  if (opts.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }
  const existing = await getUser(email);
  if (existing) {
    return { ok: false, error: "An account with that email already exists." };
  }
  const password_hash = await bcrypt.hash(opts.password, BCRYPT_ROUNDS);
  const record: UserRecord = {
    email,
    password_hash,
    display_name: opts.display_name?.trim() || null,
    created_at: new Date().toISOString(),
  };
  await kv.set(USER_KEY_PREFIX + email, record);
  return { ok: true, user: safe(record) };
}

export async function verifyUser(
  email: string,
  password: string,
): Promise<SafeUser | null> {
  const user = await getUser(email);
  if (!user) return null;
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return null;
  return safe(user);
}

// Returns token if the user exists, null otherwise (without revealing existence to callers).
export async function createPasswordResetToken(email: string): Promise<string | null> {
  const norm = normaliseEmail(email);
  const user = await getUser(norm);
  if (!user) return null;
  const token = crypto.randomBytes(32).toString("hex");
  await kv.set(RESET_TOKEN_PREFIX + token, { email: norm }, { ex: RESET_TTL_S });
  return token;
}

// Validates and deletes the token in one step. Returns the associated email or null.
export async function consumePasswordResetToken(token: string): Promise<string | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const key = RESET_TOKEN_PREFIX + token;
  const record = await kv.get<{ email: string }>(key);
  if (!record) return null;
  await kv.del(key);
  return record.email;
}

export async function updateUserPassword(email: string, newPassword: string): Promise<boolean> {
  const norm = normaliseEmail(email);
  const user = await getUser(norm);
  if (!user) return false;
  const password_hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await kv.set(USER_KEY_PREFIX + norm, { ...user, password_hash });
  return true;
}
