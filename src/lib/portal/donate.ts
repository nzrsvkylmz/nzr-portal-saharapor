/**
 * Bağış modülü veri katmanı — donate_parser.py portu + birim düzeyi eşleme.
 *
 * Bağış detayları (kişi, kayıt) ASLA saklanmaz; export satırlarından yalnızca
 * "Bağış Kabul Birimi" ve "Bağış Tutarı" okunur, bellekte toplanır.
 */
import * as cheerio from "cheerio";
import { clean, exportAmount } from "@/lib/domain/normalize";
import type { NezirClient } from "./client";
import { parseExportXml } from "./spreadsheetml";
import { RemoteError } from "./errors";

export const EXPORT_TIMEOUT_MS = 180_000;

/** "Tümü": ilgili filtre eklenmez, uzak sistem tümünü döndürür. */
export const FILTER_ALL = "all";

export interface FilterOptions {
  activities: Array<[string, string]>;
  pools: Array<[string, string]>;
  types: Array<[string, string]>;
}

/**
 * Liste sayfasının filtre panelinden seçenek listelerini okur.
 * Ekran etiketleri: activity=Faaliyet, pool=Fon Bölgesi, type=Bağış Türü.
 * Her rapor çekişinde yeniden çağrılır ki yeni seçenekler anında görünsün.
 */
export async function fetchFilterOptions(client: NezirClient): Promise<FilterOptions> {
  const html = await client.getReadonly("/crea/donate/donate/filter");
  const $ = cheerio.load(html);

  function options(name: string): Array<[string, string]> {
    const sel = $(`select[name="${name}"]`);
    if (sel.length === 0) {
      throw new RemoteError(`Filtre panelinde '${name}' listesi bulunamadı.`);
    }
    const opts: Array<[string, string]> = [];
    sel.find("option").each((_, o) => {
      const v = ($(o).attr("value") ?? "").trim();
      if (v) opts.push([v, clean($(o).text())]);
    });
    if (opts.length === 0) throw new RemoteError(`Filtre '${name}' listesi boş döndü.`);
    return opts;
  }

  return { activities: options("activity"), pools: options("pool"), types: options("type") };
}

export interface DonationParams {
  dateA: string; // DD.MM.YYYY
  dateB: string; // DD.MM.YYYY
  types: string; // '1,2,3,4,5'
  activity?: string; // '' | 'all' → filtre yok
  pool?: string;
}

function filterPart(name: string, value: string | undefined): string {
  const v = String(value ?? "").trim();
  return v === "" || v.toLowerCase() === FILTER_ALL ? "" : `&${name}=${v}`;
}

/**
 * Export servisini çağırır; (Bağış Kabul Birimi, Bağış Tutarı) çiftlerini verir.
 * Bağışçıya ait hiçbir kişisel alan okunmaz — yalnızca birim ve tutar.
 */
export async function fetchDonationRows(
  client: NezirClient,
  p: DonationParams,
): Promise<Array<[string, number]>> {
  const path =
    `/crea/donate/donate/export/now?type=${p.types}&date_a=${p.dateA}` +
    `&date=between&date_b=${p.dateB}` +
    `${filterPart("activity", p.activity)}${filterPart("pool", p.pool)}`;
  const text = await client.getReadonly(path, EXPORT_TIMEOUT_MS);
  const rows = parseExportXml(text);
  if (rows.length === 0) return [];

  const header = rows[0];
  const colBirim = header.indexOf("Bağış Kabul Birimi");
  const colTutar = header.indexOf("Bağış Tutarı");
  if (colBirim === -1 || colTutar === -1) {
    throw new RemoteError(`Export sütunları beklenenden farklı: ${header.join(", ")}`);
  }

  const out: Array<[string, number]> = [];
  for (const cells of rows.slice(1)) {
    const birim = colBirim < cells.length ? clean(cells[colBirim]) : "";
    const tutar = exportAmount(colTutar < cells.length ? cells[colTutar] : "");
    out.push([birim, tutar]);
  }
  return out;
}
