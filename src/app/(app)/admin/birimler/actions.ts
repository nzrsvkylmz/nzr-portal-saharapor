"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { auditLog, unitAliases, units, userUnits } from "@/lib/db/schema";
import { norm } from "@/lib/domain/normalize";
import { isExcludedUnit } from "@/lib/domain/matching";
import { loadClient } from "@/lib/portal/cookiejar";
import { syncBagisUnits } from "@/lib/jobs/unit-sync";

/**
 * Doğrulama hataları kullanıcıya banner olarak gösterilir (sunucu hatası
 * sayfası yerine): iş mantığı çalıştırılır, hata mesajı ?hata= ile geri döner.
 */
async function withFeedback(work: () => Promise<void>): Promise<void> {
  let err: string | null = null;
  try {
    await work();
  } catch (e) {
    // work() içinden yapılan redirect'ler hata değildir, aynen iletilir
    if (e && typeof e === "object" && "digest" in e &&
        String((e as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")) {
      throw e;
    }
    err = e instanceof Error ? e.message : String(e);
  }
  revalidatePath("/admin/birimler");
  if (err) redirect(`/admin/birimler?hata=${encodeURIComponent(err)}`);
}

/** Birim adını (norm eşitliğiyle) tek bir birime çözer; bulunamazsa/muğlaksa hata. */
async function resolveUnitByName(name: string) {
  const key = norm(name);
  const all = await db.select().from(units);
  const hits = all.filter((u) => norm(u.name) === key);
  if (hits.length === 0) {
    throw new Error(
      `"${name}" adında bir birim yok. Üst birim henüz tanımlı değilse önce ` +
        `"Yeni Birim Oluştur" ile ekleyin.`,
    );
  }
  if (hits.length > 1) throw new Error(`Birden fazla birim eşleşti: "${name}"`);
  return hits[0];
}

/** parent zinciri döngü kontrolü: newParentId'den yukarı çıkarken unitId görülmemeli. */
async function assertNoCycle(unitId: number, newParentId: number): Promise<void> {
  const all = await db.select({ id: units.id, parentUnitId: units.parentUnitId }).from(units);
  const parentOf = new Map(all.map((u) => [u.id, u.parentUnitId]));
  let cur: number | null | undefined = newParentId;
  for (let i = 0; i < 50 && cur != null; i++) {
    if (cur === unitId) throw new Error("Döngüsel hiyerarşi: birim kendi altına bağlanamaz.");
    cur = parentOf.get(cur);
  }
}

/** Birimi günceller ve onay kuyruğundan çıkarır. Yalnız SUPER_ADMIN. */
export async function updateUnit(formData: FormData): Promise<void> {
  const admin = await requireRole("SUPER_ADMIN");
  await withFeedback(async () => {
    const unitId = Number(formData.get("unitId"));
    if (!Number.isInteger(unitId) || unitId <= 0) throw new Error("Geçersiz birim.");
    const parentName = String(formData.get("parentName") ?? "").trim();
    const bolgeNoRaw = String(formData.get("bolgeNo") ?? "").trim();
    const active = formData.get("active") === "on";

    let parentUnitId: number | null = null;
    if (parentName) {
      const parent = await resolveUnitByName(parentName);
      if (parent.id === unitId) throw new Error("Birim kendisine bağlanamaz.");
      await assertNoCycle(unitId, parent.id);
      parentUnitId = parent.id;
    }

    const bolgeNo = bolgeNoRaw ? Number(bolgeNoRaw) : null;
    if (bolgeNoRaw && (!Number.isInteger(bolgeNo) || bolgeNo! <= 0)) {
      throw new Error("Geçersiz bölge numarası.");
    }

    await db.transaction(async (tx) => {
      await tx
        .update(units)
        .set({
          parentUnitId,
          bolgeNo,
          bolgeLabel: bolgeNo ? `${bolgeNo}.BÖLGE` : null,
          active,
          needsReview: false,
        })
        .where(eq(units.id, unitId));
      await tx.insert(auditLog).values({
        userId: admin.id,
        action: "unit_update",
        detail: { unitId, parentUnitId, bolgeNo, active },
      });
    });
  });
}

/**
 * Yeni birim tanımlar (portal/bağış verisinde olmayan ara düzey — ör. il
 * statüsündeki "Bağlar" — için hiyerarşi düğümü ya da ileriye dönük birim).
 */
export async function createUnit(formData: FormData): Promise<void> {
  const admin = await requireRole("SUPER_ADMIN");
  await withFeedback(async () => {
    const name = String(formData.get("name") ?? "").trim();
    const bolgeNoRaw = String(formData.get("bolgeNo") ?? "").trim();
    const parentName = String(formData.get("parentName") ?? "").trim();
    if (!name) throw new Error("Birim adı gerekli.");

    const key = norm(name);
    const all = await db.select().from(units);
    if (all.some((u) => norm(u.name) === key)) {
      throw new Error(`"${name}" adında bir birim zaten var.`);
    }

    let parentUnitId: number | null = null;
    if (parentName) {
      const parent = await resolveUnitByName(parentName);
      parentUnitId = parent.id;
    }
    const bolgeNo = bolgeNoRaw ? Number(bolgeNoRaw) : null;
    if (bolgeNoRaw && (!Number.isInteger(bolgeNo) || bolgeNo! <= 0)) {
      throw new Error("Geçersiz bölge numarası.");
    }

    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(units)
        .values({
          depId: `manuel:${key}`,
          name,
          bolgeNo,
          bolgeLabel: bolgeNo ? `${bolgeNo}.BÖLGE` : null,
          isBolgeMudurlugu: false,
          cityKey: null,
          districtKey: null,
          active: true,
          source: "manuel",
          needsReview: false,
          parentUnitId,
        })
        .returning({ id: units.id });
      await tx.insert(auditLog).values({
        userId: admin.id,
        action: "unit_create",
        detail: { unitId: created.id, name, bolgeNo, parentUnitId },
      });
    });
  });
}

