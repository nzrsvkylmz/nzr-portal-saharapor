/**
 * Bağış raporu işi: filtre seçeneklerini tazele → export → birim düzeyi
 * eşleme → ay-bazlı birleştirme. Bağışçı verisi ASLA saklanmaz; yalnız
 * birim+tutar bellekte toplanır, DB'ye aggregate yazılır.
 *
 * Depo modeli: bagis_aggregates kalıcı aylık depodur. Çekim, aralığın
 * dokunduğu ayları TAM AY olarak portaldan yeniden çeker, o ayların
 * satırlarını silip günceller; diğer aylar son halleriyle kalır.
 *
 * Eşleme sırası: units tablosu → unit_aliases (admin eşlemeleri) → yeni
 * birim keşfi (needs_review=true ile kuyruğa kaydedilir, asla sessizce
 * DİĞER'e düşmez).
 */
import { eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings, bagisAggregates, unitAliases, units } from "@/lib/db/schema";
import { loadClient, saveClient } from "@/lib/portal/cookiejar";
import { fetchDonationRows, fetchFilterOptions } from "@/lib/portal/donate";
import { fetchUnitList } from "@/lib/portal/relief";
import { buildMaps, isExcludedUnit, matchDonationUnit, BOLGE_RX } from "@/lib/domain/matching";
import { daysBetween, norm, parseTrDate, toTrDate } from "@/lib/domain/normalize";

export interface BagisParams {
  dateA: string; // DD.MM.YYYY
  dateB: string;
  types: string; // '1,2,3,4,5'
  activity?: string; // '1' | '1,15' (virgülle çoklu) | '' / 'all' → filtre yok
  pool?: string;
}

type Progress = (pct: number, msg: string) => Promise<void>;

/** Export servisi tek çağrıda en çok bu kadar satır döndürür (ölçüldü). */
const EXPORT_ROW_CAP = 5_000;

/**
 * Tarih aralığının DOKUNDUĞU takvim aylarını tam ay olarak döndürür (uçlar
 * kırpılmaz: ayın verisi her zaman bütün olarak çekilir, çünkü depo ay
 * bazında silinip yeniden yazılır).
 */
