"use client";

/**
 * Yardım dashboard'u — saha (bölge müdürü / temsilci) ve yönetici modu.
 * Saha: KPI kartları, grafikler, temsilcilik kartları, modal detay.
 * Yönetici (bolgeler prop'u verilince): önce bölge kartları/grafikleri,
 * bölgeye tıklayınca o bölgenin temsilcilik kartlarına inilir (drill-down),
 * temsilcilik kartından modala (ilçe → mahalle + en uzun bekleyenler).
 * Tüm sayılar sunucuda hesaplanır; burada yalnız gösterim/gezinme var.
 */
import { useEffect, useState } from "react";
import { YARDIM_STAGES } from "@/lib/domain/yardim-stages";

/** Aşama başına adet + gün aralığı; anahtarlar YARDIM_STAGES'tendir. */
export interface StageCell {
  count: number;
  range: string;
}
export type StageCells = Record<string, StageCell>;

export interface YardimNode {
  label: string; // yerleşim ya da mahalle adı
  stages: StageCells;
  toplam: number;
  kritik: number;
  children: YardimNode[];
}

/** Portalda temsilciliğe atanmamış kayıt: tarihli kısa-liste linkiyle ayıklanır. */
export interface AtanmamisRow {
  asama: string; // aşama kısa adı
  tarih: string; // başvuru tarihi DD.MM.YYYY
  yer: string; // 'Seyhan · Barış Mah.'
  url: string | null; // portalda aynı tarih+aşama kısa listesi
}

export interface YardimUnitRow {
  key: string;
  bolge: string;
  tems: string;
  stages: StageCells;
  toplam: number;
  kritik: number;
  portalAllUrl: string | null;
  portalKritikUrl: string | null;
  children: YardimNode[];
  /** Saha dashboard'u için: en uzun bekleyen başvurular (gün + yer etiketi). */
  topWaits?: { gun: number; yer: string }[];
  /** Portalda Sorumlu Birim'i boş/özel olup il-ilçeden bu birime sayılanlar. */
  atanmamis: AtanmamisRow[];
}

export interface WaitBin {
  label: string; // '0–30'
  counts: Record<string, number>; // aşama anahtarı → adet
}

export interface YardimBolge {
  label: string; // '1.BÖLGE'
  stages: StageCells;
  toplam: number;
  kritik: number;
}

const cnt = (s: StageCells, key: string) => s[key]?.count ?? 0;
const binToplam = (b: WaitBin) =>
  Object.values(b.counts).reduce((s, v) => s + v, 0);

// Tema-sadık vurgu paleti (kehribar yalnız kritik rozetlerde kullanılır)
const ACCENTS = [
  { main: "#00764b", soft: "#e2f3ea", grad: "linear-gradient(135deg,#00764b,#2f9e77)" },
  { main: "#004d32", soft: "#dcebe3", grad: "linear-gradient(135deg,#004d32,#00764b)" },
  { main: "#b99961", soft: "#f3ecdf", grad: "linear-gradient(135deg,#b99961,#d4b98a)" },
  { main: "#2f9e77", soft: "#e3f4ed", grad: "linear-gradient(135deg,#2f9e77,#6cc3a1)" },
  { main: "#3d7a68", soft: "#e4efeb", grad: "linear-gradient(135deg,#3d7a68,#5aa88f)" },
];
const accentOf = (i: number) => ACCENTS[i % ACCENTS.length];

/**
 * Kart vurgu rengi standardize: kritik eşiği aşan dosyası olanlar turuncu
 * (kehribar), olmayanlar yeşil. Kritik sayısı seçili eşiğe göre hesaplanır.
 */
function kritikAccent(kritik: number) {
  return kritik > 0
    ? { main: "#e8a838", soft: "#faeedb", grad: "linear-gradient(135deg,#e8a838,#f0c269)" }
    : { main: "#00764b", soft: "#e2f3ea", grad: "linear-gradient(135deg,#00764b,#2f9e77)" };
}

