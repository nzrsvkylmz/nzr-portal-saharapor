"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { auditLog, units, userUnits, users, type Role } from "@/lib/db/schema";
import { norm } from "@/lib/domain/normalize";
import { loadClient } from "@/lib/portal/cookiejar";
import { fetchAccounts, type PortalAccount } from "@/lib/portal/accounts";

const ROLES: Role[] = [
  "SUPER_ADMIN",
  "ADMIN_BAGIS",
  "ADMIN_YARDIM",
  "BOLGE_MUDURU",
  "TEMSILCI",
];

/** Kullanıcıya rol/birim atar ve aktifleştirir. Yalnız SUPER_ADMIN. */
export async function updateUserAccess(formData: FormData): Promise<void> {
  const admin = await requireRole("SUPER_ADMIN");

  let hata: string | null = null;
  try {
    const userId = String(formData.get("userId") ?? "");
    const roleRaw = String(formData.get("role") ?? "");
    const statusRaw = String(formData.get("status") ?? "active");
    const bolgeNoRaw = String(formData.get("bolgeNo") ?? "");
    // birimler: işaretli kalanlar + ada göre eklenenler (paylaşımlı datalist)
    const keepIds = formData
      .getAll("keepUnitIds")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);
    const addNames = formData
      .getAll("addUnitNames")
      .map((v) => String(v).trim())
      .filter(Boolean);
    const addIds: number[] = [];
    if (addNames.length) {
      const allUnits = await db.select().from(units);
      for (const name of addNames) {
        const hits = allUnits.filter((u) => u.active && norm(u.name) === norm(name));
        if (hits.length === 0) throw new Error(`Birim bulunamadı: "${name}"`);
        if (hits.length > 1) throw new Error(`Birden fazla birim eşleşti: "${name}"`);
        addIds.push(hits[0].id);
      }
    }
    const unitIds = [...new Set([...keepIds, ...addIds])];

    if (!userId) throw new Error("Kullanıcı seçilmedi.");
    const role = ROLES.includes(roleRaw as Role) ? (roleRaw as Role) : null;
    const status =
      statusRaw === "disabled" ? "disabled" : role ? "active" : "pending";
    const bolgeNo =
      role === "BOLGE_MUDURU" && bolgeNoRaw ? Number(bolgeNoRaw) : null;

    if (role === "BOLGE_MUDURU" && !bolgeNo) {
      throw new Error("Bölge müdürü için bölge seçilmelidir.");
    }
    if (role === "TEMSILCI" && unitIds.length === 0) {
      throw new Error("Temsilci için en az bir birim seçilmelidir.");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ role, status, bolgeNo })
        .where(eq(users.id, userId));
      await tx.delete(userUnits).where(eq(userUnits.userId, userId));
      if (role === "TEMSILCI" && unitIds.length) {
        await tx
          .insert(userUnits)
          .values(unitIds.map((unitId) => ({ userId, unitId })));
      }
      await tx.insert(auditLog).values({
        userId: admin.id,
        action: "user_access_update",
        detail: { target: userId, role, status, bolgeNo, unitIds },
      });
    });
  } catch (e) {
    hata = e instanceof Error ? e.message : String(e);
  }

  revalidatePath("/admin/kullanicilar");
  if (hata) redirect(`/admin/kullanicilar?hata=${encodeURIComponent(hata)}`);
}

/**
 * Portaldan kullanıcı içe aktarma çekirdeği: hesap burada hiç giriş yapmamış
 * olsa da rolü (ve varsa bölgesi) hazır bekler; ilk girişinde doğrudan kendi
 * kapsamını görür. Mevcut kullanıcıların elle yapılmış ayarları EZİLMEZ
 * (yalnız rolü atanmamış olanlar güncellenir). Şifre asla okunmaz/saklanmaz.
 */
interface ImportAssignment {
  role: Role | null; // null → kullanıcı "yetki bekliyor" olarak oluşturulur
  bolgeNo: number | null;
  unitIds?: number[]; // TEMSILCI için otomatik birim ataması
}

