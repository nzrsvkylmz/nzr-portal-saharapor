/**
 * Portal kullanıcı hesapları modülü (salt-okunur): kullanıcı listesi +
 * detaylardan kullanıcı adı çekme. Şifre alanı ASLA okunmaz/saklanmaz;
 * yalnız nick, ad, birim ve durum alınır.
 */
import * as cheerio from "cheerio";
import { clean } from "@/lib/domain/normalize";
import type { NezirClient } from "./client";
import { RemoteError } from "./errors";

export interface PortalAccount {
  nick: string; // portal kullanıcı adı (login eşleşme anahtarı)
  displayName: string;
  department: string; // "1.Bölge Müdürlüğü", "Malatya" …
  level: string; // "Bölge Müdürü" vb. (erişim yetkisi)
  active: boolean;
}

/**
 * Verilen filtreyle (ör. {level:"11"} erişim yetkisi, {department:"9"} birim)
 * kullanıcıları çeker. Liste sayfasından detay linkleri toplanır; kullanıcı
 * adı yalnız detayda olduğu için her kayıt için detay sayfası okunur.
 */
export async function fetchAccounts(
  client: NezirClient,
  filter: Record<string, string>,
): Promise<PortalAccount[]> {
  // Liste sayfalıdır (?page=N, sayfalar bir satır bindirmeli olabilir):
  // yeni detay linki gelmeyene dek sayfaları gez, linkleri tekilleştir.
  const seen = new Set<string>();
  for (let page = 1; page <= 50; page++) {
    const qs = new URLSearchParams({ ...filter, page: String(page) }).toString();
    const html = await client.getReadonly(`/crea/definate/admin/admin?${qs}`);
    const $ = cheerio.load(html);
    const before = seen.size;
    $("table tbody tr a").each((_, a) => {
      const href = $(a).attr("href") ?? "";
      if (/\/crea\/definate\/admin\/admin\/detail\/\d+$/.test(href)) {
        seen.add(href);
      }
    });
    if (seen.size === before) break; // yeni kayıt yok → son sayfa geçildi
  }
  const detailPaths = [...seen];
  if (detailPaths.length === 0) {
    throw new RemoteError("Kullanıcı listesinde kayıt bulunamadı (yetki/filtre?).");
  }

  const out: PortalAccount[] = [];
  for (const path of detailPaths) {
    const dhtml = await client.getReadonly(path);
    const $$ = cheerio.load(dhtml);
    const field = (name: string): string =>
      clean(
        $$(`input[name="${name}"]`).attr("value") ??
          $$(`select[name="${name}"] option:selected`).text(),
      );
    const nick = field("nick").toLowerCase();
    if (!nick) continue; // nick'siz kayıt eşlenemez
    out.push({
      nick,
      displayName: field("name"),
      department: field("department"),
      level: field("level"),
      active: field("status") === "Aktif",
    });
  }
  return out;
}
