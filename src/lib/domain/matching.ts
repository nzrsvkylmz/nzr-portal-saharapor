/**
 * Şehir/yerleşim → birim eşleştirme — relief_data.build_maps/eslestir portu +
 * bağış kabul birimi ("N. Bölge Müdürlüğü / Malatya", "Malatya-ilçe") için
 * YENİ birim düzeyi eşleme.
 */
import { norm } from "./normalize";

export interface UnitTriple {
  depId: string;
  name: string;
  bolge: string; // "1.BÖLGE"
}

export interface UnitMaps {
  city2units: Record<string, Array<[string, string]>>; // 'şanlıurfa' -> [[birim, bölge], ...]
  ilce2unit: Record<string, [string, string]>; // 'esenyurt' -> [birim, bölge]
  unit2id: Record<string, string>; // 'Malatya' -> department id
  name2unit: Record<string, [string, string]>; // norm(birim adı) -> [birim, bölge]
  bolgeler: string[];
}

export const UNMATCHED = "EŞLENMEYEN";

/**
 * Coğrafi temsilcilik olmayan özel birimler: org listesinden tamamen hariç
 * tutulur (senkronlanmaz, seçim listelerinde ve raporlarda görünmez).
 * norm() ile karşılaştırılır.
 */
export const EXCLUDED_UNIT_NAMES = [
  "sosyal yardımlar birimi",
  "sosyal yardımlar saha gönüllü",
  "suriye yardımları birimi",
];

export function isExcludedUnit(name: string): boolean {
  return EXCLUDED_UNIT_NAMES.includes(norm(name));
}

export function buildMaps(units: UnitTriple[]): UnitMaps {
  const city2units: UnitMaps["city2units"] = {};
  const ilce2unit: UnitMaps["ilce2unit"] = {};
  const unit2id: UnitMaps["unit2id"] = {};
  const name2unit: UnitMaps["name2unit"] = {};
  const bolgeler: string[] = [];

  for (const { depId, name, bolge } of units) {
    if (!bolgeler.includes(bolge)) bolgeler.push(bolge);
    unit2id[name] = depId;
    name2unit[norm(name)] = [name, bolge];
    if (name.includes("Bölge Müdürlüğü")) continue;
    const parts = name
      .replace(/ - /g, "-")
      .split("-")
      .map((p) => p.trim());
    const cityKey = norm(parts[0]);
    (city2units[cityKey] ??= []).push([name, bolge]);
    for (const p of parts) {
      const k = norm(p);
      if (!(k in ilce2unit)) ilce2unit[k] = [name, bolge];
    }
  }
  return { city2units, ilce2unit, unit2id, name2unit, bolgeler };
}

/** (bölge, temsilcilik) döndürür; eşleşemezse (EŞLENMEYEN, şehir/yerleşim). */
export function eslestir(
  maps: UnitMaps,
  sehir: string,
  yerlesim: string,
): [string, string] {
  const s = norm(sehir);
  const y = norm(yerlesim);
  if (s.startsWith("istanbul")) {
    const hit = maps.ilce2unit[y];
    return hit ? [hit[1], hit[0]] : [UNMATCHED, yerlesim || sehir || "?"];
  }
  const units = maps.city2units[s] ?? [];
  if (units.length === 1) return [units[0][1], units[0][0]];
  if (units.length > 1) {
    for (const [unit, bolge] of units) {
      // çok birimli şehir: ilçe son ekiyle ayrıştır
      if (unit.includes("-") && norm(unit.split("-").slice(1).join("-")) === y) {
        return [bolge, unit];
      }
    }
    for (const [unit, bolge] of units) {
      if (norm(unit) === s) return [bolge, unit];
    }
    return [units[0][1], units[0][0]];
  }
  const hit = maps.ilce2unit[y];
  if (hit) return [hit[1], hit[0]];
  return [UNMATCHED, sehir || yerlesim || "?"];
}

// ---- bağış kabul birimi eşleme (yeni, birim düzeyi) ----

/** "N.Bölge Müdürlüğü / Şehir" biçiminden bölge numarası. */
export const BOLGE_RX = /^(\d+)\s*\.?\s*Bölge/i;

export interface DonationUnitMatch {
  bolgeLabel: string; // '1.BÖLGE' | 'DİĞER' | 'BELİRTİLMEMİŞ'
  unitName: string | null; // eşleşen birim adı; bölge merkezi kabulde null
  matched: boolean; // units tablosundaki bir birime bağlanabildi mi
}

/**
 * Bağış kabul birimi metnini bölge + birime çözer:
 *  - "1. Bölge Müdürlüğü / Malatya" → 1.BÖLGE + Malatya
 *  - "1.Bölge Müdürlüğü"            → 1.BÖLGE (merkez kabul, birim yok)
 *  - "Malatya-ilçe" / "Kayapınar"   → birim adı/ilçe adı üzerinden eşleşir
 *  - eşleşmeyen dolu metin          → DİĞER (yurt dışı vb.)
 */
/** Çıplak birim/ilçe adını birime çözer: tam ad → ilçe adı → şehir eşleşmesi. */
function resolveBareName(maps: UnitMaps, text: string): [string, string] | null {
  const exact = maps.name2unit[norm(text)];
  if (exact) return [exact[1], exact[0]];
  const parts = text.replace(/ - /g, "-").split("-").map((p) => p.trim());
  const ilceHit =
    maps.ilce2unit[norm(text)] ?? maps.ilce2unit[norm(parts[parts.length - 1])];
  if (ilceHit) return [ilceHit[1], ilceHit[0]];
  const [bolge, unit] = eslestir(maps, parts[0], parts.slice(1).join("-"));
  return bolge === UNMATCHED ? null : [bolge, unit];
}

export function matchDonationUnit(maps: UnitMaps, birimRaw: string): DonationUnitMatch {
  const birim = (birimRaw ?? "").trim();
  if (!birim) return { bolgeLabel: "BELİRTİLMEMİŞ", unitName: null, matched: false };

  const m = BOLGE_RX.exec(birim);
  if (m) {
    const bolgeLabel = `${Number(m[1])}.BÖLGE`;
    const slash = birim.indexOf("/");
    if (slash === -1) return { bolgeLabel, unitName: null, matched: true };
    const unitPart = birim.slice(slash + 1).trim();
    if (!unitPart) return { bolgeLabel, unitName: null, matched: true };

    const hit = resolveBareName(maps, unitPart);
    if (hit) return { bolgeLabel: hit[0], unitName: hit[1], matched: true };
    // bölge öneki güvenilir: birimi ham adıyla bölgenin altında göster
    return { bolgeLabel, unitName: unitPart, matched: false };
  }

  // Bölge öneki yok: "Malatya-ilçe", "Kayapınar" gibi çıplak adlar
  const hit = resolveBareName(maps, birim);
  if (hit) return { bolgeLabel: hit[0], unitName: hit[1], matched: true };
  return { bolgeLabel: "DİĞER", unitName: birim, matched: false };
}
