/**
 * Türkçe metin ve para normalizasyonu — Python relief_data.norm /
 * donate_parser.clean+parse_amount birebir portu. İ/ı dönüşümü JS
 * locale davranışına bırakılmaz ("İ".toLowerCase() → "i̇" tuzağı).
 */

const NBSP = " ";

export function norm(s: string | null | undefined): string {
  return (s ?? "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().trim();
}

export function clean(value: string | null | undefined): string {
  return (value ?? "").replace(new RegExp(NBSP, "g"), " ").replace(/\s+/g, " ").trim();
}

/** '₺1.234,56' / '1.234,56 TL' / '1234.56' → number. Çözülemezse null. */
export function parseAmount(value: unknown): number | null {
  let s = clean(String(value ?? ""));
  s = s.replace(/[^\d.,\-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(/,/g, "."); // 1.234,56 → 1234.56
  } else if (s.includes(",")) {
    s = s.replace(/,/g, "."); // 1234,56 → 1234.56
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, ""); // 1.234.567 → 1234567
  } else if (s.includes(".")) {
    // Tek nokta: '1.234' binlik mi '12.5' ondalık mı? 3 haneli kuyruk binliktir.
    const idx = s.lastIndexOf(".");
    const head = s.slice(0, idx);
    const tail = s.slice(idx + 1);
    if (tail.length === 3) s = head + tail;
  }
  const n = Number.parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/** Export tutarları düz sayıdır ('300', '1234.56'); TR biçimine de düşebilir. */
export function exportAmount(value: unknown): number {
  const direct = Number.parseFloat(String(value ?? ""));
  if (!Number.isNaN(direct) && /^-?\d+(\.\d+)?$/.test(String(value ?? "").trim())) {
    return direct;
  }
  return parseAmount(value) ?? 0;
}

/** 'DD.MM.YYYY' → Date (yerel gün başı). Çözülemezse null. */
export function parseTrDate(s: string | null | undefined): Date | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec((s ?? "").trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** İki tarih arasındaki tam gün sayısı (a - b). */
export function daysBetween(a: Date, b: Date): number {
  const dayMs = 24 * 60 * 60 * 1000;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcA - utcB) / dayMs);
}

/** Date → 'DD.MM.YYYY' (portal tarih parametre biçimi). */
export function toTrDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** 1234.56 → '₺1.234,56' (TR para gösterimi). */
export function trMoney(value: number): string {
  const s = value
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, "X")
    .replace(".", ",")
    .replace(/X/g, ".");
  return "₺" + s;
}

/** 'DD.MM.YYYY' → 'YYYY-MM' (plan ayı anahtarı). */
export function trDateToMonth(s: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}` : null;
}
