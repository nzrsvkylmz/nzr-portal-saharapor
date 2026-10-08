/**
 * Yardım modülü veri katmanı — relief_data.py portu.
 *
 * Gizlilik ilkesi: HİÇBİR kişisel veri okunmaz/saklanmaz. Başvuru exportundan
 * yalnızca Başvuru tarihi, Şehir, Yerleşim ve Aşama sütunları kullanılır;
 * satırlar bellekte işlenir, DB'ye sadece bölge/temsilcilik bazlı TOPLAM
 * sayılar ve gün listeleri yazılır.
 */
import * as cheerio from "cheerio";
import { daysBetween, parseTrDate } from "@/lib/domain/normalize";
import {
  eslestir,
  isExcludedUnit,
  type UnitMaps,
  type UnitTriple,
} from "@/lib/domain/matching";
import type { NezirClient } from "./client";
import { parseExportXml } from "./spreadsheetml";
import { RemoteError } from "./errors";

/** Aşama tanımı — app_settings.'yardim.flows' ile genişletilebilir. */
export interface StageDef {
  key: string; // 'si', 'bk'
  label: string; // export 'Aşama' sütunundaki tam metin
}

export const DEFAULT_STAGES: StageDef[] = [
  { key: "si", label: "Sosyal İnceleme" },
  { key: "bk", label: "Bölge Koordinatörü Kararı" },
];

/** 23,179 = Sosyal İnceleme + Bölge Koordinatörü Kararı (portal flow id'leri). */
export const DEFAULT_FLOW = "23,179";

export const EXPORT_TIMEOUT_MS = 180_000;

/**
 * Başvuru filtresindeki 'Sorumlu Birim' listesinden sıralı (depId, name, bolge)
 * üçlüleri. Liste hiyerarşiktir: her 'N.Bölge Müdürlüğü' satırını kendi
 * birimleri izler. depId portala derin bağlantı (department=id) için saklanır.
 */
export async function fetchUnitList(client: NezirClient): Promise<UnitTriple[]> {
  const html = await client.getReadonly("/crea/relief/application/filter/index", 60_000);
  const $ = cheerio.load(html);
  const sel = $('select[name="department"]');
  if (sel.length === 0) {
    throw new RemoteError("Başvuru filtresinde Sorumlu Birim listesi bulunamadı.");
  }
  const units: UnitTriple[] = [];
  let cur: string | null = null;
  sel.find("option").each((_, o) => {
    const t = $(o).text().replace(/\s+/g, " ").trim();
    const v = ($(o).attr("value") ?? "").trim();
    if (!t) return;
    const m = /^(\d+)\.Bölge Müdürlüğü$/.exec(t);
    if (m) {
      cur = `${Number(m[1])}.BÖLGE`;
      units.push({ depId: v, name: t, bolge: cur });
    } else if (cur) {
      units.push({ depId: v, name: t, bolge: cur });
    }
  });
  if (units.length === 0) throw new RemoteError("Sorumlu Birim listesi boş döndü.");
  // Coğrafi olmayan özel birimler org yapısına dahil edilmez
  return units.filter((u) => !isExcludedUnit(u.name));
}

export interface PendingRecord {
  bolge: string;
  tems: string;
  stageKey: string;
  gun: number;
}

/**
 * Hedef aşamalardaki TÜM başvuruları tek istekte çeker (flow filtresi —
 * export ASLA filtresiz çağrılmamalıdır, oturum kilidi yaratır).
 * Dönüş: { kayitlar, okunan }. Kişisel alanlar hiç okunmaz.
 */
export async function fetchPending(
  client: NezirClient,
  maps: UnitMaps,
  bugun: Date,
  flow: string = DEFAULT_FLOW,
  stages: StageDef[] = DEFAULT_STAGES,
): Promise<{ kayitlar: PendingRecord[]; okunan: number }> {
  const text = await client.getReadonly(
    `/crea/relief/application/export/now?flow=${flow}`,
    EXPORT_TIMEOUT_MS,
  );
  const rows = parseExportXml(text);
  if (rows.length === 0) return { kayitlar: [], okunan: 0 };

  const h = rows[0];
  const data = rows.slice(1);
  const iT = h.indexOf("Başvuru");
  const iSeh = h.indexOf("Şehir");
  const iYer = h.indexOf("Yerleşim");
  const iAsm = h.indexOf("Aşama");
  if (iT === -1 || iSeh === -1 || iYer === -1 || iAsm === -1) {
    throw new RemoteError(`Başvuru export sütunları beklenenden farklı: ${h.join(", ")}`);
  }

  const stageByLabel = new Map(stages.map((s) => [s.label, s.key]));
  const kayitlar: PendingRecord[] = [];
  for (const r of data) {
    const asama = iAsm < r.length ? r[iAsm] : "";
    const stageKey = stageByLabel.get(asama); // flow değişirse diye emniyet süzgeci
    if (!stageKey) continue;
    const tarih = parseTrDate(iT < r.length ? r[iT] : "");
    const gun = tarih ? daysBetween(bugun, tarih) : -1;
    const [bolge, tems] = eslestir(
      maps,
      iSeh < r.length ? r[iSeh] : "",
      iYer < r.length ? r[iYer] : "",
    );
    kayitlar.push({ bolge, tems, stageKey, gun });
  }
  return { kayitlar, okunan: data.length };
}

/** Portala derin bağlantı: birim + (opsiyonel) kritik tarih filtresi. */
export function portalLink(
  baseUrl: string,
  flow: string,
  depId: string,
  kritikTarih?: string, // DD.MM.YYYY — bu tarihten ESKİ başvurular
): string {
  let url = `${baseUrl}/crea/relief/application/?flow=${flow}&department=${depId}`;
  if (kritikTarih) url += `&record=smaller&record_a=${kritikTarih}`;
  return url;
}
