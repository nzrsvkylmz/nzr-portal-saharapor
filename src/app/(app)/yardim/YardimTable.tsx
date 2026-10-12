"use client";

/**
 * Temsilcilik Detayı tablosu: temsilcilik satırına tıklanınca ilçe (Yerleşim)
 * kırılımı, ilçe satırına tıklanınca mahalle kırılımı açılır. İstanbul
 * bölgelerinde olduğu gibi temsilcilik = ilçe ise mahalleler doğrudan
 * temsilciliğin altında görünür. Tüm sayılar/aralıklar sunucuda hesaplanır;
 * burada yalnız gösterim ve aç-kapa vardır.
 */
import { useState } from "react";

export interface YardimNode {
  label: string; // yerleşim ya da mahalle adı
  siCount: number;
  siRange: string;
  bkCount: number;
  bkRange: string;
  kritik: number;
  children: YardimNode[];
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
  children: YardimNode[];
  /** Saha dashboard'u için: en uzun bekleyen başvurular (gün + yer etiketi). */
  topWaits?: { gun: number; yer: string }[];
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
  // path anahtarı: "unitKey" | "unitKey|yerleşim" — her düzey ayrı aç/kapa
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (k: string, dflt: boolean) => open[k] ?? dflt;
  const toggle = (k: string, dflt: boolean) =>
    setOpen((s) => ({ ...s, [k]: !isOpen(k, dflt) }));

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
          const acik = expandable && isOpen(b.key, defaultOpen);
          const stop = (e: React.MouseEvent) => e.stopPropagation();
          return (
            <FragmentRows
              key={b.key}
              b={b}
              zebra={i % 2 === 1}
              expandable={expandable}
              open={acik}
              onToggle={() => toggle(b.key, defaultOpen)}
              isOpen={isOpen}
              toggle={toggle}
              stop={stop}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function FragmentRows({
  b,
  zebra,
  expandable,
  open,
  onToggle,
  isOpen,
  toggle,
  stop,
}: {
  b: YardimUnitRow;
  zebra: boolean;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
  isOpen: (k: string, dflt: boolean) => boolean;
  toggle: (k: string, dflt: boolean) => void;
  stop: (e: React.MouseEvent) => void;
}) {
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
          <NodeRows
            key={c.label}
            node={c}
            pathKey={`${b.key}|${c.label}`}
            depth={1}
            isOpen={isOpen}
            toggle={toggle}
          />
        ))}
    </>
  );
}

function NodeRows({
  node,
  pathKey,
  depth,
  isOpen,
  toggle,
}: {
  node: YardimNode;
  pathKey: string;
  depth: number;
  isOpen: (k: string, dflt: boolean) => boolean;
  toggle: (k: string, dflt: boolean) => void;
}) {
  const expandable = node.children.length > 0;
  const open = expandable && isOpen(pathKey, false); // alt düzeyler hep kapalı başlar
  const pad = depth === 1 ? "pl-12" : "pl-20";
  const tone = depth === 1 ? "bg-mint/10 text-ink/80" : "bg-mint/5 text-ink/60";
  return (
    <>
      <tr
        className={`${tone} ${expandable ? "cursor-pointer hover:bg-mint/30" : ""}`}
        onClick={expandable ? () => toggle(pathKey, false) : undefined}
      >
        <td className={`px-4 py-1.5 ${pad} text-[13px]`}>
          <span className="flex items-center gap-1.5">
            {expandable && (
              <span className="text-xs text-primary">{open ? "▾" : "▸"}</span>
            )}
            {node.label}
          </span>
        </td>
        <td className="px-4 py-1.5 text-[13px]">{node.siCount || ""}</td>
        <td className="px-4 py-1.5 text-[13px] text-ink/60">{node.siRange}</td>
        <td className="px-4 py-1.5 text-[13px]">{node.bkCount || ""}</td>
        <td className="px-4 py-1.5 text-[13px] text-ink/60">{node.bkRange}</td>
        <td className="px-4 py-1.5 text-[13px]">
          {node.kritik > 0 ? kritikBadge(node.kritik) : ""}
        </td>
        <td className="px-4 py-1.5" />
      </tr>
      {open &&
        node.children.map((c) => (
          <NodeRows
            key={c.label}
            node={c}
            pathKey={`${pathKey}|${c.label}`}
            depth={depth + 1}
            isOpen={isOpen}
            toggle={toggle}
          />
        ))}
    </>
  );
}