/**
 * Onay bekleyen (genelde bağış kaynaklı) birimi mevcut bir birimin takma adı
 * yapar: AYNI birimin farklı yazımı içindir. Gelecekteki raporlar hedef
 * birime yazılır, kaynak kayıt pasiflenir. Hiyerarşi kurmaz — alt birim
 * bağlamak için "Üst birim" alanını kullanın.
 */
export async function mergeUnitAsAlias(formData: FormData): Promise<void> {
  const admin = await requireRole("SUPER_ADMIN");
  await withFeedback(async () => {
    const unitId = Number(formData.get("unitId"));
    const targetName = String(formData.get("targetName") ?? "").trim();
    if (!Number.isInteger(unitId) || unitId <= 0) throw new Error("Geçersiz birim.");
    if (!targetName) throw new Error("Hedef birim adı gerekli.");

    const [source] = await db.select().from(units).where(eq(units.id, unitId));
    if (!source) throw new Error("Kaynak birim bulunamadı.");
    const target = await resolveUnitByName(targetName);
    if (target.id === source.id) throw new Error("Birim kendisine eşlenemez.");

    await db.transaction(async (tx) => {
      await tx
        .insert(unitAliases)
        .values({
          aliasKey: norm(source.name),
          aliasLabel: source.name,
          unitId: target.id,
          createdBy: admin.id,
        })
        .onConflictDoUpdate({
          target: unitAliases.aliasKey,
          set: { unitId: target.id, createdBy: admin.id },
        });
      await tx
        .update(units)
        .set({ active: false, needsReview: false })
        .where(eq(units.id, source.id));
      await tx.insert(auditLog).values({
        userId: admin.id,
        action: "unit_merge_alias",
        detail: { sourceUnitId: source.id, sourceName: source.name, targetUnitId: target.id },
      });
    });
  });
}

/** Serbest metin takma ad tanımlar (ör. raporlarda farklı yazılan birim adı). */
export async function addAlias(formData: FormData): Promise<void> {
  const admin = await requireRole("SUPER_ADMIN");
  await withFeedback(async () => {
    const aliasLabel = String(formData.get("aliasLabel") ?? "").trim();
    const targetName = String(formData.get("targetName") ?? "").trim();
    if (!aliasLabel) throw new Error("Takma ad gerekli.");
    if (!targetName) throw new Error("Hedef birim adı gerekli.");
    const target = await resolveUnitByName(targetName);

    await db.transaction(async (tx) => {
      await tx
        .insert(unitAliases)
        .values({
          aliasKey: norm(aliasLabel),
          aliasLabel,
          unitId: target.id,
          createdBy: admin.id,
        })
        .onConflictDoUpdate({
          target: unitAliases.aliasKey,
          set: { aliasLabel, unitId: target.id, createdBy: admin.id },
        });
      await tx.insert(auditLog).values({
        userId: admin.id,
        action: "alias_add",
        detail: { aliasLabel, targetUnitId: target.id },
      });
    });
  });
}