async function importFromPortal(
  filter: Record<string, string>,
  etiket: string,
  assign: (acc: PortalAccount) => ImportAssignment | null,
): Promise<void> {
  const admin = await requireRole("SUPER_ADMIN");

  let mesaj: string | null = null;
  let hata: string | null = null;
  try {
    const client = await loadClient(admin.id);
    const accounts = await fetchAccounts(client, filter);

    let eklenen = 0;
    let guncellenen = 0;
    let atlanan = 0;
    let beklemede = 0;
    for (const acc of accounts) {
      const atama = acc.active ? assign(acc) : null;
      if (!atama) {
        atlanan++;
        continue;
      }
      if (!atama.role) beklemede++;
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.portalNick, acc.nick));
      let userId: string;
      if (!existing) {
        const [created] = await db
          .insert(users)
          .values({
            portalNick: acc.nick,
            displayName: acc.displayName,
            role: atama.role,
            status: atama.role ? "active" : "pending",
            bolgeNo: atama.bolgeNo,
          })
          .returning({ id: users.id });
        userId = created.id;
        eklenen++;
      } else if (!existing.role) {
        await db
          .update(users)
          .set({
            role: atama.role,
            status: atama.role ? "active" : "pending",
            bolgeNo: atama.bolgeNo,
          })
          .where(eq(users.id, existing.id));
        userId = existing.id;
        guncellenen++;
      } else {
        atlanan++; // elle yapılandırılmış kullanıcıya dokunma
        continue;
      }
      if (atama.unitIds?.length) {
        await db.delete(userUnits).where(eq(userUnits.userId, userId));
        await db
          .insert(userUnits)
          .values(atama.unitIds.map((unitId) => ({ userId, unitId })));
      }
    }

    await db.insert(auditLog).values({
      userId: admin.id,
      action: "user_import_portal",
      detail: {
        etiket,
        filter,
        toplam: accounts.length,
        eklenen,
        guncellenen,
        atlanan,
        beklemede,
      },
    });
    mesaj =
      `Portaldan ${accounts.length} ${etiket} okundu: ${eklenen} eklendi, ` +
      `${guncellenen} güncellendi, ${atlanan} atlandı (pasif/elle ayarlı)` +
      (beklemede
        ? `; ${beklemede} kullanıcının birimi eşleşmedi — "Onay Bekleyenler" altında elle atayın.`
        : ".");
  } catch (e) {
    hata = e instanceof Error ? e.message : String(e);
  }

  revalidatePath("/admin/kullanicilar");
  redirect(
    hata
      ? `/admin/kullanicilar?hata=${encodeURIComponent(hata)}`
      : `/admin/kullanicilar?mesaj=${encodeURIComponent(mesaj ?? "")}`,
  );
}

/** Bölge müdürleri (erişim yetkisi: Bölge Müdürü, level=11) → BOLGE_MUDURU. */
export async function importBolgeMudurleri(): Promise<void> {
  await importFromPortal({ level: "11" }, "bölge müdürü", (acc) => {
    const bolgeNo = Number(/^(\d+)\s*\./.exec(acc.department)?.[1] ?? NaN);
    if (Number.isNaN(bolgeNo)) return null; // bölge çıkarılamayanı elle ata
    return { role: "BOLGE_MUDURU", bolgeNo };
  });
}

/** Muhasebe birimi (department=9) → ADMIN_BAGIS (bağış güncelleme + planlar). */
export async function importMuhasebe(): Promise<void> {
  await importFromPortal({ department: "9" }, "muhasebe kullanıcısı", () => ({
    role: "ADMIN_BAGIS",
    bolgeNo: null,
  }));
}

/**
 * İl temsilcileri (erişim yetkisi level=12) → TEMSILCI. Portal birim adı
 * units tablosuyla eşleşirse birim ataması otomatik yapılır; eşleşmezse
 * kullanıcı "yetki bekliyor" olarak oluşturulur ve elle atanır.
 */
export async function importTemsilciler(): Promise<void> {
  const activeUnits = await db.select().from(units).where(eq(units.active, true));
  const unitByNorm = new Map(activeUnits.map((u) => [norm(u.name), u]));
  await importFromPortal({ level: "12" }, "il temsilcisi", (acc) => {
    // portal biçimi: "1.Bölge Müdürlüğü / Malatya" → birim adı / işaretinden sonra
    const bare = acc.department.includes("/")
      ? acc.department.split("/").slice(1).join("/").trim()
      : acc.department;
    const unit = unitByNorm.get(norm(bare)) ?? unitByNorm.get(norm(acc.department));
    if (!unit) return { role: null, bolgeNo: null }; // birim eşleşmedi → beklemede
    return { role: "TEMSILCI", bolgeNo: null, unitIds: [unit.id] };
  });
}
