/**
 * Gerçek portal kimliğiyle salt-okunur duman testi (lokal, manuel).
 * Kullanım: npm run smoke:portal
 * Kimlik bilgileri etkileşimli sorulur; hiçbir yere YAZILMAZ.
 */
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { NezirClient } from "../src/lib/portal/client";
import { fetchUnitList, fetchPending, DEFAULT_FLOW } from "../src/lib/portal/relief";
import { fetchFilterOptions, fetchDonationRows } from "../src/lib/portal/donate";
import { buildMaps, matchDonationUnit } from "../src/lib/domain/matching";
import { toTrDate } from "../src/lib/domain/normalize";

const rl = readline.createInterface({ input: stdin, output: stdout });

async function main() {
  const nick = await rl.question("Portal kullanıcı adı: ");
  const pass = await rl.question("Şifre: ");

  const client = new NezirClient();
  console.log("→ login...");
  let state: string = await client.login(nick.trim(), pass);
  console.log("  durum:", state);

  if (state === "verify") {
    const otp = await rl.question("OTP kodu (SMS): ");
    state = await client.verify(otp.trim());
    console.log("  durum:", state);
  }

  console.log("→ birim listesi...");
  const units = await fetchUnitList(client);
  const maps = buildMaps(units);
  console.log(`  ${units.length} birim, ${maps.bolgeler.length} bölge`);
  console.log("  ilk 5:", units.slice(0, 5));

  console.log("→ bağış filtre seçenekleri...");
  const filters = await fetchFilterOptions(client);
  console.log(
    `  faaliyet: ${filters.activities.length}, fon: ${filters.pools.length}, tür: ${filters.types.length}`,
  );

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 86400_000);
  console.log(`→ bağış export (${toTrDate(weekAgo)} – ${toTrDate(today)})...`);
  const rows = await fetchDonationRows(client, {
    dateA: toTrDate(weekAgo),
    dateB: toTrDate(today),
    types: "1,2,3,4,5",
    activity: "all",
  });
  let total = 0;
  const byBolge = new Map<string, { adet: number; gelir: number }>();
  for (const [birim, tutar] of rows) {
    total += tutar;
    const m = matchDonationUnit(maps, birim);
    const g = byBolge.get(m.bolgeLabel) ?? { adet: 0, gelir: 0 };
    g.adet += 1;
    g.gelir += tutar;
    byBolge.set(m.bolgeLabel, g);
  }
  console.log(`  ${rows.length} bağış, toplam ₺${total.toFixed(2)}`);
  console.log("  bölge dağılımı:", Object.fromEntries(byBolge));

  console.log(`→ yardım export (flow=${DEFAULT_FLOW})... (~25 sn sürebilir)`);
  const { kayitlar, okunan } = await fetchPending(client, maps, today);
  console.log(`  ${okunan} satır okundu, ${kayitlar.length} hedef aşamada`);
  const stages = new Map<string, number>();
  for (const k of kayitlar) stages.set(k.stageKey, (stages.get(k.stageKey) ?? 0) + 1);
  console.log("  aşama dağılımı:", Object.fromEntries(stages));

  console.log("✔ duman testi tamam");
}

main()
  .catch((err) => {
    console.error("✖ HATA:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
