/**
 * Portal departman (bağış kabul birimi) ağacı — salt-okunur. Tam liste,
 * kullanıcı hesapları modülündeki birim seçim listesinden okunur (tek istek,
 * ~1050 kayıt). Yalnız coğrafi birimler alınır: "N.Bölge Müdürlüğü" ve
 * "N.Bölge Müdürlüğü / Birim". Merkez birimleri (Genel Müdür, Bilgi İşlem…)
 * kapsam dışıdır.
 */
import * as cheerio from "cheerio";
import { clean } from "@/lib/domain/normalize";
import type { NezirClient } from "./client";
import { RemoteError } from "./errors";

export interface DeptEntry {
  depId: string;
  name: string; // "Şanlıurfa-Akçakale" (bölge öneksiz çıplak ad)
  bolgeNo: number;
  bolgeLabel: string; // "1.BÖLGE"
  isBolgeMudurlugu: boolean;
}

export async function fetchDepartments(client: NezirClient): Promise<DeptEntry[]> {
  // department select'i kullanıcı listesi filtresinde yoksa ilk kullanıcı
  // detayından okunur (her ikisi de tam ağacı içerir)
  let html = await client.getReadonly("/crea/definate/admin/admin");
  let $ = cheerio.load(html);
  let opts = $('select[name="department"] option');
  if (opts.length === 0) {
    const firstDetail = $('a[href*="/crea/definate/admin/admin/detail/"]')
      .first()
      .attr("href");
    if (!firstDetail) {
      throw new RemoteError("Departman listesi için kullanıcı detayı bulunamadı.");
    }
    html = await client.getReadonly(firstDetail);
    $ = cheerio.load(html);
    opts = $('select[name="department"] option');
  }
  if (opts.length === 0) {
    throw new RemoteError("Departman seçim listesi bulunamadı.");
  }

  const byDepId = new Map<string, DeptEntry>();
  opts.each((_, o) => {
    const depId = ($(o).attr("value") ?? "").trim();
    const label = clean($(o).text());
    if (!depId || !label) return;
    const m = /^(\d+)\s*\.\s*Bölge Müdürlüğü(?:\s*\/\s*(.+))?$/.exec(label);
    if (!m) return; // coğrafi olmayan merkez birimi
    const bolgeNo = Number(m[1]);
    byDepId.set(depId, {
      depId,
      name: m[2]?.trim() ?? `${bolgeNo}.Bölge Müdürlüğü`,
      bolgeNo,
      bolgeLabel: `${bolgeNo}.BÖLGE`,
      isBolgeMudurlugu: !m[2],
    });
  });
  if (byDepId.size === 0) {
    throw new RemoteError("Departman listesinde bölge birimi bulunamadı.");
  }
  return [...byDepId.values()];
}
