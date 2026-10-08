import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, users } from "@/lib/db/schema";
import { NezirClient } from "@/lib/portal/client";
import { RemoteError } from "@/lib/portal/errors";
import { saveClient } from "@/lib/portal/cookiejar";
import { createSession, setPendingUser } from "@/lib/auth/session";

/**
 * Sistem Plus kimliğiyle giriş: portal login'i vekil olarak kullanılır.
 * Şifre hiçbir yerde saklanmaz; yalnızca portal oturum cookie'leri
 * (şifreli) kaydedilir.
 */
export async function POST(req: NextRequest) {
  let nick = "";
  let pass = "";
  try {
    const body = await req.json();
    nick = String(body.nick ?? "").trim();
    pass = String(body.pass ?? "");
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }
  if (!nick || !pass) {
    return NextResponse.json({ error: "Kullanıcı adı ve şifre gerekli." }, { status: 400 });
  }

  const client = new NezirClient();
  let state: "authenticated" | "verify";
  try {
    state = await client.login(nick, pass);
  } catch (err) {
    const msg = err instanceof RemoteError ? err.message : "Portala ulaşılamadı.";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  // Şifre portal tarafından kabul edildi → kullanıcı geçerli. Upsert.
  const nickKey = nick.toLowerCase();
  const [user] = await db
    .insert(users)
    .values({ portalNick: nickKey, displayName: nick })
    .onConflictDoUpdate({
      target: users.portalNick,
      set: { lastLoginAt: sql`now()` },
    })
    .returning();

  if (user.status === "disabled") {
    return NextResponse.json(
      { error: "Hesabınız devre dışı bırakılmış. Yöneticinizle görüşün." },
      { status: 403 },
    );
  }

  // İlk SUPER_ADMIN ataması (env ile)
  const initialAdmin = (process.env.INITIAL_ADMIN_NICK ?? "").trim().toLowerCase();
  if (initialAdmin && nickKey === initialAdmin && user.role !== "SUPER_ADMIN") {
    await db
      .update(users)
      .set({ role: "SUPER_ADMIN", status: "active" })
      .where(eq(users.id, user.id));
    user.role = "SUPER_ADMIN";
    user.status = "active";
  }

  await saveClient(user.id, client, state);
  await db.insert(auditLog).values({
    userId: user.id,
    action: "login",
    detail: { state },
  });

  if (state === "verify") {
    await setPendingUser(user.id);
    return NextResponse.json({ needsOtp: true });
  }

  await createSession(user.id, {
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
  });
  return NextResponse.json({ ok: true, pending: user.status === "pending" || !user.role });
}
