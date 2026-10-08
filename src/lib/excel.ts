/**
 * Excel export üreticileri (exceljs). Kurumsal kimlik: Nezir Yeşili başlık,
 * krem şeritli satırlar, kritik değerlerde kehribar.
 */
import ExcelJS from "exceljs";

const GREEN = "FF00764B"; // Nezir Yeşili
const STRIPE = "FFF5F0E8"; // Krem
const AMBER = "FFB95C00"; // kritik metin (kehribar koyusu — okunabilirlik)

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  row.height = 20;
}

function stripe(ws: ExcelJS.Worksheet, startRow: number) {
  for (let i = startRow; i <= ws.rowCount; i++) {
    if ((i - startRow) % 2 === 1) {
      ws.getRow(i).eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STRIPE } };
      });
    }
  }
}

export interface BagisExcelRow {
  bolge: string;
  birim: string | null; // null → bölge özet satırı
  plan: number | null;
  gelir: number;
  adet: number;
}

export async function buildBagisXlsx(
  title: string,
  rows: BagisExcelRow[],
  includePlan: boolean,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Bağış Raporu");
  ws.addRow([title]);
  ws.mergeCells(1, 1, 1, includePlan ? 7 : 5);
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: GREEN } };

  const header = includePlan
    ? ["Sıra", "Bölge", "Birim", "Aylık Plan", "Gerçekleşen", "Oran", "Adet"]
    : ["Sıra", "Bölge", "Birim", "Tutar", "Adet"];
  styleHeader(ws.addRow(header));

  rows.forEach((r, i) => {
    if (includePlan) {
      const oran = r.plan && r.plan > 0 ? r.gelir / r.plan : null;
      ws.addRow([i + 1, r.bolge, r.birim ?? "—", r.plan ?? "", r.gelir, oran ?? "", r.adet]);
    } else {
      ws.addRow([i + 1, r.bolge, r.birim ?? "—", r.gelir, r.adet]);
    }
  });
  stripe(ws, 3);

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 28;
  if (includePlan) {
    ws.getColumn(4).numFmt = '#,##0.00 "₺"';
    ws.getColumn(5).numFmt = '#,##0.00 "₺"';
    ws.getColumn(6).numFmt = "0.0%";
    ws.getColumn(4).width = 16;
    ws.getColumn(5).width = 16;
    ws.getColumn(6).width = 10;
    ws.getColumn(7).width = 8;
  } else {
    ws.getColumn(4).numFmt = '#,##0.00 "₺"';
    ws.getColumn(4).width = 16;
    ws.getColumn(5).width = 8;
  }

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
  ws.mergeCells(1, 1, 1, 8);
  ws.getCell(1, 1).font = { bold: true, size: 13, color: { argb: GREEN } };

  styleHeader(
    ws.addRow([
      "Sıra",
      "Bölge",
      "Birim",
      "Sosyal İnceleme",
      "Gün Aralığı",
      "Koordinatör Kararı",
      "Gün Aralığı",
      "Kritik",
    ]),
  );

  rows.forEach((r, i) => {
    const row = ws.addRow([
      i + 1,
      r.bolge,
      r.birim ?? "—",
      r.siAdet,
      r.siAralik,
      r.bkAdet,
      r.bkAralik,
      r.kritik,
    ]);
    if (r.kritik > 0) {
      row.getCell(8).font = { bold: true, color: { argb: AMBER } };
    }
  });
  stripe(ws, 3);

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 28;
  [4, 5, 6, 7, 8].forEach((c) => (ws.getColumn(c).width = 16));

  return Buffer.from(await wb.xlsx.writeBuffer());
}
