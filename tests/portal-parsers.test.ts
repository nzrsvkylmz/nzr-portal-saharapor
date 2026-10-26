import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { NezirClient } from "@/lib/portal/client";
import { fetchFilterOptions } from "@/lib/portal/donate";
import { fetchPending, fetchUnitList } from "@/lib/portal/relief";
import { buildMaps } from "@/lib/domain/matching";

const filterHtml = readFileSync(
  path.join(__dirname, "fixtures", "filter-sample.html"),
  "utf-8",
);
const exportXml = readFileSync(
  path.join(__dirname, "fixtures", "export-sample.xml"),
  "utf-8",
);

function fakeClient(body: string): NezirClient {
  return { getReadonly: async () => body } as unknown as NezirClient;
}

describe("fetchUnitList (department select parse)", () => {
  it("bölge başlıklarını izleyen birimleri hiyerarşik okur", async () => {
    const units = await fetchUnitList(fakeClient(filterHtml));
    expect(units).toEqual([
      { depId: "4", name: "1.Bölge Müdürlüğü", bolge: "1.BÖLGE" },
      { depId: "29", name: "Malatya", bolge: "1.BÖLGE" },
      { depId: "28", name: "Elazığ", bolge: "1.BÖLGE" },
      { depId: "33", name: "Diyarbakır", bolge: "1.BÖLGE" },
      { depId: "224", name: "Diyarbakır-Kayapınar", bolge: "1.BÖLGE" },
      { depId: "31", name: "Şanlıurfa", bolge: "1.BÖLGE" },
      { depId: "201", name: "Şanlıurfa-Haliliye", bolge: "1.BÖLGE" },
      { depId: "105", name: "18.Bölge Müdürlüğü", bolge: "18.BÖLGE" },
      { depId: "128", name: "Esenyurt", bolge: "18.BÖLGE" },
    ]);
  });

  it("coğrafi olmayan özel birimleri hariç tutar", async () => {
    const units = await fetchUnitList(fakeClient(filterHtml));
    const names = units.map((u) => u.name);
    expect(names).not.toContain("Sosyal Yardımlar Birimi");
    expect(names).not.toContain("Suriye Yardımları Birimi");
  });
});

describe("fetchFilterOptions (bağış filtre panelı)", () => {
  it("activity/pool/type listelerini value'lu okur", async () => {
    const f = await fetchFilterOptions(fakeClient(filterHtml));
    expect(f.activities).toEqual([
      ["1", "Genel Bağış"],
      ["2", "Acil İnsani Yardımlar"],
    ]);
    expect(f.pools[1]).toEqual(["31", "Afganistan"]);
    expect(f.types).toHaveLength(3);
  });
});

describe("fetchPending (yardım başvuru özeti)", () => {
  it("hedef aşamaları süzer, gün hesaplar, birime eşler", async () => {
    const units = await fetchUnitList(fakeClient(filterHtml));
    const maps = buildMaps(units);
    const bugun = new Date(2026, 9, 7); // 07.10.2026
    const { kayitlar, okunan } = await fetchPending(fakeClient(exportXml), maps, bugun);
    expect(okunan).toBe(4);
    expect(kayitlar).toHaveLength(4);
    // Sorumlu Birim dolu (Elazığ): şehir Malatya olsa da birim kazanır
    expect(kayitlar[0]).toEqual({
      bolge: "1.BÖLGE",
      tems: "Elazığ",
      stageKey: "si",
      gun: 92,
      yerlesim: "Battalgazi",
      mahalle: "Hidayet Mah.",
      atanmamis: false,
      tarih: "07.07.2026",
    });
    // Sorumlu Birim boş → il-ilçe ayrıştırması; Mahalle boş → 'Belirtilmemiş'
    expect(kayitlar[1]).toEqual({
      bolge: "18.BÖLGE",
      tems: "Esenyurt",
      stageKey: "bk",
      gun: 6,
      yerlesim: "Esenyurt",
      mahalle: "Belirtilmemiş",
      atanmamis: true,
      tarih: "01.10.2026",
    });
    // Özel birim (Sosyal Yardımlar) → il-ilçe; listede olmayan şehir → EŞLENMEYEN
    expect(kayitlar[2]).toEqual({
      bolge: "EŞLENMEYEN",
      tems: "Ankara",
      stageKey: "od",
      gun: 2,
      yerlesim: "Çankaya",
      mahalle: "Mutlukent Mah.",
      atanmamis: true,
      tarih: "05.10.2026",
    });
    // BM seçili → il-ilçe tercih edilir (Malatya); temsilciliğe atanmamış sayılır
    expect(kayitlar[3]).toEqual({
      bolge: "1.BÖLGE",
      tems: "Malatya",
      stageKey: "kk",
      gun: 7,
      yerlesim: "Yeşilyurt",
      mahalle: "İnönü Mah.",
      atanmamis: true,
      tarih: "30.09.2026",
    });
  });
});
