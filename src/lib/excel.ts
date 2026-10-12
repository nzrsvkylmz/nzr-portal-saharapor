/**
 * Excel export üreticileri (exceljs). Kurumsal kimlik: Nezir Yeşili başlık,
 * krem şeritli satırlar, kritik değerlerde kehribar.
 */
import ExcelJS from "exceljs";

const GREEN = "FF00764B"; // Nezir Yeşili
const AMBER = "FFB95C00"; // kritik metin (kehribar koyusu — okunabilirlik)

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  row.height = 20;
}

export interface BagisExcelRow {
  seviye: "bolge" | "il" | "ilce";
  bolge: string;
  birim: string | null; // bölge özet satırında null
  plan: number | null; // aylık plan (seçili aralık toplamı)
  gelir: number; // il satırında ilçeler dahil birleşik toplam
  adet: number;
}

const MINT = "FFC8EDD9"; // Filiz — bölge özet satırı zemini

export async function buildBagisXlsx(
  title: string,
  rows: BagisExcelRow[],
  includePlan: boolean,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bağış Raporu");
  const colCount = includePlan ? 6 : 4;
  ws.addRow([title]);
  ws.mergeCells(1, 1, 1, colCount);
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: GREEN } };

  const header = includePlan
    ? ["Bölge", "Birim", "Aylık Plan", "Gerçekleşen", "Oran", "Adet"]
    : ["Bölge", "Birim", "Tutar", "Adet"];
  styleHeader(ws.addRow(header));

  for (const r of rows) {
    const birimText =
      r.seviye === "bolge"
        ? "BÖLGE TOPLAMI"
        : r.seviye === "il"
          ? (r.birim ?? "—")
          : `    └ ${r.birim ?? "—"}`;
    const oran = r.plan && r.plan > 0 ? r.gelir / r.plan : null;
    const row = includePlan
      ? ws.addRow([r.bolge, birimText, r.plan ?? "", r.gelir, oran ?? "", r.adet])
      : ws.addRow([r.bolge, birimText, r.gelir, r.adet]);

    if (r.seviye === "bolge") {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MINT } };
        cell.font = { bold: true, color: { argb: "FF004D32" } };
      });
    } else if (r.seviye === "il") {
      row.getCell(2).font = { bold: true };
    } else {
      row.eachCell((cell) => {
        cell.font = { color: { argb: "FF5A6660" } };
      });
    }
  }

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 34;
  if (includePlan) {
    ws.getColumn(3).numFmt = '#,##0.00 "₺"';
    ws.getColumn(4).numFmt = '#,##0.00 "₺"';
    ws.getColumn(5).numFmt = "0.0%";
    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 16;
    ws.getColumn(5).width = 10;
    ws.getColumn(6).width = 8;
  } else {
    ws.getColumn(3).numFmt = '#,##0.00 "₺"';
    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 8;
  }
  ws.views = [{ state: "frozen", ySplit: 2 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface YardimExcelRow {
  bolge: string;
  birim: string | null;
  siAdet: number;
  siAralik: string;
  bkAdet: number;
  bkAralik: string;
  kritik: number;
}

export async function buildYardimXlsx(
  title: string,
  rows: YardimExcelRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Yardım Raporu");
  ws.addRow([title]);
  ws.mergeCells(1, 1, 1, 7);
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: GREEN } };

  styleHeader(
    ws.addRow([
      "Bölge",
      "Birim",
      "Sosyal İnceleme",
      "Gün Aralığı",
      "Koordinatör Kararı",
      "Gün Aralığı",
      "Kritik",
    ]),
  );

  for (const r of rows) {
    const bolgeSatiri = r.birim === null;
    const row = ws.addRow([
      r.bolge,
      bolgeSatiri ? "BÖLGE TOPLAMI" : r.birim,
      r.siAdet,
      r.siAralik,
      r.bkAdet,
      r.bkAralik,
      r.kritik,
    ]);
    if (bolgeSatiri) {
      // bölge özet satırı: mint zemin + koyu yeşil kalın yazı
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MINT } };
        cell.font = { bold: true, color: { argb: "FF004D32" } };
      });
    }
    if (r.kritik > 0) {
      row.getCell(7).font = {
        bold: true,
        color: { argb: AMBER },
      };
    }
  }

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 30;
  [3, 4, 5, 6, 7].forEach((c) => (ws.getColumn(c).width = 16));
  ws.views = [{ state: "frozen", ySplit: 2 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}
