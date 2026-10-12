"use client";

/**
 * Saha (bölge müdürü / temsilci) bağış dashboard'u: KPI kartları, aylık
 * gelişim sütun grafiği (plan işaretli), pay donut'u, hedef gerçekleşme
 * sıralaması, il temsilciliği kartları ve modal detay (aylık mini grafik +
 * ilçe kırılımı). Tüm sayılar sunucuda hesaplanır. Mobil öncelikli.
 */
import { useEffect, useState } from "react";
import { trMoney } from "@/lib/domain/normalize";

export interface BagisDashChild {
  label: string;
  amount: number;
  count: number;
  plan: number | null;
}

export interface BagisDashUnit {
  key: string;
  label: string;
  bolgeLabel: string;
  amount: number; // seçili ay aralığı
  count: number;
  plan: number | null;
  children: BagisDashChild[];
  monthly: { ay: string; amount: number; plan: number }[];
}

export interface MonthPoint {
  ay: string; // '2026-03'
  amount: number;
  plan: number;
}

// Tema-sadık vurgu paleti (kehribar yalnız düşük-oran uyarısında)
const ACCENTS = [
  { main: "#00764b", soft: "#e2f3ea", grad: "linear-gradient(135deg,#00764b,#2f9e77)" },
  { main: "#004d32", soft: "#dcebe3", grad: "linear-gradient(135deg,#004d32,#00764b)" },
  { main: "#b99961", soft: "#f3ecdf", grad: "linear-gradient(135deg,#b99961,#d4b98a)" },
  { main: "#2f9e77", soft: "#e3f4ed", grad: "linear-gradient(135deg,#2f9e77,#6cc3a1)" },
  { main: "#3d7a68", soft: "#e4efeb", grad: "linear-gradient(135deg,#3d7a68,#5aa88f)" },
];
const accentOf = (i: number) => ACCENTS[i % ACCENTS.length];

const AY_KISA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const ayAd = (ym: string) => {
  const m = Number(ym.slice(5, 7));
  return AY_KISA[m - 1] ?? ym;
};

