/**
 * Kullanıcı başına portal cookie jar'ı: tough-cookie ↔ şifreli DB satırı.
 */
import { eq } from "drizzle-orm";
import { CookieJar } from "tough-cookie";
import { db } from "@/lib/db";
import { portalSessions } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { NezirClient } from "./client";

export type PortalRowState = "authenticated" | "verify" | "login" | "unknown";

/** DB'deki jar'dan istemci kurar; kayıt yoksa boş jar ile döner. */
export async function loadClient(userId: string): Promise<NezirClient> {
  const row = await db.query.portalSessions.findFirst({
    where: eq(portalSessions.userId, userId),
  });
  if (!row) return new NezirClient();
  try {
    const jar = CookieJar.deserializeSync(JSON.parse(decrypt(row.cookieJarEnc)));
    return new NezirClient(jar);
  } catch {
    // anahtar değişmiş/bozulmuş jar: sıfırdan başla
    return new NezirClient();
  }
}

/** İstemcinin jar'ını şifreleyip kaydeder (upsert). */
export async function saveClient(
  userId: string,
  client: NezirClient,
  state: PortalRowState,
): Promise<void> {
  const serialized = JSON.stringify(client.jar.serializeSync());
  const enc = encrypt(serialized);
  const now = new Date();
  await db
    .insert(portalSessions)
    .values({
      userId,
      cookieJarEnc: enc,
      state,
      updatedAt: now,
      lastOkAt: state === "authenticated" ? now : null,
    })
    .onConflictDoUpdate({
      target: portalSessions.userId,
      set: {
        cookieJarEnc: enc,
        state,
        updatedAt: now,
        ...(state === "authenticated" ? { lastOkAt: now } : {}),
      },
    });
}

/** Yalnızca durum kolonunu günceller (ör. çekim sırasında oturum düşmesi). */
export async function markPortalState(userId: string, state: PortalRowState): Promise<void> {
  await db
    .update(portalSessions)
    .set({ state, updatedAt: new Date() })
    .where(eq(portalSessions.userId, userId));
}
