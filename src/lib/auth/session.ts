/**
 * Uygulama oturumu: opak token (httpOnly cookie) → sessions tablosu.
 * Token'ın kendisi DB'de tutulmaz; SHA-256 hash'i saklanır.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { sessions, users, type User } from "@/lib/db/schema";

export const SESSION_COOKIE = "saharapor_session";
const SESSION_DAYS = 1;

/** OTP adımı için kısa ömürlü imzalı "bekleyen kullanıcı" cookie'si. */
export const PENDING_COOKIE = "saharapor_pending";
const PENDING_MINUTES = 5;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET tanımlı değil.");
  return s;
}

// ---- uygulama oturumu ----

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string } = {},
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 400),
    ip: meta.ip?.slice(0, 100),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Cookie'deki token'ı DB'de doğrular; geçerliyse kullanıcıyı döndürür. */
export async function getSessionUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

// ---- OTP bekleyen kullanıcı cookie'si (imzalı, 5 dk) ----

function signPending(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export async function setPendingUser(userId: string): Promise<void> {
  const exp = Date.now() + PENDING_MINUTES * 60_000;
  const payload = `${userId}.${exp}`;
  const value = `${payload}.${signPending(payload)}`;
  const jar = await cookies();
  jar.set(PENDING_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_MINUTES * 60,
  });
}

export async function getPendingUser(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(PENDING_COOKIE)?.value;
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  if (signPending(`${userId}.${expStr}`) !== sig) return null;
  if (Date.now() > Number(expStr)) return null;
  return userId;
}

export async function clearPendingUser(): Promise<void> {
  (await cookies()).delete(PENDING_COOKIE);
}
