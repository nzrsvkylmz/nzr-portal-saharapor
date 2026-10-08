import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { RemoteError } from "@/lib/portal/errors";
import { loadClient, saveClient } from "@/lib/portal/cookiejar";
import {
  clearPendingUser,
  createSession,
  getPendingUser,
  setPendingUser,
} from "@/lib/auth/session";

/** OTP relay: kullanıcının portaldan aldığı SMS kodunu portala iletir. */
export async function POST(req: NextRequest) {
  const userId = await getPendingUser();
  if (!userId) {
    return NextResponse.json(
      { error: "OTP adımı zaman aşımına uğradı. Baştan giriş yapın.", restart: true },
      { status: 440 },
    );
  }

  let otp = "";
  try {
    const body = await req.json();
    otp = String(body.otp ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek." }, { status: 400 });
  }
  if (!otp) return NextResponse.json({ error: "Doğrulama kodu gerekli." }, { status: 400 });

  const client = await loadClient(userId);
  try {
    await client.verify(otp);
  } catch (err) {
    // yanlış kod: pending penceresini tazele ki kullanıcı yeniden deneyebilsin
    await setPendingUser(userId);
    const msg = err instanceof RemoteError ? err.message : "Doğrulama başarısız.";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  await saveClient(userId, client, "authenticated");
  await clearPendingUser();

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user || user.status === "disabled") {
    return NextResponse.json({ error: "Hesap kullanılamıyor." }, { status: 403 });
  }

  await createSession(userId, {
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
  });
  return NextResponse.json({ ok: true, pending: user.status === "pending" || !user.role });
}