/** ₺ kompakt gösterim: 1.234.567 → ₺1,2M; 45.600 → ₺46k */
function kompakt(v: number): string {
  if (v >= 1_000_000) return `₺${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (v >= 1_000) return `₺${Math.round(v / 1_000)}k`;
  return `₺${Math.round(v)}`;
}

function oranRenk(oran: number | null) {
  if (oran === null) return { fg: "#2d3a35", bg: "#f5f0e8" };
  if (oran >= 1) return { fg: "#00764b", bg: "#e2f3ea" };
  if (oran >= 0.6) return { fg: "#b99961", bg: "#f3ecdf" };
  return { fg: "#e8a838", bg: "#faeedb" };
}

function pct(oran: number | null): string {
  if (oran === null) return "—";
  return `%${(oran * 100).toFixed(1).replace(".", ",")}`;
}

// ---- ikonlar ----
const I = {
  pin: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  coins: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="m16.71 13.88.7.71-2.82 2.82" />
    </svg>
  ),
  hash: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </svg>
  ),
  target: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  trend: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  ),
  doc: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M15 2v5h5" />
    </svg>
  ),
  x: (c = "currentColor") => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
};

// ---- grafikler ----

/** Aylık gelişim: gerçekleşen sütunları + plan işaretleri (gold çizgi). */
function MonthlyChart({ data }: { data: MonthPoint[] }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.amount, d.plan)));
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5 sm:gap-2">
        {data.map((d) => {
          const hA = (d.amount / max) * 100;
          const hP = (d.plan / max) * 100;
          const ok = d.plan > 0 && d.amount >= d.plan;
          return (
            <div key={d.ay} className="group relative flex min-w-0 flex-1 flex-col items-center justify-end gap-1 self-stretch">
              <span className="hidden text-[10px] font-semibold text-ink/70 sm:block">
                {d.amount > 0 ? kompakt(d.amount) : ""}
              </span>
              <div className="relative flex w-full max-w-10 flex-1 items-end">
                <div
                  className="w-full rounded-t-md"
                  style={{
                    height: `${Math.max(d.amount > 0 ? 4 : 0, hA)}%`,
                    background: ok
                      ? "linear-gradient(180deg,#2f9e77,#00764b)"
                      : "linear-gradient(180deg,#8fcbb2,#4d9e7e)",
                  }}
                />
                {d.plan > 0 && (
                  <div
                    className="absolute left-0 right-0"
                    style={{
                      bottom: `${hP}%`,
                      borderTop: "2px dashed #b99961",
                    }}
                    title={`Plan: ${trMoney(d.plan)}`}
                  />
                )}
              </div>
              <span className="text-[10px] text-ink/60">{ayAd(d.ay)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 flex items-center gap-3 text-[11px] text-ink/50">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm" style={{ background: "#00764b" }} /> Gerçekleşen
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 border-t-2 border-dashed" style={{ borderColor: "#b99961" }} /> Plan
        </span>
      </p>
    </div>
  );
}

/** Pay dağılımı donut'u: en büyük 4 dilim + Diğer. */
function ShareDonut({ parts }: { parts: { label: string; value: number }[] }) {
  const sorted = [...parts].filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 4);
  const digerVal = sorted.slice(4).reduce((s, p) => s + p.value, 0);
  const dilimler = digerVal > 0 ? [...top, { label: "Diğer", value: digerVal }] : top;
  const total = dilimler.reduce((s, p) => s + p.value, 0);
  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 140 140" className="h-32 w-32 shrink-0">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#e7e2d7" strokeWidth="16" />
        {total > 0 &&
          dilimler.map((p, i) => {
            const frac = p.value / total;
            const el = (
              <circle
                key={p.label}
                cx="70"
                cy="70"
                r={R}
                fill="none"
                stroke={p.label === "Diğer" ? "#cfc7b6" : accentOf(i).main}
                strokeWidth="16"
                strokeDasharray={`${frac * C} ${C}`}
                transform={`rotate(${-90 + offset * 360} 70 70)`}
              />
            );
            offset += frac;
            return el;
          })}
        <text x="70" y="66" textAnchor="middle" className="fill-primary-dark" fontSize="18" fontWeight="700">
          {kompakt(total)}
        </text>
        <text x="70" y="86" textAnchor="middle" fill="#2d3a35" opacity="0.55" fontSize="10">
          toplam
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {dilimler.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: p.label === "Diğer" ? "#cfc7b6" : accentOf(i).main }}
            />
            <span className="min-w-0 flex-1 truncate text-ink/75">{p.label}</span>
            <span className="shrink-0 font-semibold text-ink/80">
              %{total ? ((p.value / total) * 100).toFixed(0) : 0}
            </span>
          </li>
        ))}
        {dilimler.length === 0 && <li className="text-ink/50">Bu aralıkta bağış yok.</li>}
      </ul>
    </div>
  );
}

/** Hedef gerçekleşme sıralaması: orana göre yatay barlar. */
function GoalBars({ units }: { units: BagisDashUnit[] }) {
  const rows = units
    .map((u) => ({
      label: u.label,
      amount: u.amount,
      oran: u.plan && u.plan > 0 ? u.amount / u.plan : null,
    }))
    .sort((a, b) => (b.oran ?? -1) - (a.oran ?? -1))
    .slice(0, 8);
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const renk = oranRenk(r.oran);
        const w = r.oran === null ? 0 : Math.min(100, r.oran * 100);
        return (
          <div key={r.label} className="text-sm">
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-ink/75">{r.label}</span>
              <span className="shrink-0 text-[11px] font-bold" style={{ color: renk.fg }}>
                {pct(r.oran)}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-cream">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(r.oran !== null ? 3 : 0, w)}%`,
                  background:
                    r.oran !== null && r.oran >= 1
                      ? "linear-gradient(90deg,#00764b,#2f9e77)"
                      : r.oran !== null && r.oran >= 0.6
                        ? "linear-gradient(90deg,#b99961,#d4b98a)"
                        : "linear-gradient(90deg,#e8a838,#f0c269)",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- kartlar ----

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone: "green" | "deep" | "gold" | "oran";
}) {
  const tones = {
    green: { chip: "#e2f3ea", icon: "#00764b", blob: "rgba(0,118,75,.08)" },
    deep: { chip: "#dcebe3", icon: "#004d32", blob: "rgba(0,77,50,.08)" },
    gold: { chip: "#f3ecdf", icon: "#b99961", blob: "rgba(185,153,97,.12)" },
    oran: { chip: "#e2f3ea", icon: "#00764b", blob: "rgba(0,118,75,.08)" },
  }[tone];
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full"
        style={{ background: tones.blob }}
      />
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: tones.chip, color: tones.icon }}
        >
          {icon}
        </span>
        <p className="text-xs font-medium text-ink/60">{label}</p>
      </div>
      <p className="mt-2 break-words text-2xl font-bold sm:text-3xl" style={{ color: tones.icon }}>
        {value}
      </p>
      {sub && <div className="mt-1 text-[11px] text-ink/50">{sub}</div>}
    </div>
  );
}

