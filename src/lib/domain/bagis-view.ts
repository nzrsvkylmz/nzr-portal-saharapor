/**
 * Bağış raporu görünüm yardımcıları: şart (faaliyet) listesi ve şart seçimine
 * göre aggregate satırlarının süzülmesi/birleştirilmesi. Sayfa ve Excel
 * export aynı mantığı kullanır.
 */
import type { bagisAggregates } from "@/lib/db/schema";

export type BagisAggRow = typeof bagisAggregates.$inferSelect;

/** Snapshot'taki aylar (yeni → eski). Eski snapshot'larda boş liste döner. */
export function monthList(rows: BagisAggRow[]): string[] {
  const set = [...new Set(rows.map((r) => r.month).filter((x): x is string => !!x))];
  return set.sort((a, b) => b.localeCompare(a));
}

/** 'YYYY-AA' aralığındaki ayların listesi (uçlar dahil, en çok 10 yıl). */
export function monthsInRange(ayA: string, ayB: string): string[] {
  const out: string[] = [];
  let [y, m] = ayA.split("-").map(Number);
  for (let i = 0; i < 120; i++) {
    const cur = `${y}-${String(m).padStart(2, "0")}`;
    if (cur > ayB) break;
    out.push(cur);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Ay aralığı filtresi: ay kırılımlı depoda [ayA..ayB] aralığındaki satırlar;
 * ay kırılımı olmayan eski snapshot olduğu gibi kalır.
 */
export function rowsForMonthRange(
  rows: BagisAggRow[],
  ayA: string,
  ayB: string,
): BagisAggRow[] {
  if (monthList(rows).length === 0) return rows;
  return rows.filter((r) => r.month !== null && r.month >= ayA && r.month <= ayB);
}

/** Snapshot'taki şart etiketleri (Genel Bağış önce, kalanı TR alfabetik). */
export function sartList(rows: BagisAggRow[]): string[] {
  const set = [...new Set(rows.map((r) => r.activity).filter((x): x is string => !!x))];
  return set.sort(
    (a, b) =>
      (a === "Genel Bağış" ? -1 : 0) - (b === "Genel Bağış" ? -1 : 0) ||
      a.localeCompare(b, "tr"),
  );
}

/**
 * Şart seçiliyse o şartın satırları, değilse ("Tümü") tüm şartlar; her iki
 * durumda da satırlar bölge/birim bazında TOPLANIR (ay aralığı birden çok
 * ayın satırını içerebileceği için birleştirme her zaman gerekir).
 */
export function rowsForSart(rows: BagisAggRow[], sart: string | null): BagisAggRow[] {
  const filtered = sart ? rows.filter((r) => r.activity === sart) : rows;
  const merged = new Map<string, BagisAggRow>();
  for (const r of filtered) {
    const key = `${r.scope}|${r.bolgeLabel}|${r.unitLabel ?? ""}`;
    const cur = merged.get(key);
    if (!cur) {
      merged.set(key, { ...r, activity: sart });
    } else {
      cur.donationCount += r.donationCount;
      cur.totalAmount = (Number(cur.totalAmount) + Number(r.totalAmount)).toFixed(2);
    }
  }
  return [...merged.values()];
}