function monthRanges(
  dateA: string,
  dateB: string,
): Array<{ month: string; a: string; b: string }> {
  const a = parseTrDate(dateA);
  const b = parseTrDate(dateB);
  if (!a || !b || a > b) {
    return [{ month: `${dateA.slice(6)}-${dateA.slice(3, 5)}`, a: dateA, b: dateB }];
  }
  const out: Array<{ month: string; a: string; b: string }> = [];
  let cur = new Date(a.getFullYear(), a.getMonth(), 1);
  while (cur <= b) {
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    out.push({
      month: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`,
      a: toTrDate(cur),
      b: toTrDate(monthEnd),
    });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return out;
}

/**
 * Bir tarih aralığını çeker; sonuç satır sınırına takıldıysa aralığı ikiye
 * bölüp devam eder (uzun aralıklarda sessiz veri kaybını önler). Tek gün
 * bile sınıra takılırsa daha fazla bölünemez; warnings'e not düşülür.
 */
async function fetchRangeChunked(
  client: Parameters<typeof fetchDonationRows>[0],
  base: Omit<Parameters<typeof fetchDonationRows>[1], "dateA" | "dateB">,
  dateA: string,
  dateB: string,
  warnings: string[],
): Promise<Array<[string, number]>> {
  const part = await fetchDonationRows(client, { ...base, dateA, dateB });
  if (part.length < EXPORT_ROW_CAP) return part;
  const a = parseTrDate(dateA);
  const b = parseTrDate(dateB);
  if (!a || !b || daysBetween(b, a) < 1) {
    warnings.push(`${dateA} günü ${EXPORT_ROW_CAP} satır sınırına takıldı; gün eksik olabilir`);
    return part;
  }
  const mid = new Date(a.getTime() + (b.getTime() - a.getTime()) / 2);
  const midNext = new Date(mid);
  midNext.setDate(midNext.getDate() + 1);
  const left = await fetchRangeChunked(client, base, dateA, toTrDate(mid), warnings);
  const right = await fetchRangeChunked(client, base, toTrDate(midNext), dateB, warnings);
  return [...left, ...right];
}

/**
 * Eşleşmeyen bağış kabul birimlerini units tablosuna 'bagis' kaynaklı ve
 * onay bekliyor olarak kaydeder. Görünürlüğe etkisi yok (parent atanmadan
 * hiçbir temsilci kapsamına girmez); admin /admin/birimler'den düzenler.
 */
async function registerUnknownUnits(
  labels: Map<string, string | null>, // ham etiket → bölge etiketi ('1.BÖLGE') | null
): Promise<void> {
  for (const [label, bolgeLabel] of labels) {
    if (!label || isExcludedUnit(label)) continue;
    const bolgeNo = bolgeLabel ? Number(/^(\d+)\./.exec(bolgeLabel)?.[1] ?? NaN) : NaN;
    await db
      .insert(units)
      .values({
        depId: `bagis:${norm(label)}`,
        name: label,
        bolgeNo: Number.isNaN(bolgeNo) ? null : bolgeNo,
        bolgeLabel: bolgeLabel ?? null,
        isBolgeMudurlugu: false,
        cityKey: null, // bilinçli boş: onaylanmadan temsilci kapsamına girmesin
        districtKey: null,
        active: true,
        source: "bagis",
        bagisBirimi: true, // bağış verisinde görüldü
        needsReview: true,
      })
      .onConflictDoNothing({ target: units.depId });
  }
}

export async function runBagisJob(
  runId: string,
  userId: string,
  params: BagisParams,
  progress: Progress,
): Promise<number> {
  await progress(5, "Portal oturumu yükleniyor…");
  const client = await loadClient(userId);

  await progress(10, "Filtre seçenekleri tazeleniyor…");
  let filterOptions: Awaited<ReturnType<typeof fetchFilterOptions>> | null = null;
  try {
    filterOptions = await fetchFilterOptions(client);
    await db
      .insert(appSettings)
      .values({ key: "bagis.filters", value: filterOptions })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: filterOptions } });
  } catch {
    // filtre cache'i tazelenemezse rapor yine de çekilebilir; etiketler cache'ten okunur
    const [cached] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "bagis.filters"));
    filterOptions = (cached?.value as typeof filterOptions) ?? null;
  }
  /** Faaliyet (bağış şartı) id'sini ekran etiketine çevirir. */
  const activityLabel = (id: string): string | null => {
    if (!id || id.toLowerCase() === "all") return null;
    return filterOptions?.activities.find(([v]) => v === id)?.[1] ?? id;
  };

  await progress(20, "Birim haritası hazırlanıyor…");
  const activeUnits = await db.select().from(units).where(eq(units.active, true));
  let maps;
  if (activeUnits.length) {
    maps = buildMaps(
      activeUnits.map((u) => ({
        depId: u.depId,
        name: u.name,
        bolge: u.bolgeLabel ?? "",
      })),
    );
  } else {
    // birimler hiç senkronlanmamışsa portaldan çek (yardım filtre sayfası)
    const triples = await fetchUnitList(client);
    const { syncUnits } = await import("./yardim-job");
    await syncUnits(triples);
    maps = buildMaps(triples);
  }

  // Admin eşlemeleri: norm(ham etiket) → birim adı + bölgesi
  const aliasRows = await db
    .select({ aliasKey: unitAliases.aliasKey, unit: units })
    .from(unitAliases)
    .innerJoin(units, eq(unitAliases.unitId, units.id));
  const aliasMap = new Map(
    aliasRows.map((r) => [r.aliasKey, { name: r.unit.name, bolge: r.unit.bolgeLabel }]),
  );

  // Çoklu faaliyet: export servisi tek activity kabul eder, ayrı ayrı çekilir
  const activityList = String(params.activity ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const activities = activityList.length ? activityList : [""];

  // şart × ay → export satırları; aggregate'ler şart ve ay bazında yazılır
  const months = monthRanges(params.dateA, params.dateB);
  const groups: Array<{
    sart: string | null;
    month: string;
    rows: Array<[string, number]>;
  }> = [];
  const warnings: string[] = [];
  const steps = activities.length * months.length;
  let step = 0;
  for (const activity of activities) {
    const sart = activityLabel(activity);
    for (const m of months) {
      await progress(
        35 + Math.round((step / steps) * 35),
        `Bağış kayıtları çekiliyor (${++step}/${steps}: ${sart ?? "tümü"} ${m.month})…`,
      );
      const rows = await fetchRangeChunked(
        client,
        { types: params.types, activity, pool: params.pool },
        m.a,
        m.b,
        warnings,
      );
      groups.push({ sart, month: m.month, rows });
    }
  }
  const totalRows = groups.reduce((s, g) => s + g.rows.length, 0);
  await saveClient(userId, client, "authenticated");

  await progress(
    80,
    warnings.length
      ? `Birim dağılımı hesaplanıyor… (uyarı: ${warnings.join("; ")})`
      : "Birim dağılımı hesaplanıyor…",
  );

  interface Agg {
    adet: number;
    gelir: number;
  }
  const bolgeAgg = new Map<
    string,
    { sart: string | null; month: string; bolge: string; agg: Agg }
  >();
  const unitAgg = new Map<
    string,
    { sart: string | null; month: string; bolge: string; unit: string; agg: Agg }
  >();
  const unknown = new Map<string, string | null>(); // ham etiket → bölge | null
  for (const { sart, month, rows } of groups) {
    for (const [birimRaw, tutar] of rows) {
      let m = matchDonationUnit(maps, birimRaw);
      if (!m.matched && m.unitName) {
        // admin eşlemesi (alias) dene: tam ham metin veya çözülen birim parçası
        const hit = aliasMap.get(norm(birimRaw)) ?? aliasMap.get(norm(m.unitName));
        if (hit) {
          m = { bolgeLabel: hit.bolge ?? m.bolgeLabel, unitName: hit.name, matched: true };
        } else {
          unknown.set(
            m.unitName,
            BOLGE_RX.test(birimRaw) || /^\d+\.BÖLGE$/.test(m.bolgeLabel)
              ? m.bolgeLabel
              : null,
          );
        }
      }
      const bKey = `${sart}|${month}|${m.bolgeLabel}`;
      const b =
        bolgeAgg.get(bKey) ??
        { sart, month, bolge: m.bolgeLabel, agg: { adet: 0, gelir: 0 } };
      b.agg.adet += 1;
      b.agg.gelir += tutar;
      bolgeAgg.set(bKey, b);

      // birim satırı: merkez kabul (unitName null) bölge müdürlüğü adıyla gösterilir
      const unitLabel = m.unitName ?? `${m.bolgeLabel} Merkez`;
      const key = `${sart}|${month}|${m.bolgeLabel}|${unitLabel}`;
      const u = unitAgg.get(key) ?? {
        sart,
        month,
        bolge: m.bolgeLabel,
        unit: unitLabel,
        agg: { adet: 0, gelir: 0 },
      };
      u.agg.adet += 1;
      u.agg.gelir += tutar;
      unitAgg.set(key, u);
    }
  }

  // Bilinmeyen birimler onay kuyruğuna (admin /admin/birimler'de eşler/onaylar)
  if (unknown.size) await registerUnknownUnits(unknown);

  const refreshedUnits = await db.select().from(units).where(eq(units.active, true));
  const idByName = new Map(refreshedUnits.map((u) => [u.name, u.id]));

  type AggRow = typeof bagisAggregates.$inferInsert;
  const aggRows: AggRow[] = [];
  for (const { sart, month, bolge, agg } of bolgeAgg.values()) {
    aggRows.push({
      runId,
      scope: "bolge",
      activity: sart,
      month,
      bolgeLabel: bolge,
      unitId: null,
      unitLabel: null,
      donationCount: agg.adet,
      totalAmount: agg.gelir.toFixed(2),
    });
  }
  for (const { sart, month, bolge, unit, agg } of unitAgg.values()) {
    aggRows.push({
      runId,
      scope: "unit",
      activity: sart,
      month,
      bolgeLabel: bolge,
      unitId: idByName.get(unit) ?? null,
      unitLabel: unit,
      donationCount: agg.adet,
      totalAmount: agg.gelir.toFixed(2),
    });
  }

  // Ay-bazlı birleştirme: yalnız çekilen ayların satırları yenilenir; diğer
  // aylar son halleriyle kalır. Eski (ay kırılımsız) satırlar da temizlenir.
  const coveredMonths = months.map((m) => m.month);
  await db.transaction(async (tx) => {
    await tx
      .delete(bagisAggregates)
      .where(
        or(
          inArray(bagisAggregates.month, coveredMonths),
          isNull(bagisAggregates.month),
        ),
      );
    for (let i = 0; i < aggRows.length; i += 500) {
      await tx.insert(bagisAggregates).values(aggRows.slice(i, i + 500));
    }
  });

  return totalRows;
}