function UnitCard({ u, i, onDetail }: { u: BagisDashUnit; i: number; onDetail: () => void }) {
  const a = accentOf(i);
  const oran = u.plan && u.plan > 0 ? u.amount / u.plan : null;
  const renk = oranRenk(oran);
  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm transition hover:shadow-md"
      style={{ borderTop: `4px solid ${a.main}` }}
    >
      <button onClick={onDetail} className="flex-1 p-4 text-left sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: a.soft, color: a.main }}
            >
              {I.pin()}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-heading text-[15px] font-semibold text-ink">
                {u.label}
              </span>
              <span className="text-[11px] text-ink/50">{u.bolgeLabel}</span>
            </span>
          </span>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-xs font-bold"
            style={{ color: renk.fg, background: renk.bg }}
          >
            {pct(oran)}
          </span>
        </div>

        <p className="mt-3">
          <span className="break-all text-2xl font-bold" style={{ color: a.main }}>
            {trMoney(u.amount)}
          </span>
        </p>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink/60">
          <span>
            Plan: <strong className="text-ink/80">{u.plan ? trMoney(u.plan) : "—"}</strong>
          </span>
          <span>
            Adet: <strong className="text-ink/80">{u.count}</strong>
          </span>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream">
          <div
            className="h-full rounded-full"
            style={{
              width: `${oran === null ? 0 : Math.min(100, Math.max(3, oran * 100))}%`,
              background:
                oran !== null && oran >= 1
                  ? "linear-gradient(90deg,#00764b,#2f9e77)"
                  : oran !== null && oran >= 0.6
                    ? "linear-gradient(90deg,#b99961,#d4b98a)"
                    : "linear-gradient(90deg,#e8a838,#f0c269)",
            }}
          />
        </div>
      </button>

      <div className="flex items-center justify-between border-t border-cream px-4 py-2.5 sm:px-5">
        <button onClick={onDetail} className="text-xs font-semibold" style={{ color: a.main }}>
          Detayları gör →
        </button>
        {u.children.length > 0 && (
          <span className="text-[11px] text-ink/45">{u.children.length} kırılım</span>
        )}
      </div>
    </div>
  );
}

// ---- modal ----

