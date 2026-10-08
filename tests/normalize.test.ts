import { describe, expect, it } from "vitest";
import {
  daysBetween,
  norm,
  parseAmount,
  parseTrDate,
  toTrDate,
} from "@/lib/domain/normalize";

describe("norm (TR normalizasyon — Python relief_data.norm eşleniği)", () => {
  it("İ→i ve I→ı dönüşümünü locale'den bağımsız yapar", () => {
    expect(norm("İSTANBUL")).toBe("istanbul");
    expect(norm("Iğdır")).toBe("ığdır");
    expect(norm("DİYARBAKIR")).toBe("diyarbakır");
    expect(norm("  Şanlıurfa ")).toBe("şanlıurfa");
    expect(norm(null)).toBe("");
  });
});

describe("parseAmount (Python donate_parser.parse_amount eşleniği)", () => {
  it("TR biçimlerini çözer", () => {
    expect(parseAmount("₺1.234,56")).toBe(1234.56);
    expect(parseAmount("1.234,56 TL")).toBe(1234.56);
    expect(parseAmount("1234,56")).toBe(1234.56);
    expect(parseAmount("1.234.567")).toBe(1234567);
  });
  it("tek noktada 3 haneli kuyruğu binlik sayar", () => {
    expect(parseAmount("1.234")).toBe(1234);
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("1234.56")).toBe(1234.56);
  });
  it("düz sayı ve geçersiz girdiler", () => {
    expect(parseAmount("300")).toBe(300);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });
});

describe("tarih yardımcıları", () => {
  it("DD.MM.YYYY çözümü ve gün farkı", () => {
    const d = parseTrDate("07.07.2026");
    expect(d).not.toBeNull();
    expect(toTrDate(d!)).toBe("07.07.2026");
    expect(daysBetween(new Date(2026, 9, 7), d!)).toBe(92);
    expect(parseTrDate("2026-10-07")).toBeNull();
  });
});