// ---- küçük ikonlar (inline SVG) ----
const I = {
  pin: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  grid: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="7" height="7" x="3" y="3" rx="1.5" />
      <rect width="7" height="7" x="14" y="3" rx="1.5" />
      <rect width="7" height="7" x="14" y="14" rx="1.5" />
      <rect width="7" height="7" x="3" y="14" rx="1.5" />
    </svg>
  ),
  clock: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  alert: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" x2="12" y1="9" y2="13" />
      <line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
  ),
  users: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  doc: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M15 2v5h5" />
    </svg>
  ),
  external: (c = "currentColor") => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  ),
  back: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  ),
  x: (c = "currentColor") => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  check: (c = "currentColor") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.801 10A10 10 0 1 1 17 3.335" />
      <path d="m9 11 3 3L22 4" />
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
  chevron: (open: boolean, c = "currentColor") => (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={c}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  ),
};

/** KPI kartı sunumu: aşama anahtarı → ikon/ton/alt metin. */
const STAGE_KPI: Record<
  string,
  { icon: React.ReactNode; tone: "green" | "deep" | "gold" | "sage"; sub: string }
> = {
  si: { icon: I.doc(), tone: "deep", sub: "inceleme bekleyen dosya" },
  bk: { icon: I.clock(), tone: "gold", sub: "koordinatör kararı bekleyen" },
  kk: { icon: I.check(), tone: "sage", sub: "komisyon kararı bekleyen" },
  od: { icon: I.coins(), tone: "green", sub: "ödeme sürecindeki dosya" },
};

// ---- grafikler ----

/** Aşama dağılımı donut'u (SVG, bağımlılıksız) — dilimler YARDIM_STAGES'ten. */
function Donut({ counts }: { counts: Record<string, number> }) {
  const parts = YARDIM_STAGES.map((s) => ({ ...s, value: counts[s.key] ?? 0 }));
  const total = parts.reduce((s, p) => s + p.value, 0);
  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-32 w-32 shrink-0">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#e7e2d7" strokeWidth="16" />
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => {
              const frac = p.value / total;
              const el = (
                <circle
                  key={p.key}
                  cx="70"
                  cy="70"
                  r={R}
                  fill="none"
                  stroke={p.color}
                  strokeWidth="16"
                  strokeDasharray={`${frac * C} ${C}`}
                  transform={`rotate(${-90 + offset * 360} 70 70)`}
                />
              );
              offset += frac;
              return el;
            })}
        <text x="70" y="66" textAnchor="middle" className="fill-primary-dark" fontSize="26" fontWeight="700">
          {total}
        </text>
        <text x="70" y="86" textAnchor="middle" fill="#2d3a35" opacity="0.55" fontSize="11">
          dosya
        </text>
      </svg>
      <div className="space-y-2 text-sm">
        {parts.map((p) => (
          <p key={p.key} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
            {p.kisa} <strong>{p.value}</strong>
          </p>
        ))}
      </div>
    </div>
  );
}

