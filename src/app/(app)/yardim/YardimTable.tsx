"use client";

/**
 * Temsilcilik Detayı tablosu: temsilcilik satırına tıklanınca o temsilciliğe
 * eşlenen başvuruların ilçe (Yerleşim) kırılımı açılır. Tüm sayılar/aralıklar
 * sunucuda hesaplanır; burada yalnız gösterim ve aç-kapa vardır.
 */
import { useState } from "react";

export interface YardimChildRow {
  label: string; // yerleşim adı
  siCount: number;
  siRange: string;
  bkCount: number;
  bkRange: string;
  kritik: number;
}

export interface YardimUnitRow {
  key: string;
  bolge: string;
  tems: string;
  siCount: number;
  siRange: string;
  bkCount: number;
  bkRange: string;
  kritik: number;
  portalAllUrl: string | null;
  portalKritikUrl: string | null;
  children: YardimChildRow[];
}

function kritikBadge(n: number) {
  return n > 0 ? (
    <span className="rounded-full bg-amber/20 px-2 py-0.5 font-semibold text-amber">
      {n}
    </span>
  ) : (
    <span className="text-ink/40">0</span>
  );
}

export default function YardimTable({
  rows,
  defaultOpen,
}: {
  rows: YardimUnitRow[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (k: string) => open[k] ?? defaultOpen;
  const toggle = (k: string) => setOpen((s) => ({ ...s, [k]: !isOpen(k) }));

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-primary text-left text-white">
          <th className="px-4 py-2.5 font-medium">Bölge / Temsilcilik</th>
          <th className="px-4 py-2.5 font-medium">Sosyal İnceleme</th>
          <th className="px-4 py-2.5 font-medium">Gün Aralığı</th>
          <th className="px-4 py-2.5 font-medium">Koordinatör Kararı</th>
          <th className="px-4 py-2.5 font-medium">Gün Aralığı</th>
          <th className="px-4 py-2.5 font-medium">Kritik</th>
          <th className="px-4 py-2.5 font-medium">Portal</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={7} className="px-4 py-6 text-center text-ink/50">
              Bu kapsamda bekleyen başvuru yok.
            </td>
          </tr>
        )}
        {rows.map((b, i) => {
          const expandable = b.children.length > 0;
          const acik = expandable && isOpen(b.key);
          return (
            <Rows
              key={b.key}
              b={b}
              zebra={i % 2 === 1}
              expandable={expandable}
              open={acik}
              onToggle={() => toggle(b.key)}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function Rows({
  b,
  zebra,
  expandable,
  open,
  onToggle,
}: {
  b: YardimUnitRow;
  zebra: boolean;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <>
      <tr
        className={`${zebra ? "bg-cream/60" : ""} ${expandable ? "cursor-pointer hover:bg-mint/30" : ""}`}
        onClick={expandable ? onToggle : undefined}
      >
        <td className="px-4 py-2">
          <span className="flex items-center gap-1.5">
            {expandable && (
              <span className="text-xs text-primary">{open ? "▾" : "▸"}</span>
            )}
            <span className="text-xs text-ink/50">{b.bolge}</span>{" "}
            <span className="font-medium">{b.tems}</span>
          </span>
        </td>
        <td className="px-4 py-2">{b.siCount}</td>
        <td className="px-4 py-2 text-ink/70">{b.siRange}</td>
        <td className="px-4 py-2">{b.bkCount}</td>
        <td className="px-4 py-2 text-ink/70">{b.bkRange}</td>
        <td className="px-4 py-2">
          {b.kritik > 0 && b.portalKritikUrl ? (
            <a
              href={b.portalKritikUrl}
              target="_blank"
              onClick={stop}
              className="rounded-full bg-amber/20 px-2 py-0.5 font-semibold text-amber hover:bg-amber/30"
              title="Kritik dosyaları portalda aç"
            >
              {b.kritik} ↗
            </a>
          ) : (
            kritikBadge(b.kritik)
          )}
        </td>
        <td className="px-4 py-2">
          {b.portalAllUrl ? (
            <a
              href={b.portalAllUrl}
              target="_blank"
              onClick={stop}
              className="text-primary hover:underline"
            >
              Aç ↗
            </a>
          ) : (
            <span className="text-ink/30">—</span>
          )}
        </td>
      </tr>
      {open &&
        b.children.map((c) => (
          <tr key={c.label} className="bg-mint/10 text-ink/80">
            <td className="px-4 py-1.5 pl-12 text-[13px]">{c.label}</td>
            <td className="px-4 py-1.5 text-[13px]">{c.siCount || ""}</td>
            <td className="px-4 py-1.5 text-[13px] text-ink/60">{c.siRange}</td>
            <td className="px-4 py-1.5 text-[13px]">{c.bkCount || ""}</td>
            <td className="px-4 py-1.5 text-[13px] text-ink/60">{c.bkRange}</td>
            <td className="px-4 py-1.5 text-[13px]">
              {c.kritik > 0 ? kritikBadge(c.kritik) : ""}
            </td>
            <td className="px-4 py-1.5" />
          </tr>
        ))}
    </>
  );
}
