import { describe, expect, it } from "vitest";
import {
  buildMaps,
  eslestir,
  eslestirSorumluBirim,
  matchDonationUnit,
  UNMATCHED,
  type UnitTriple,
} from "@/lib/domain/matching";

const units: UnitTriple[] = [
  { depId: "4", name: "1.Bölge Müdürlüğü", bolge: "1.BÖLGE" },
  { depId: "29", name: "Malatya", bolge: "1.BÖLGE" },
  { depId: "28", name: "Elazığ", bolge: "1.BÖLGE" },
  { depId: "33", name: "Diyarbakır", bolge: "1.BÖLGE" },
  { depId: "224", name: "Diyarbakır-Kayapınar", bolge: "1.BÖLGE" },
  { depId: "31", name: "Şanlıurfa", bolge: "1.BÖLGE" },
  { depId: "201", name: "Şanlıurfa-Haliliye", bolge: "1.BÖLGE" },
  { depId: "105", name: "18.Bölge Müdürlüğü", bolge: "18.BÖLGE" },
  { depId: "128", name: "Esenyurt", bolge: "18.BÖLGE" },
];

const maps = buildMaps(units);

describe("eslestir (relief_data.eslestir eşleniği)", () => {
  it("tek birimli şehir doğrudan eşleşir", () => {
    expect(eslestir(maps, "Malatya", "Battalgazi")).toEqual(["1.BÖLGE", "Malatya"]);
  });
  it("çok birimli şehirde ilçe son ekiyle ayrışır", () => {
    expect(eslestir(maps, "Diyarbakır", "Kayapınar")).toEqual([
      "1.BÖLGE",
      "Diyarbakır-Kayapınar",
    ]);
    expect(eslestir(maps, "Şanlıurfa", "Haliliye")).toEqual([
      "1.BÖLGE",
      "Şanlıurfa-Haliliye",
    ]);
  });
  it("çok birimli şehirde eşleşmeyen ilçe şehir birimine düşer", () => {
    expect(eslestir(maps, "Diyarbakır", "Sur")).toEqual(["1.BÖLGE", "Diyarbakır"]);
  });
  it("İstanbul ilçe üzerinden eşleşir", () => {
    expect(eslestir(maps, "İstanbul", "Esenyurt")).toEqual(["18.BÖLGE", "Esenyurt"]);
    expect(eslestir(maps, "İstanbul", "Bilinmeyen")[0]).toBe(UNMATCHED);
  });
  it("hiç eşleşmeyen şehir EŞLENMEYEN olur", () => {
    expect(eslestir(maps, "Hakkari", "")[0]).toBe(UNMATCHED);
  });
});

describe("eslestirSorumluBirim (yardım export 'Sorumlu Birim' sütunu)", () => {
  it("birim adını tam ad üzerinden çözer (büyük/küçük harf dahil)", () => {
    expect(eslestirSorumluBirim(maps, "Diyarbakır-Kayapınar")).toEqual({
      bolge: "1.BÖLGE",
      unit: "Diyarbakır-Kayapınar",
      isBM: false,
    });
    expect(eslestirSorumluBirim(maps, "MALATYA")?.unit).toBe("Malatya");
  });
  it("boş metin ve özel birimler null döner (il-ilçe yoluna düşülür)", () => {
    expect(eslestirSorumluBirim(maps, "")).toBeNull();
    expect(eslestirSorumluBirim(maps, "  ")).toBeNull();
    expect(eslestirSorumluBirim(maps, "Sosyal Yardımlar Birimi")).toBeNull();
    expect(eslestirSorumluBirim(maps, "Suriye Yardımları Birimi")).toBeNull();
  });
  it("tanınmayan birim adı null döner", () => {
    expect(eslestirSorumluBirim(maps, "Yeni Açılan Birim")).toBeNull();
  });
  it("bölge müdürlüğü seçimi isBM ile işaretlenir", () => {
    expect(eslestirSorumluBirim(maps, "1.Bölge Müdürlüğü")).toEqual({
      bolge: "1.BÖLGE",
      unit: "1.Bölge Müdürlüğü",
      isBM: true,
    });
  });
  it("'BM / birim' biçiminde birim kısmı esas alınır", () => {
    expect(eslestirSorumluBirim(maps, "1.Bölge Müdürlüğü / Malatya")?.unit).toBe(
      "Malatya",
    );
  });
  it("zenginleştirilmiş haritadaki (yardım listesi dışı) birim de çözülür", () => {
    const m2 = buildMaps(units);
    m2.name2unit["kırklareli"] = ["Kırklareli", "17.BÖLGE"];
    expect(eslestirSorumluBirim(m2, "Kırklareli")).toEqual({
      bolge: "17.BÖLGE",
      unit: "Kırklareli",
      isBM: false,
    });
  });
});

describe("matchDonationUnit (bağış kabul birimi → bölge+birim)", () => {
  it("'N. Bölge Müdürlüğü / Şehir' biçimini çözer", () => {
    expect(matchDonationUnit(maps, "1. Bölge Müdürlüğü / Malatya")).toEqual({
      bolgeLabel: "1.BÖLGE",
      unitName: "Malatya",
      matched: true,
    });
  });
  it("yalın bölge müdürlüğü merkez kabul sayılır", () => {
    expect(matchDonationUnit(maps, "1.Bölge Müdürlüğü")).toEqual({
      bolgeLabel: "1.BÖLGE",
      unitName: null,
      matched: true,
    });
  });
  it("çıplak birim adı eşleşir", () => {
    expect(matchDonationUnit(maps, "Şanlıurfa-Haliliye")).toEqual({
      bolgeLabel: "1.BÖLGE",
      unitName: "Şanlıurfa-Haliliye",
      matched: true,
    });
    expect(matchDonationUnit(maps, "Kayapınar").unitName).toBe("Diyarbakır-Kayapınar");
  });
  it("boş birim BELİRTİLMEMİŞ, eşleşmeyen dolu metin DİĞER", () => {
    expect(matchDonationUnit(maps, "").bolgeLabel).toBe("BELİRTİLMEMİŞ");
    expect(matchDonationUnit(maps, "Yurtdışı Ofisi").bolgeLabel).toBe("DİĞER");
  });
  it("bölge önekli ama tanınmayan birim bölgesinde kalır", () => {
    const m = matchDonationUnit(maps, "1. Bölge Müdürlüğü / Yeni Birim");
    expect(m.bolgeLabel).toBe("1.BÖLGE");
    expect(m.matched).toBe(false);
  });
});
