/**
 * Yardım raporu işi: birim senkronu → bekleyen başvuru çekimi → snapshot.
 * Kişisel veri invariant'ı: export satırları yalnız bellekte işlenir,
 * DB'ye sadece bölge/birim bazlı gün listeleri ve sayılar yazılır.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { units, yardimAggregates } from "@/lib/db/schema";
import { loadClient, saveClient } from "@/lib/portal/cookiejar";
import {
  DEFAULT_FLOW,
  DEFAULT_STAGES,
  fetchPending,
  fetchUnitList,
  type StageDef,
} from "@/lib/portal/relief";
import { buildMaps, UNMATCHED, type UnitTriple } from "@/lib/domain/matching";
import { norm } from "@/lib/domain/normalize";

export interface YardimParams {
  flow?: string; // varsayılan '23,179'
  stages?: StageDef[]; // varsayılan si+bk
  thresholdDays?: number; // bilgi amaçlı; kritik sayım okuma anında hesaplanır
}

type Progress = (pct: number, msg: string) => Promise<void>;

/**
 * Yardım "Sorumlu Birim" listesini units tablosuna upsert eder: yalnız
 * yardimBirimi üyeliğini yönetir. Admin alanlarına (parent_unit_id,
 * needs_review, active) ve bagisBirimi'ne dokunmaz; yeni birimler onay
 * kuyruğuna (needs_review=true) düşer, listeden kalkanların yardimBirimi
 * işareti kaldırılır.
 */
export async function syncUnits(triples: UnitTriple[]): Promise<void> {
  const now = new Date();
  const depIds = triples.map((t) => t.depId);
  await db.transaction(async (tx) => {
    for (const t of triples) {
      const bolgeNo = Number(/^(\d+)\./.exec(t.bolge)?.[1] ?? NaN);
      const isBM = t.name.includes("Bölge Müdürlüğü");
      const parts = t.name.replace(/ - /g, "-").split("-").map((p) => p.trim());
      await tx
        .insert(units)
        .values({
          depId: t.depId,
          name: t.name,
          bolgeNo: Number.isNaN(bolgeNo) ? null : bolgeNo,
          bolgeLabel: t.bolge,
          isBolgeMudurlugu: isBM,
          cityKey: isBM ? null : norm(parts[0]),
          districtKey: !isBM && parts.length > 1 ? norm(parts.slice(1).join("-")) : null,
          active: true,
          syncedAt: now,
          source: "portal",
          yardimBirimi: true,
          needsReview: true, // hiyerarşiyi admin atayana dek kuyrukta
        })
        .onConflictDoUpdate({
          target: units.depId,
          set: {
            name: t.name,
            bolgeNo: Number.isNaN(bolgeNo) ? null : bolgeNo,
            bolgeLabel: t.bolge,
            isBolgeMudurlugu: isBM,
            cityKey: isBM ? null : norm(parts[0]),
            districtKey:
              !isBM && parts.length > 1 ? norm(parts.slice(1).join("-")) : null,
            yardimBirimi: true,
            syncedAt: now,
          },
        });
    }
    if (depIds.length) {
      await tx
        .update(units)
        .set({ yardimBirimi: false })
        .where(and(notInArray(units.depId, depIds), eq(units.yardimBirimi, true)));
    }
  });
}

export async function runYardimJob(
  runId: string,
  userId: string,
  params: YardimParams,
  progress: Progress,
): Promise<number> {
  const flow = params.flow ?? DEFAULT_FLOW;
  const stages = params.stages ?? DEFAULT_STAGES;

  await progress(5, "Portal oturumu yükleniyor…");
  const client = await loadClient(userId);

  await progress(10, "Birim listesi portaldan senkronlanıyor…");
  const triples = await fetchUnitList(client);
  await syncUnits(triples);
  const maps = buildMaps(triples);

  await progress(30, "Bekleyen başvurular çekiliyor (bu adım birkaç dakika sürebilir)…");
  const bugun = new Date();
  const { kayitlar, okunan } = await fetchPending(client, maps, bugun, flow, stages);
  await saveClient(userId, client, "authenticated");

  await progress(80, "Özet hesaplanıyor ve kaydediliyor…");

  // bölge → stage → günler ve birim → stage → günler
  const bolgeAgg = new Map<string, Map<string, number[]>>();
  const unitAgg = new Map<string, Map<string, number[]>>(); // key: `${bolge}|${tems}`
  for (const k of kayitlar) {
    const b = bolgeAgg.get(k.bolge) ?? new Map<string, number[]>();
    b.set(k.stageKey, [...(b.get(k.stageKey) ?? []), k.gun]);
    bolgeAgg.set(k.bolge, b);
    const key = `${k.bolge}|${k.tems}`;
    const u = unitAgg.get(key) ?? new Map<string, number[]>();
    u.set(k.stageKey, [...(u.get(k.stageKey) ?? []), k.gun]);
    unitAgg.set(key, u);
  }

  // birim adı → unit_id eşlemesi
  const activeUnits = await db.select().from(units).where(eq(units.active, true));
  const idByName = new Map(activeUnits.map((u) => [u.name, u.id]));

  type AggRow = typeof yardimAggregates.$inferInsert;
  const rows: AggRow[] = [];
  for (const [bolge, stagesMap] of bolgeAgg) {
    if (bolge === UNMATCHED) continue;
    for (const [stageKey, days] of stagesMap) {
      rows.push({
        runId,
        scope: "bolge",
        bolgeLabel: bolge,
        unitId: null,
        unitLabel: null,
        stageKey,
        days,
        count: days.length,
      });
    }
  }
  for (const [key, stagesMap] of unitAgg) {
    const [bolge, tems] = key.split("|");
    const unmatched = bolge === UNMATCHED;
    for (const [stageKey, days] of stagesMap) {
      rows.push({
        runId,
        scope: unmatched ? "unmatched" : "unit",
        bolgeLabel: unmatched ? null : bolge,
        unitId: unmatched ? null : (idByName.get(tems) ?? null),
        unitLabel: tems,
        stageKey,
        days,
        count: days.length,
      });
    }
  }

  await db.transaction(async (tx) => {
    if (rows.length) {
      // tek transaction: yarım snapshot asla görünmez
      for (let i = 0; i < rows.length; i += 500) {
        await tx.insert(yardimAggregates).values(rows.slice(i, i + 500));
      }
    }
    await tx.execute(sql`SELECT 1`); // boş snapshot da geçerli bir sonuçtur
  });

  return okunan;
}

/** Eski snapshot'ların aggregate satırlarını temizler (son N run kalır). */
export async function pruneOldRuns(kind: "bagis" | "yardim", keep = 10): Promise<void> {
  const old = await db.execute(sql`
    SELECT id FROM report_runs
    WHERE kind = ${kind} AND status = 'done'
    ORDER BY finished_at DESC OFFSET ${keep}
  `);
  const ids = (old.rows as Array<{ id: string }>).map((r) => r.id);
  if (ids.length) {
    const { reportRuns } = await import("@/lib/db/schema");
    await db.delete(reportRuns).where(inArray(reportRuns.id, ids)); // cascade aggregates
  }
}