/** Bekleme süresi dağılımı — dikey sütun grafiği. */
function WaitChart({ bins, esik }: { bins: WaitBin[]; esik: number }) {
  const max = Math.max(1, ...bins.map(binToplam));
  return (
    <div>
      <div className="flex h-36 items-end gap-3">
        {bins.map((b, i) => {
          const toplam = binToplam(b);
          const h = Math.round((toplam / max) * 100);
          const kritikBin = i === bins.length - 1;
          return (
            <div key={b.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <span className="text-xs font-semibold text-ink/80">{toplam}</span>
              <div className="flex h-28 w-full max-w-14 items-end rounded-t-lg">
                <div
                  className="w-full rounded-t-lg"
                  style={{
                    height: `${Math.max(toplam ? 6 : 0, h)}%`,
                    background: kritikBin
                      ? "linear-gradient(180deg,#e8a838,#d18f1f)"
                      : "linear-gradient(180deg,#2f9e77,#00764b)",
                  }}
                />
              </div>
              <span className="text-[11px] text-ink/60">{b.label}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-ink/50">
        gün cinsinden bekleme · son dilim kritik eşiği (&gt;{esik} gün)
      </p>
    </div>
  );
}

/** Sıralama bar grafiği (bölge ya da temsilcilik bazlı). */
function RankBars({
  rows,
  onPick,
}: {
  rows: { label: string; toplam: number; kritik: number }[];
  onPick?: (label: string) => void;
}) {
  const sorted = [...rows].sort((a, b) => b.toplam - a.toplam).slice(0, 10);
  const max = Math.max(1, ...sorted.map((u) => u.toplam));
  return (
    <div className="space-y-2.5">
      {sorted.map((u, i) => (
        <div key={u.label} className="flex items-center gap-2 text-sm">
          <button
            onClick={onPick ? () => onPick(u.label) : undefined}
            className={`w-24 shrink-0 truncate text-left text-xs sm:w-28 ${onPick ? "text-primary hover:underline" : "text-ink/70"}`}
          >
            {u.label}
          </button>
          <div className="h-5 flex-1 overflow-hidden rounded-full bg-cream">
            <div
              className="flex h-full items-center rounded-full pl-2"
              style={{
                width: `${Math.max(8, (u.toplam / max) * 100)}%`,
                background: accentOf(i).grad,
              }}
            >
              <span className="text-[11px] font-semibold text-white">{u.toplam}</span>
            </div>
          </div>
          {u.kritik > 0 && (
            <span className="shrink-0 rounded-full bg-amber/20 px-1.5 py-0.5 text-[11px] font-semibold text-amber">
              {u.kritik}
            </span>
          )}
        </div>
      ))}
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
  value: number;
  sub: string;
  tone: "green" | "deep" | "gold" | "sage" | "amber";
}) {
  const tones = {
    green: { chip: "#e2f3ea", icon: "#00764b", blob: "rgba(0,118,75,.08)" },
    deep: { chip: "#dcebe3", icon: "#004d32", blob: "rgba(0,77,50,.08)" },
    gold: { chip: "#f3ecdf", icon: "#b99961", blob: "rgba(185,153,97,.12)" },
    sage: { chip: "#e4efeb", icon: "#3d7a68", blob: "rgba(61,122,104,.10)" },
    amber: { chip: "#faeedb", icon: "#e8a838", blob: "rgba(232,168,56,.14)" },
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
      <p className="mt-2 text-3xl font-bold" style={{ color: tones.icon }}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-ink/50">{sub}</p>
    </div>
  );
}

/** Aşama kırılımı: adetler + yığılmış renk çubuğu (kart içi ortak blok).
 * Çubuk 4 aşamanın tamamını kapsar; 'bekleyen' toplamından bağımsızdır. */
function StageBreakdown({ stages }: { stages: StageCells }) {
  const toplam = YARDIM_STAGES.reduce((s, st) => s + cnt(stages, st.key), 0);
  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink/70">
        {YARDIM_STAGES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: s.color }}
            />
            {s.kisa} <strong className="text-ink">{cnt(stages, s.key)}</strong>
          </span>
        ))}
      </div>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-cream">
        {toplam > 0 &&
          YARDIM_STAGES.map((s) => {
            const v = cnt(stages, s.key);
            return v > 0 ? (
              <div
                key={s.key}
                className="h-full"
                style={{ width: `${(v / toplam) * 100}%`, background: s.color }}
              />
            ) : null;
          })}
      </div>
    </>
  );
}

