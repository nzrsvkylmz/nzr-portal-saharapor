import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseExportXml, rowsOf } from "@/lib/portal/spreadsheetml";

const xml = readFileSync(path.join(__dirname, "fixtures", "export-sample.xml"), "utf-8");

describe("SpreadsheetML parser", () => {
  it("satırları ve hücreleri çıkarır, ilk satır başlıktır", () => {
    const rows = rowsOf(xml);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(["Başvuru", "Şehir", "Yerleşim", "Aşama"]);
    expect(rows[1]).toEqual(["07.07.2026", "Malatya", "Battalgazi", "Sosyal İnceleme"]);
  });

  it("XML olmayan içerikte RemoteError fırlatır (oturum düşmesi belirtisi)", () => {
    expect(() => parseExportXml("<html><body>login</body></html>")).toThrow();
  });

  it("BOM ve boşluk önekini tolere eder", () => {
    const rows = parseExportXml("﻿\r\n " + xml);
    expect(rows).toHaveLength(4);
  });
});
