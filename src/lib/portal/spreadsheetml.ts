/**
 * SpreadsheetML (Excel 2003 XML) → string[][] dönüştürücü.
 * relief_data.rows_of'un portu; ilk satır başlıktır.
 */
import { XMLParser } from "fast-xml-parser";
import { RemoteError } from "./errors";

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false, // '0300' gibi değerler sayıya dönüşmesin
  trimValues: true,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell !== "object") return String(cell).trim();
  const data = (cell as Record<string, unknown>)["Data"];
  if (data === null || data === undefined) return "";
  if (typeof data !== "object") return String(data).trim();
  const text = (data as Record<string, unknown>)["#text"];
  return text === undefined || text === null ? "" : String(text).trim();
}

/** Ağaçta tüm <Row> düğümlerini (hangi derinlikte olursa olsun) toplar. */
function collectRows(node: unknown, out: unknown[]): void {
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "Row") {
      out.push(...asArray(value));
    } else if (typeof value === "object") {
      for (const child of asArray(value)) collectRows(child, out);
    }
  }
}

export function rowsOf(xmlText: string): string[][] {
  const doc = parser.parse(xmlText);
  const rowNodes: unknown[] = [];
  collectRows(doc, rowNodes);
  const out: string[][] = [];
  for (const row of rowNodes) {
    if (row === null || typeof row !== "object") continue;
    const cells = asArray((row as Record<string, unknown>)["Cell"]).map(cellText);
    if (cells.length) out.push(cells);
  }
  return out;
}

/** Export cevabını doğrulayıp satırlara çevirir. */
export function parseExportXml(text: string): string[][] {
  const t = text.replace(/^[﻿\r\n ]+/, "");
  if (!t.startsWith("<?xml")) {
    throw new RemoteError("Export servisi beklenen XML yerine farklı içerik döndürdü.");
  }
  return rowsOf(t);
}
