"use client";

/**
 * Birim Dağılımı tablosu: il temsilcilikleri tek satırda (kendi + ilçe
 * bağışları toplanmış), satıra tıklanınca ilçe kırılımı açılır. İlin planı ve
 * oranı bu birleşik toplam üzerinden hesaplanır (hesap sunucuda yapılır,
 * burada yalnız gösterim/aç-kapa vardır).
 */
import { useState } from "react";
import { trMoney } from "@/lib/domain/normalize";

export interface UnitChildRow {
  key: string;
  label: string;
  count: number;
  amount: number;
  plan: number | null;
}

export interface UnitGroupRow {
  key: string;
  bolgeLabel: string;
  label: string;
  count: number;
  amount: number;
  plan: number | null;
  children: UnitChildRow[];
}

function oranBadge(oran: number | null) {
  if (oran === null) return <span className="text-ink/40">—</span>;
  const pct = `%${(oran * 100).toFixed(1).replace(".", ",")}`;
  const cls =
    oran >= 1
      ? "bg-primary/10 text-primary-dark"
      : oran >= 0.6
        ? "bg-mint text-primary-dark"
        : "bg-amber/20 text-amber";
  return <span className={`rounded-full px-2 py-0.5 font-semibold ${cls}`}>{pct}</span>;
}

export default function UnitTable({
  groups,
  planVisible,
  defaultOpen,
}: {
  groups: UnitGroupRow[];
  planVisible: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (k: string) => open[k] ?? defaultOpen;
  const toggle = (k: string) => setOpen((s) => ({ ...s, [k]: !isOpen(k) }));
  const cols = planVisible ? 6 : 4;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-primary text-left text-white">
          <th className="px-4 py-2.5 font-medium">Bölge</th>
          <th className="px-4 py-2.5 font-medium">Birim</th>
          <th className="px-4 py-2.5 font-medium">Bağış Adedi</th>
          <th className="px-4 py-2.5 font-medium">Tutar</th>
          {planVisible && <th className="px-4 py-2.5 font-medium">Aylık Plan</th>}
          {planVisible && <th className="px-4 py-2.5 font-medium">Oran</th>}
        </tr>
      </thead>
      <tbody>
        {groups.length === 0 && (
          <tr>
            <td colSpan={cols} className="px-4 py-6 text-center text-ink/50">
              Bu kapsamda bağış kaydı yok.
            </td>
          </tr>
        )}
        {groups.map((g, i) => {
          const expandable = g.children.length > 0;
          const acik = expandable && isOpen(g.key);
          return (
            <GroupRows
              key={g.key}
              g={g}
              zebra={i % 2 === 1}
              planVisible={planVisible}
              expandable={expandable}
              open={acik}
              onToggle={() => toggle(g.key)}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function GroupRows({
  g,
  zebra,
  planVisible,
  expandable,
  open,
  onToggle,
}: {
  g: UnitGroupRow;
  zebra: boolean;
  planVisible: boolean;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className={`${zebra ? "bg-cream/60" : ""} ${expandable ? "cursor-pointer hover:bg-mint/30" : ""}`}
        onClick={expandable ? onToggle : undefined}
      >
        <td className="px-4 py-2 text-xs text-ink/50">{g.bolgeLabel}</td>
        <td className="px-4 py-2 font-medium">
          {expandable ? (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-primary">{open ? "▾" : "▸"}</span>
              {g.label}
              <span className="text-xs font-normal text-ink/40">
                {g.children.length} kırılım
              </span>
            </span>
          ) : (
            g.label
          )}
        </td>
        <td className="px-4 py-2">{g.count}</td>
        <td className="px-4 py-2">{trMoney(g.amount)}</td>
        {planVisible && (
          <td className="px-4 py-2">{g.plan ? trMoney(g.plan) : "—"}</td>
        )}
        {planVisible && (
          <td className="px-4 py-2">
            {oranBadge(g.plan && g.plan > 0 ? g.amount / g.plan : null)}
          </td>
        )}
      </tr>
      {open &&
        g.children.map((c) => (
          <tr key={c.key} className="bg-mint/10 text-ink/80">
            <td className="px-4 py-1.5" />
            <td className="px-4 py-1.5 pl-9 text-[13px]">{c.label}</td>
            <td className="px-4 py-1.5 text-[13px]">{c.count}</td>
            <td className="px-4 py-1.5 text-[13px]">
              {trMoney(c.amount)}{" "}
              {g.amount > 0 && (
                <span className="text-xs text-ink/40">
                  %{((c.amount / g.amount) * 100).toFixed(1).replace(".", ",")}
                </span>
              )}
            </td>
            {planVisible && (
              <td className="px-4 py-1.5 text-[13px]">
                {c.plan ? trMoney(c.plan) : "—"}
              </td>
            )}
            {planVisible && (
              <td className="px-4 py-1.5">
                {c.plan && c.plan > 0 ? oranBadge(c.amount / c.plan) : ""}
              </td>
            )}
          </tr>
        ))}
    </>
  );
}