function BolgeCard({ b, onOpen }: { b: YardimBolge; onOpen: () => void }) {
  const a = kritikAccent(b.kritik);
  return (
    <button
      onClick={onOpen}
      className="flex flex-col overflow-hidden rounded-2xl bg-white text-left shadow-sm transition hover:shadow-md"
      style={{ borderTop: `4px solid ${a.main}` }}
    >
      <div className="flex-1 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: a.soft, color: a.main }}
            >
              {I.grid()}
            </span>
            <span className="font-heading text-[15px] font-semibold text-ink">{b.label}</span>
          </span>
          {b.kritik > 0 && (
            <span className="shrink-0 rounded-full bg-amber/20 px-2 py-0.5 text-xs font-bold text-amber">
              {b.kritik} kritik
            </span>
          )}
        </div>
        <p className="mt-3">
          <span className="text-3xl font-bold" style={{ color: a.main }}>
            {b.toplam}
          </span>{" "}
          <span className="text-sm text-ink/60">bekleyen</span>
        </p>
        <StageBreakdown stages={b.stages} />
      </div>
      <div className="border-t border-cream px-4 py-2.5 text-xs font-semibold sm:px-5" style={{ color: a.main }}>
        Temsilcilikleri gör →
      </div>
    </button>
  );
}

function UnitCard({
  u,
  onDetail,
}: {
  u: YardimUnitRow;
  onDetail: () => void;
}) {
  const a = kritikAccent(u.kritik);
  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm transition hover:shadow-md"
      style={{ borderTop: `4px solid ${a.main}` }}
    >
      <button onClick={onDetail} className="flex-1 p-4 text-left sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="flex items-center gap-2 min-w-0">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: a.soft, color: a.main }}
            >
              {I.pin()}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-heading text-[15px] font-semibold text-ink">
                {u.tems}
              </span>
              <span className="text-[11px] text-ink/50">{u.bolge}</span>
            </span>
          </span>
          {u.kritik > 0 && (
            <span className="shrink-0 rounded-full bg-amber/20 px-2 py-0.5 text-xs font-bold text-amber">
              {u.kritik} kritik
            </span>
          )}
        </div>

        <p className="mt-3">
          <span className="text-3xl font-bold" style={{ color: a.main }}>
            {u.toplam}
          </span>{" "}
          <span className="text-sm text-ink/60">bekleyen başvuru</span>
        </p>

        <StageBreakdown stages={u.stages} />

        {u.atanmamis.length > 0 && (
          <p className="mt-2.5 flex items-center gap-1.5 text-[11px] text-ink/60">
            <span className="text-amber">{I.alert()}</span>
            <strong>{u.atanmamis.length}</strong> dosya portalda birime atanmamış —
            detayda listelenir
          </p>
        )}
      </button>

      <div className="flex items-center justify-between border-t border-cream px-4 py-2.5 sm:px-5">
        <button
          onClick={onDetail}
          className="text-xs font-semibold"
          style={{ color: a.main }}
        >
          Detayları gör →
        </button>
        {u.portalAllUrl && (
          <a
            href={u.portalAllUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-ink/50 transition hover:text-primary"
          >
            Portal {I.external()}
          </a>
        )}
      </div>
    </div>
  );
}

// ---- modal ----

