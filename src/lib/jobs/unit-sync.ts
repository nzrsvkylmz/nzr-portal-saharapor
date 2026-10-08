/**
 * Bağış kabul birimi senkronu: portal departman ağacını units tablosuna
 * işler. Kurallar:
 *  - depId eşleşirse yalnız ad/bölge/bagisBirimi tazelenir; admin alanlarına
 *    (parent, needsReview, active) ve yardimBirimi'ne dokunulmaz.
 *  - Sentetik kayıtlar (depId 'bagis:…'/'manuel:…') ad eşleşmesiyle gerçek
 *    portal kimliğine BENİMSENİR (mükerrer birim oluşmaz; parent/alias korunur).
 *  - Yeni birimler onay kuyruğuna düşer (needsReview=true, parent'sız —
 *    onaylanana dek hiçbir temsilci kapsamına girmez).
 *  - Listeden kalkanların bagisBirimi işareti kaldırılır.
 */
import { eq, inArray, notInArray, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { units } from "@/lib/db/schema";
import { norm } from "@/lib/domain/normalize";
import type { NezirClient } from "@/lib/portal/client";
import { fetchDepartments } from "@/lib/portal/departments";

export interface BagisUnitSyncResult {
  toplam: number;
  yeni: number;
  benimsenen: number;
  guncellenen: number;
  kaldirilan: number;
}

export async function syncBagisUnits(client: NezirClient): Promise<BagisUnitSyncResult> {
  const entries = await fetchDepartments(client);
  const all = await db.select().from(units);
  const byDepId = new Map(all.map((u) => [u.depId, u]));
  // sentetik kayıtlar: norm(ad) → birim (benimseme adayları)
  const synthetic = new Map(
    all
      .filter((u) => u.depId.startsWith("bagis:") || u.depId.startsWith("manuel:"))
      .map((u) => [norm(u.name), u]),
  );

  let yeni = 0;
  let benimsenen = 0;
  let guncellenen = 0;
  await db.transaction(async (tx) => {
    for (const e of entries) {
      const existing = byDepId.get(e.depId);
      if (existing) {
        await tx
          .update(units)
          .set({
            name: e.name,
            bolgeNo: e.bolgeNo,
            bolgeLabel: e.bolgeLabel,
            isBolgeMudurlugu: e.isBolgeMudurlugu,
            bagisBirimi: true,
            syncedAt: new Date(),
          })
          .where(eq(units.id, existing.id));
        guncellenen++;
        continue;
      }
      const synth = synthetic.get(norm(e.name));
      if (synth) {
        // bağış verisinden/elle oluşturulan kayıt gerçek kimliğini kazanır
        await tx
          .update(units)
          .set({
            depId: e.depId,
            name: e.name,
            bolgeNo: e.bolgeNo,
            bolgeLabel: e.bolgeLabel,
            isBolgeMudurlugu: e.isBolgeMudurlugu,
            source: "portal",
            bagisBirimi: true,
            syncedAt: new Date(),
          })
          .where(eq(units.id, synth.id));
        synthetic.delete(norm(e.name));
        benimsenen++;
        continue;
      }
      await tx.insert(units).values({
        depId: e.depId,
        name: e.name,
        bolgeNo: e.bolgeNo,
        bolgeLabel: e.bolgeLabel,
        isBolgeMudurlugu: e.isBolgeMudurlugu,
        cityKey: null, // görünürlük yalnız parent üzerinden; sezgisel anahtar verilmez
        districtKey: null,
        active: true,
        source: "portal",
        bagisBirimi: true,
        yardimBirimi: false,
        needsReview: true,
        syncedAt: new Date(),
      });
      yeni++;
    }

    // ağaçtan kalkanlar: bagisBirimi işareti düşer (kayıt ve geçmişi kalır)
    const depIds = entries.map((e) => e.depId);
    await tx
      .update(units)
      .set({ bagisBirimi: false })
      .where(and(eq(units.bagisBirimi, true), notInArray(units.depId, depIds)));
  });

  // kaldırılan sayısı: işaret taşıyıp listede olmayanlar (rapor için)
  const depIdSet = new Set(entries.map((e) => e.depId));
  const kaldirilan = all.filter((u) => u.bagisBirimi && !depIdSet.has(u.depId)).length;

  return { toplam: entries.length, yeni, benimsenen, guncellenen, kaldirilan };
}

/** Birden çok birimi id listesiyle işaretlemek için küçük yardımcı (toplu onay). */
export async function approveUnits(ids: number[]): Promise<void> {
  if (!ids.length) return;
  await db.update(units).set({ needsReview: false }).where(inArray(units.id, ids));
}