function UnitModal({
  u,
  accent,
  onClose,
}: {
  u: BagisDashUnit;
  accent: { main: string; soft: string; grad: string };
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  const oran = u.plan && u.plan > 0 ? u.amount / u.plan : null;
  const aylik = u.monthly.filter((m) => m.amount > 0 || m.plan > 0);
  const maxChild = Math.max(1, ...u.children.map((c) => c.amount));
  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="h-[100dvh] w-full max-w-lg overflow-y-auto bg-white shadow-xl sm:h-auto sm:max-h-[85vh] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 px-5 pb-4 pt-5 text-white" style={{ background: accent.grad }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
                {I.pin("white")}
              </span>
              <div>
                <h3 className="font-heading text-lg font-bold leading-tight">{u.label}</h3>
                <p className="text-xs text-white/80">{u.bolgeLabel}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Kapat"
              className="rounded-full bg-white/20 p-1.5 transition hover:bg-white/30"
            >
              {I.x("white")}
            </button>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/15 px-1 py-2">
              <p className="break-all text-sm font-bold sm:text-base">{trMoney(u.amount)}</p>
              <p className="text-[10px] uppercase tracking-wide text-white/80">Gerçekleşen</p>
            </div>
            <div className="rounded-xl bg-white/15 px-1 py-2">
              <p className="break-all text-sm font-bold sm:text-base">
                {u.plan ? trMoney(u.plan) : "—"}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-white/80">Plan</p>
            </div>
            <div className="rounded-xl bg-white/15 px-1 py-2">
              <p className="text-sm font-bold sm:text-base">{pct(oran)}</p>
              <p className="text-[10px] uppercase tracking-wide text-white/80">Oran</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          {aylik.length > 1 && (
            <section>
              <h4 className="mb-3 flex items-center gap-2 font-heading text-sm font-semibold text-ink/80">
                {I.trend("#00764b")} Aylık gelişim
              </h4>
              <MonthlyChart data={aylik} />
            </section>
          )}

          {u.children.length > 0 && (
            <section>
              <h4 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-ink/80">
                {I.pin("#00764b")} Kırılımlar
              </h4>
              <ul className="space-y-2">
                {u.children.map((c) => {
                  const pay = u.amount > 0 ? c.amount / u.amount : 0;
                  const cOran = c.plan && c.plan > 0 ? c.amount / c.plan : null;
                  return (
                    <li key={c.label} className="rounded-xl bg-cream/70 px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate font-medium text-ink/85">{c.label}</span>
                        <span className="shrink-0 font-semibold text-ink">
                          {trMoney(c.amount)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(2, (c.amount / maxChild) * 100)}%`,
                              background: accent.grad,
                            }}
                          />
                        </div>
                        <span className="shrink-0 text-[11px] text-ink/55">
                          %{(pay * 100).toFixed(1).replace(".", ",")} · {c.count} adet
                          {cOran !== null ? ` · hedef ${pct(cOran)}` : ""}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <p className="text-[11px] text-ink/45">
            Tutarlar seçili ay aralığına aittir; aylık gelişim grafiği depodaki tüm ayları
            gösterir.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- ana dashboard ----

export default function BagisDashboard({
  headerLabel,
  updatedAt,
  ayA,
  ayB,
  ayLabel,
  exportUrl,
  units,
  monthly,
}: {
  headerLabel: string;
  updatedAt: string;
  ayA: string;
  ayB: string;
  ayLabel: string;
  exportUrl: string;
  units: BagisDashUnit[];
  monthly: MonthPoint[];
}) {
  const [detail, setDetail] = useState<number | null>(null);
  const gelir = units.reduce((s, u) => s + u.amount, 0);
  const adet = units.reduce((s, u) => s + u.count, 0);
  const plan = units.reduce((s, u) => s + (u.plan ?? 0), 0);
  const oran = plan > 0 ? gelir / plan : null;
  const cokBirim = units.length > 1;

  // pay donut'u: çok birimde temsilcilik payları; tek birimde ilçe payları
  const payParts = cokBirim
    ? units.map((u) => ({ label: u.label, value: u.amount }))
    : (units[0]?.children ?? []).map((c) => ({ label: c.label, value: c.amount }));

  const siraliUnits = [...units].sort((a, b) => b.amount - a.amount);

  return (
    <div className="space-y-6">
      {/* başlık */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">
            {headerLabel}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-primary-dark sm:text-3xl">
            Genel Bağış Raporu
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            {ayLabel} · {updatedAt} tarihinde güncellendi
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
            <input
              name="ayA"
              type="month"
              defaultValue={ayA}
              className="w-36 rounded-xl border border-mint bg-white px-2 py-1.5"
            />
            <span className="text-ink/50">–</span>
            <input
              name="ayB"
              type="month"
              defaultValue={ayB}
              className="w-36 rounded-xl border border-mint bg-white px-2 py-1.5"
            />
            <button className="rounded-xl bg-primary px-3 py-1.5 font-medium text-white">
              Getir
            </button>
          </form>
          <a
            href={exportUrl}
            className="flex items-center gap-1.5 rounded-xl border border-primary px-3 py-1.5 text-sm text-primary transition hover:bg-primary hover:text-white"
          >
            {I.doc()} Excel
          </a>
        </div>
      </div>

      {/* KPI kartları */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          icon={I.coins()}
          label="Toplam Gelir"
          value={trMoney(gelir)}
          sub="sorumluluk alanınızda"
          tone="green"
        />
        <KpiCard icon={I.hash()} label="Bağış Adedi" value={String(adet)} sub={ayLabel} tone="deep" />
        <KpiCard
          icon={I.target()}
          label="Plan Hedefi"
          value={plan > 0 ? trMoney(plan) : "—"}
          sub={ayLabel}
          tone="gold"
        />
        <KpiCard
          icon={I.trend()}
          label="Ulaşma Oranı"
          value={pct(oran)}
          sub={
            oran !== null ? (
              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-cream">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.min(100, oran * 100)}%`,
                    background:
                      oran >= 1
                        ? "linear-gradient(90deg,#00764b,#2f9e77)"
                        : oran >= 0.6
                          ? "linear-gradient(90deg,#b99961,#d4b98a)"
                          : "linear-gradient(90deg,#e8a838,#f0c269)",
                  }}
                />
              </span>
            ) : (
              "plan girilmedi"
            )
          }
          tone="oran"
        />
      </div>

      {/* grafikler */}
      <div className={`grid gap-4 ${cokBirim ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        <div className={`rounded-2xl bg-white p-5 shadow-sm ${cokBirim ? "lg:col-span-1" : ""}`}>
          <h3 className="mb-4 font-heading text-sm font-semibold text-ink/80">
            Aylık Gelişim (yıl geneli)
          </h3>
          <MonthlyChart data={monthly} />
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-heading text-sm font-semibold text-ink/80">
            {cokBirim ? "Temsilcilik Payları" : "Kırılım Payları"} ({ayLabel})
          </h3>
          <ShareDonut parts={payParts} />
        </div>
        {cokBirim && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h3 className="mb-4 font-heading text-sm font-semibold text-ink/80">
              Hedef Gerçekleşme Sıralaması
            </h3>
            <GoalBars units={units} />
          </div>
        )}
      </div>

      {/* temsilcilik kartları */}
      {units.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center text-ink/60 shadow-sm">
          Bu kapsamda bağış kaydı yok.
        </div>
      ) : (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-heading text-lg font-semibold text-ink">
              {cokBirim ? "Temsilcilik Özetleri" : "Temsilcilik Özeti"}
            </h2>
            <p className="text-xs text-ink/50">karta dokununca detay açılır</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
            {siraliUnits.map((u) => {
              const idx = units.findIndex((x) => x.key === u.key);
              return <UnitCard key={u.key} u={u} i={idx} onDetail={() => setDetail(idx)} />;
            })}
          </div>
        </section>
      )}

      {detail !== null && units[detail] && (
        <UnitModal u={units[detail]} accent={accentOf(detail)} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