function NodeBlock({ node, depth, esik }: { node: YardimNode; depth: number; esik: number }) {
  const [open, setOpen] = useState(depth === 0);
  const toplam = node.toplam;
  const expandable = node.children.length > 0;
  return (
    <div className={depth > 0 ? "ml-4 border-l-2 border-mint pl-3" : ""}>
      <button
        onClick={expandable ? () => setOpen(!open) : undefined}
        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${expandable ? "hover:bg-mint/20" : "cursor-default"}`}
      >
        {expandable ? I.chevron(open, "#00764b") : <span className="w-3.5" />}
        <span className="min-w-0 flex-1 truncate font-medium text-ink/90">{node.label}</span>
        {node.kritik > 0 && (
          <span className="rounded-full bg-amber/20 px-1.5 text-[11px] font-bold text-amber">
            {node.kritik}
          </span>
        )}
        <span className="rounded-full bg-cream px-2 py-0.5 text-xs font-semibold text-ink/70">
          {toplam}
        </span>
      </button>
      {/* yalnız bekleyen aşamalar: ödeme sürecindekiler kırılımda gösterilmez */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-8 text-[11px] text-ink/50">
        {YARDIM_STAGES.filter((s) => s.bekleyen && cnt(node.stages, s.key) > 0).map(
          (s) => (
            <span key={s.key}>
              {s.kisa} {cnt(node.stages, s.key)} · {node.stages[s.key].range}
            </span>
          ),
        )}
      </div>
      {open &&
        node.children.map((c) => (
          <NodeBlock key={c.label} node={c} depth={depth + 1} esik={esik} />
        ))}
    </div>
  );
}

function UnitModal({
  u,
  accent,
  esik,
  onClose,
}: {
  u: YardimUnitRow;
  accent: { main: string; soft: string; grad: string };
  esik: number;
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
  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-ink/40 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      {/* mobil: tam ekran (100dvh — tarayıcı çubuğu hesaba katılır); masaüstü: ortalanmış panel */}
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
                <h3 className="font-heading text-lg font-bold leading-tight">{u.tems}</h3>
                <p className="text-xs text-white/80">{u.bolge}</p>
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
            <div className="rounded-xl bg-white/15 px-2 py-2">
              <p className="text-xl font-bold">{u.toplam}</p>
              <p className="text-[10px] uppercase tracking-wide text-white/80">Bekleyen</p>
            </div>
            {YARDIM_STAGES.map((s) => (
              <div key={s.key} className="rounded-xl bg-white/15 px-2 py-2">
                <p className="text-xl font-bold">{cnt(u.stages, s.key)}</p>
                <p className="text-[10px] uppercase tracking-wide text-white/80">
                  {s.kisa}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5 p-5 pb-[calc(env(safe-area-inset-bottom)+24px)]">
          {u.kritik > 0 && (
            <p className="flex items-center gap-2 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-ink/80">
              <span className="text-amber">{I.alert()}</span>
              <strong className="text-amber">{u.kritik}</strong> başvuru {esik} günden uzun
              süredir bekliyor.
            </p>
          )}

          {(u.topWaits?.length ?? 0) > 0 && (
            <section>
              <h4 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-ink/80">
                {I.clock("#b99961")} En uzun bekleyenler
              </h4>
              <ol className="space-y-1.5">
                {u.topWaits!.map((w, i) => (
                  <li
                    key={`${w.yer}-${i}`}
                    className="flex items-center gap-2 rounded-xl bg-cream/70 px-3 py-2 text-sm"
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: accent.main }}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink/80">{w.yer}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${w.gun > esik ? "bg-amber/20 text-amber" : "bg-mint text-primary-dark"}`}
                    >
                      {w.gun}g
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {u.children.length > 0 && (
            <section>
              <h4 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-ink/80">
                {I.pin("#00764b")} İlçe / mahalle kırılımı
              </h4>
              <div className="space-y-1">
                {u.children.map((c) => (
                  <NodeBlock key={c.label} node={c} depth={0} esik={esik} />
                ))}
              </div>
            </section>
          )}

          {u.atanmamis.length > 0 && (
            <section>
              <h4 className="mb-2 flex items-center gap-2 font-heading text-sm font-semibold text-ink/80">
                <span className="text-amber">{I.alert()}</span> Portalda birime
                atanmamış ({u.atanmamis.length})
              </h4>
              <p className="mb-2 text-xs leading-relaxed text-ink/55">
                Bu başvuruların portalda Sorumlu Birim alanı boş (ya da özel bir
                birimde); ihtiyaç sahibinin il-ilçe bilgisinden bu temsilciliğe
                sayıldılar ve
                birimin portal filtresinde <em>görünmezler</em>. &quot;Bul&quot;
                bağlantısı aynı tarihte açılmış aynı aşamadaki başvuruların kısa
                listesini açar. Yakında doğrudan başvuruyu açmanızı sağlayacak
                geliştirme yapılacak.
              </p>
              <ul className="space-y-1.5">
                {u.atanmamis.map((r, i) => (
                  <li
                    key={`${r.tarih}-${r.yer}-${i}`}
                    className="flex items-center gap-2 rounded-xl bg-cream/70 px-3 py-2 text-sm"
                  >
                    <span className="shrink-0 rounded-full bg-mint px-2 py-0.5 text-[11px] font-semibold text-primary-dark">
                      {r.asama}
                    </span>
                    <span className="shrink-0 text-xs text-ink/60">{r.tarih}</span>
                    <span className="min-w-0 flex-1 truncate text-ink/80">{r.yer}</span>
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary hover:underline"
                      >
                        Bul {I.external()}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="flex flex-wrap gap-2 pb-1">
            {u.portalKritikUrl && u.kritik > 0 && (
              <a
                href={u.portalKritikUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-xl bg-amber px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Kritik dosyalar {I.external("white")}
              </a>
            )}
            {u.portalAllUrl && (
              <a
                href={u.portalAllUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                style={{ background: accent.grad }}
              >
                Portalda aç {I.external("white")}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- ana dashboard ----

export default function YardimDashboard({
  headerLabel,
  updatedAt,
  taranan,
  esik,
  units,
  bins,
  exportUrl,
  bolgeler,
  binsByBolge,
  initialBolge,
}: {
  headerLabel: string;
  updatedAt: string;
  taranan: number;
  esik: number;
  units: YardimUnitRow[];
  bins: WaitBin[];
  exportUrl: string;
  /** Yönetici modu: bölge özetleri (drill-down ile temsilciliklere inilir). */
  bolgeler?: YardimBolge[];
  binsByBolge?: Record<string, WaitBin[]>;
  /** URL'den gelen bölge seçimi (eşik değişiminde seçim korunur). */
  initialBolge?: string | null;
}) {
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [selBolge, setSelBolge] = useState<string | null>(
    initialBolge && bolgeler?.some((b) => b.label === initialBolge)
      ? initialBolge
      : null,
  );
  // bölge seçimini URL'e yansıt: eşik formu (GET) seçimi taşısın
  const selectBolge = (label: string | null) => {
    setSelBolge(label);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (label) url.searchParams.set("bolge", label);
      else url.searchParams.delete("bolge");
      window.history.replaceState(null, "", url);
    }
  };
  const admin = !!bolgeler;

  const visUnits = admin && selBolge ? units.filter((u) => u.bolge === selBolge) : units;
  const stageCounts: Record<string, number> = Object.fromEntries(
    YARDIM_STAGES.map((s) => [
      s.key,
      visUnits.reduce((sum, u) => sum + cnt(u.stages, s.key), 0),
    ]),
  );
  const toplam = visUnits.reduce((s, u) => s + u.toplam, 0);
  const kritik = visUnits.reduce((s, u) => s + u.kritik, 0);
  const visBins = admin && selBolge ? (binsByBolge?.[selBolge] ?? bins) : bins;

  const detailIdx = detailKey ? visUnits.findIndex((u) => u.key === detailKey) : -1;
  const kartGorunumu = !admin || selBolge !== null;
  const cokBirim = visUnits.length > 1;

  // Excel seçili bölgeyi de taşır (exportUrl her zaman ?esik=... içerir)
  const exportHref = selBolge
    ? `${exportUrl}&bolge=${encodeURIComponent(selBolge)}`
    : exportUrl;

  return (
    <div className="space-y-6">
      {/* başlık */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">
            {admin && selBolge ? `${selBolge} · Bölge Detayı` : headerLabel}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-primary-dark sm:text-3xl">
            Yardım Başvuruları
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            {updatedAt} itibarıyla bekleyen başvurular · {taranan} kayıt tarandı
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form className="flex items-center gap-2 text-sm" method="GET">
            {selBolge && <input type="hidden" name="bolge" value={selBolge} readOnly />}
            <label htmlFor="esik" className="text-ink/70">
              Kritik eşik
            </label>
            <input
              id="esik"
              name="esik"
              type="number"
              min={1}
              max={365}
              defaultValue={esik}
              className="w-20 rounded-xl border border-mint bg-white px-2 py-1.5"
            />
            <button className="rounded-xl bg-primary px-3 py-1.5 font-medium text-white">
              Uygula
            </button>
          </form>
          <a
            href={exportHref}
            className="flex items-center gap-1.5 rounded-xl border border-primary px-3 py-1.5 text-sm text-primary transition hover:bg-primary hover:text-white"
          >
            {I.doc()} Excel
          </a>
        </div>
      </div>

      {/* bölge seçiliyken geri dönüş */}
      {admin && selBolge && (
        <button
          onClick={() => selectBolge(null)}
          className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-primary shadow-sm transition hover:bg-mint/30"
        >
          {I.back()} Tüm bölgelere dön
        </button>
      )}

      {/* KPI kartları: toplam + aşama başına bir kart + kritik */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          icon={I.users()}
          label="Toplam Bekleyen"
          value={toplam}
          sub={admin ? (selBolge ?? "tüm bölgeler") : "sorumluluk alanınızda"}
          tone="green"
        />
        {YARDIM_STAGES.map((s) => {
          const k = STAGE_KPI[s.key];
          return (
            <KpiCard
              key={s.key}
              icon={k.icon}
              label={s.label}
              value={stageCounts[s.key]}
              sub={k.sub}
              tone={k.tone}
            />
          );
        })}
        <KpiCard
          icon={I.alert()}
          label={`Kritik (>${esik} gün)`}
          value={kritik}
          sub="acil ilgilenilmesi gereken"
          tone="amber"
        />
      </div>

      {visUnits.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center text-ink/60 shadow-sm">
          Bu kapsamda bekleyen başvuru yok. 🎉
        </div>
      ) : (
        <>
          {/* grafikler */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h3 className="mb-4 font-heading text-sm font-semibold text-ink/80">
                Aşama Dağılımı
              </h3>
              <Donut counts={stageCounts} />
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h3 className="mb-4 font-heading text-sm font-semibold text-ink/80">
                Bekleme Süresi Dağılımı
              </h3>
              <WaitChart bins={visBins} esik={esik} />
            </div>
            {admin && !selBolge ? (
              <div className="rounded-2xl bg-white p-5 shadow-sm">
                <h3 className="mb-4 font-heading text-sm font-semibold text-ink/80">
                  Bölge Sıralaması
                </h3>
                <RankBars
                  rows={bolgeler!.map((b) => ({
                    label: b.label,
                    toplam: b.toplam,
                    kritik: b.kritik,
                  }))}
                  onPick={(l) => selectBolge(l)}
                />
              </div>
            ) : (
              cokBirim && (
                <div className="rounded-2xl bg-white p-5 shadow-sm">
                  <h3 className="mb-4 font-heading text-sm font-semibold text-ink/80">
                    Temsilcilik Sıralaması
                  </h3>
                  <RankBars
                    rows={visUnits.map((u) => ({
                      label: u.tems,
                      toplam: u.toplam,
                      kritik: u.kritik,
                    }))}
                  />
                </div>
              )
            )}
          </div>

          {/* bölge kartları (yönetici, seçim yokken) */}
          {admin && !selBolge && (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-heading text-lg font-semibold text-ink">Bölge Özetleri</h2>
                <p className="text-xs text-ink/50">bölgeye dokununca temsilcilikler açılır</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4 lg:grid-cols-3">
                {bolgeler!.map((b) => (
                  <BolgeCard key={b.label} b={b} onOpen={() => selectBolge(b.label)} />
                ))}
              </div>
            </section>
          )}

          {/* temsilcilik kartları */}
          {kartGorunumu && (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-heading text-lg font-semibold text-ink">
                  Temsilcilik Özetleri
                </h2>
                <p className="text-xs text-ink/50">karta dokununca detay açılır</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
                {visUnits.map((u) => (
                  <UnitCard key={u.key} u={u} onDetail={() => setDetailKey(u.key)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {detailIdx !== -1 && (
        <UnitModal
          u={visUnits[detailIdx]}
          accent={kritikAccent(visUnits[detailIdx].kritik)}
          esik={esik}
          onClose={() => setDetailKey(null)}
        />
      )}
    </div>
  );
}