/** Portal departman ağacından bağış kabul birimlerini senkronlar. */
export async function syncBagisBirimleri(): Promise<void> {
  const admin = await requireRole("SUPER_ADMIN");
  await withFeedback(async () => {
    const client = await loadClient(admin.id);
    const r = await syncBagisUnits(client);
    await db.insert(auditLog).values({
      userId: admin.id,
      action: "unit_sync_bagis",
      detail: { ...r },
    });
    // sonuç mesajı hata kanalından değil normal banner'dan verilmek istenirdi;
    // withFeedback başarıda sessiz kaldığı için bilgiyi hata parametresiz iletmek
    // adına Error kullanmıyoruz — redirect'i mesajla aşağıda yapıyoruz.
    revalidatePath("/admin/birimler");
    redirect(
      `/admin/birimler?mesaj=${encodeURIComponent(
        `Departman ağacı senkronlandı: ${r.toplam} birim okundu — ${r.yeni} yeni, ` +
          `${r.benimsenen} mevcut kayıtla birleştirildi, ${r.kaldirilan} ağaçtan düşmüş.`,
      )}`,
    );
  });
}

/**
 * Onay kuyruğundaki birimlere önerilen üst birimleri TOPLU uygular. Kurallar:
 *  - Bölge müdürlükleri ve temsilcisi olan birimler (il statüsü) → üst birimsiz onay
 *  - Tek parça adlar (ör. "Malatya") → üst birimsiz onay (il düzeyi)
 *  - "A-B" biçimi → öneki, adı "A" olan ya da "…-A" ile biten TEK birime bağlanır
 *  - Eşsiz aday bulunamayanlar kuyrukta kalır (elle bağlanır)
 */
export async function applySuggestedParents(): Promise<void> {
  const admin = await requireRole("SUPER_ADMIN");
  await withFeedback(async () => {
    const all = await db.select().from(units);
    const assignments = await db.select().from(userUnits);
    const assignedUnitIds = new Set(assignments.map((a) => a.unitId));
    const lastSegment = (name: string): string => {
      const parts = name.replace(/ - /g, "-").split("-").map((p) => p.trim());
      return parts[parts.length - 1];
    };

    let kokOnay = 0;
    let baglanan = 0;
    let kalan = 0;
    // kısa adlar önce: "Şanlıurfa-Birecik" onaylanmadan "Birecik-Suruç" ona bağlanabilsin
    const queue = all
      .filter((u) => u.needsReview && u.active && !isExcludedUnit(u.name))
      .sort((a, b) => a.name.length - b.name.length);
    for (const u of queue) {
      if (u.isBolgeMudurlugu || assignedUnitIds.has(u.id)) {
        await db.update(units).set({ needsReview: false }).where(eq(units.id, u.id));
        kokOnay++;
        continue;
      }
      const parts = u.name.replace(/ - /g, "-").split("-").map((p) => p.trim());
      if (parts.length === 1) {
        await db.update(units).set({ needsReview: false }).where(eq(units.id, u.id));
        kokOnay++;
        continue;
      }
      const prefix = norm(parts.slice(0, -1).join("-"));
      const candidates = all.filter(
        (c) =>
          c.id !== u.id &&
          c.active &&
          !c.isBolgeMudurlugu &&
          c.bolgeNo === u.bolgeNo &&
          (norm(c.name) === prefix || norm(lastSegment(c.name)) === prefix),
      );
      if (candidates.length === 1) {
        await db
          .update(units)
          .set({ parentUnitId: candidates[0].id, needsReview: false })
          .where(eq(units.id, u.id));
        baglanan++;
      } else {
        kalan++; // eşsiz aday yok → kuyrukta kalır
      }
    }

    await db.insert(auditLog).values({
      userId: admin.id,
      action: "unit_bulk_suggest",
      detail: { kokOnay, baglanan, kalan },
    });
    revalidatePath("/admin/birimler");
    redirect(
      `/admin/birimler?mesaj=${encodeURIComponent(
        `Öneriler uygulandı: ${kokOnay} birim il/kök düzeyinde onaylandı, ` +
          `${baglanan} birim üst birimine bağlandı, ${kalan} birim eşsiz aday ` +
          `bulunamadığı için kuyrukta bırakıldı.`,
      )}`,
    );
  });
}

export async function deleteAlias(formData: FormData): Promise<void> {
  const admin = await requireRole("SUPER_ADMIN");
  await withFeedback(async () => {
    const aliasId = Number(formData.get("aliasId"));
    if (!Number.isInteger(aliasId) || aliasId <= 0) throw new Error("Geçersiz takma ad.");

    await db.transaction(async (tx) => {
      await tx.delete(unitAliases).where(eq(unitAliases.id, aliasId));
      await tx.insert(auditLog).values({
        userId: admin.id,
        action: "alias_delete",
        detail: { aliasId },
      });
    });
  });
}
