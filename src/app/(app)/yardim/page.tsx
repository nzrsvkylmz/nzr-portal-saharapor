import { desc, eq, and } from "drizzle-orm";
import { redirect } from "next/navigation";
import { canViewYardim, requireActiveUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { reportRuns, units, yardimAggregates } from "@/lib/db/schema";
import { visibleScope } from "@/lib/domain/scope";
import { toTrDate } from "@/lib/domain/normalize";
import { BASE_URL } from "@/lib/portal/client";
import { DEFAULT_FLOW, portalLink } from "@/lib/portal/relief";
import YardimTable, { type YardimNode, type YardimUnitRow } from "./YardimTable";
import YardimDashboard, { type WaitBin } from "./YardimDashboard";

export const dynamic = "force-dynamic";

interface StageData {
  days: number[];
  count: number;
}

type MahalleDays = Record<string, number[]>;
// yeni biçim: yerleşim → mahalle → günler; eski snapshot'larda yerleşim → günler
type DistrictDays = Record<string, MahalleDays | number[]>;

/** Eski (düz) ve yeni (mahalleli) districts biçimlerini tek biçime indirger. */
function normDistricts(d: DistrictDays | undefined): Record<string, MahalleDays> {
  const out: Record<string, MahalleDays> = {};
  for (const [y, v] of Object.entries(d ?? {})) {
    out[y] = Array.isArray(v) ? { Belirtilmemiş: v } : v;
  }
  return out;
}

interface RowData {
  label: string;
  unitId: number | null;
  si?: StageData;
  bk?: StageData;
  siDistricts?: DistrictDays;
  bkDistricts?: DistrictDays;
}

function range(days: number[]): string {
  if (!days.length) return "—";
  const valid = days.filter((d) => d >= 0);
  if (!valid.length) return "—";
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return min === max ? `${min} gün` : `${min}–${max} gün`;
}

function kritikAdet(row: RowData, esik: number): number {
  const all = [...(row.si?.days ?? []), ...(row.bk?.days ?? [])];
  return all.filter((d) => d > esik).length;
}

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(d);
}

export default async function YardimPage({
  searchParams,
}: {
  searchParams: Promise<{ esik?: string; bolge?: string }>;
}) {
  const user = await requireActiveUser();
  if (!canViewYardim(user)) redirect("/bagis"); // muhasebe yardımı görmez
  const scope = await visibleScope(user, "yardim");
  const sp = await searchParams;
  const esik = Math.min(365, Math.max(1, Number(sp.esik) || 90));

  const run = await db.query.reportRuns.findFirst({
    where: and(eq(reportRuns.kind, "yardim"), eq(reportRuns.status, "done")),
    orderBy: desc(reportRuns.finishedAt),
  });

  if (!run) {
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <div className="rounded-2xl bg-white p-10 shadow-sm">
          <h1 className="text-xl font-semibold text-primary-dark">Yardım Raporu</h1>
          <p className="mt-3 text-sm text-ink/70">
            Henüz rapor oluşturulmadı. Sosyal yardımlar birimi ilk güncellemeyi
            yaptığında burada görünecek.
          </p>
        </div>
      </div>
    );
  }

  const aggRows = await db
    .select()
    .from(yardimAggregates)
    .where(eq(yardimAggregates.runId, run.id));
  const allUnits = await db.select().from(units);
  const depIdByUnitId = new Map(allUnits.map((u) => [u.id, u.depId]));

  // satırları bölge/birim bazında si+bk olarak birleştir
  function collect(
    rows: typeof aggRows,
    keyOf: (r: (typeof aggRows)[number]) => string,
  ): Map<string, RowData> {
    const out = new Map<string, RowData>();
    for (const r of rows) {
      const key = keyOf(r);
      const cur = out.get(key) ?? { label: key, unitId: r.unitId ?? null };
      const data: StageData = { days: (r.days as number[]) ?? [], count: r.count };
      const districts = (r.districts as DistrictDays | null) ?? undefined;
      if (r.stageKey === "si") {
        cur.si = data;
        cur.siDistricts = districts;
      } else if (r.stageKey === "bk") {
        cur.bk = data;
        cur.bkDistricts = districts;
      }
      if (r.unitId) cur.unitId = r.unitId;
      out.set(key, cur);
    }
    return out;
  }

  const bolgeRows = aggRows.filter(
    (r) =>
      r.scope === "bolge" &&
      (scope.all || scope.bolgeLabels.includes(r.bolgeLabel ?? "")),
  );
  const unitRows = aggRows.filter((r) => {
    if (r.scope !== "unit") return false;
    if (scope.all) return !sp.bolge || r.bolgeLabel === sp.bolge;
    return (
      (r.unitId !== null && scope.unitIds.includes(r.unitId)) ||
      scope.unitLabels.includes(r.unitLabel ?? "")
    );
  });
  const unmatchedRows = scope.all ? aggRows.filter((r) => r.scope === "unmatched") : [];

  const bolgeler = [...collect(bolgeRows, (r) => r.bolgeLabel ?? "?").values()].sort(
    (a, b) =>
      (Number(/^(\d+)/.exec(a.label)?.[1]) || 999) -
      (Number(/^(\d+)/.exec(b.label)?.[1]) || 999),
  );
  const birimler = [
    ...collect(unitRows, (r) => `${r.bolgeLabel}|${r.unitLabel}`).values(),
  ].sort((a, b) => a.label.localeCompare(b.label, "tr"));

  const toplamSi = bolgeRows
    .filter((r) => r.stageKey === "si")
    .reduce((s, r) => s + r.count, 0);
  const toplamBk = bolgeRows
    .filter((r) => r.stageKey === "bk")
    .reduce((s, r) => s + r.count, 0);
  const toplamKritik =
    [...bolgeler.values()].reduce((s, b) => s + kritikAdet(b, esik), 0) ||
    birimler.reduce((s, b) => s + kritikAdet(b, esik), 0);

  const esikTarihi = toTrDate(new Date(Date.now() - esik * 86400_000));

  // Temsilcilik Detayı satırları + ilçe (Yerleşim) → mahalle kırılımı — tüm
  // sayılar burada hesaplanır, client bileşeni yalnız aç/kapa yapar.
  const makeNode = (
    label: string,
    si: number[],
    bk: number[],
    children: YardimNode[] = [],
  ): YardimNode => ({
    label,
    siCount: si.length,
    siRange: range(si),
    bkCount: bk.length,
    bkRange: range(bk),
    kritik: [...si, ...bk].filter((d) => d > esik).length,
    children,
  });
  const byTotalDesc = (a: YardimNode, z: YardimNode) =>
    z.siCount + z.bkCount - (a.siCount + a.bkCount);

  const detayRows: YardimUnitRow[] = birimler.map((b) => {
    const [bolge, tems] = b.label.split("|");
    const depId = b.unitId ? depIdByUnitId.get(b.unitId) : undefined;
    const siD = normDistricts(b.siDistricts);
    const bkD = normDistricts(b.bkDistricts);
    const yerlesimler = new Set([...Object.keys(siD), ...Object.keys(bkD)]);
    let children = [...yerlesimler]
      .map((y) => {
        const siMah = siD[y] ?? {};
        const bkMah = bkD[y] ?? {};
        const mahalleler = new Set([...Object.keys(siMah), ...Object.keys(bkMah)]);
        let mahRows = [...mahalleler]
          .map((m) => makeNode(m, siMah[m] ?? [], bkMah[m] ?? []))
          .sort(byTotalDesc);
        // mahalle bilgisi hiç yoksa alt düzey gösterilmez
        if (mahRows.length === 1 && mahRows[0].label === "Belirtilmemiş") {
          mahRows = [];
        }
        return makeNode(
          y,
          Object.values(siMah).flat(),
          Object.values(bkMah).flat(),
          mahRows,
        );
      })
      .sort(byTotalDesc);
    // Tek yerleşim ve adı temsilcilikle aynıysa (İstanbul bölgelerinde
    // temsilcilik = ilçe) o düzey atlanır, mahalleler doğrudan altta görünür.
    if (
      children.length === 1 &&
      children[0].label.toLocaleLowerCase("tr") === (tems ?? "").toLocaleLowerCase("tr")
    ) {
      children = children[0].children;
    }
    // en uzun bekleyenler: yerleşim/mahalle etiketiyle ilk 5 (saha dashboard'u)
    const waits: { gun: number; yer: string }[] = [];
    for (const d of [siD, bkD]) {
      for (const [y, mahMap] of Object.entries(d)) {
        for (const [m, days] of Object.entries(mahMap)) {
          const ayni = y.toLocaleLowerCase("tr") === (tems ?? "").toLocaleLowerCase("tr");
          const yer =
            m === "Belirtilmemiş" ? y : ayni ? m : `${y} · ${m}`;
          for (const gun of days) if (gun >= 0) waits.push({ gun, yer });
        }
      }
    }
    const topWaits = waits.sort((a, z) => z.gun - a.gun).slice(0, 5);
    return {
      topWaits,
      key: b.label,
      bolge: bolge ?? "",
      tems: tems ?? "",
      siCount: b.si?.count ?? 0,
      siRange: range(b.si?.days ?? []),
      bkCount: b.bk?.count ?? 0,
      bkRange: range(b.bk?.days ?? []),
      kritik: kritikAdet(b, esik),
      portalAllUrl: depId ? portalLink(BASE_URL, DEFAULT_FLOW, depId) : null,
      portalKritikUrl: depId
        ? portalLink(BASE_URL, DEFAULT_FLOW, depId, esikTarihi)
        : null,
      children,
    };
  });
  const seciliBolgeler = scope.all
    ? [...new Set(aggRows.filter((r) => r.scope === "unit").map((r) => r.bolgeLabel))]
        .filter(Boolean)
        .sort(
          (a, b) =>
            (Number(/^(\d+)/.exec(a!)?.[1]) || 999) -
            (Number(/^(\d+)/.exec(b!)?.[1]) || 999),
        )
    : [];

  // Saha rolleri (bölge müdürü / temsilci): kart + grafik dashboard'u.
  if (!scope.all) {
    const b1 = Math.max(1, Math.round(esik / 3));
    const b2 = Math.max(b1 + 1, Math.round((2 * esik) / 3));
    const binDefs = [
      { label: `0–${b1}`, min: 0, max: b1 },
      { label: `${b1 + 1}–${b2}`, min: b1 + 1, max: b2 },
      { label: `${b2 + 1}–${esik}`, min: b2 + 1, max: esik },
      { label: `${esik}+`, min: esik + 1, max: Infinity },
    ];
    const bins: WaitBin[] = binDefs.map((d) => ({ label: d.label, si: 0, bk: 0 }));
    for (const b of birimler) {
      for (const [stage, days] of [
        ["si", b.si?.days ?? []],
        ["bk", b.bk?.days ?? []],
      ] as const) {
        for (const gun of days) {
          if (gun < 0) continue;
          const i = binDefs.findIndex((d) => gun >= d.min && gun <= d.max);
          if (i !== -1) bins[i][stage] += 1;
        }
      }
    }
    const headerLabel =
      user.role === "BOLGE_MUDURU"
        ? `${scope.bolgeLabels[0] ?? ""} · Saha Görünümü`
        : detayRows.length === 1
          ? `${detayRows[0].tems} Temsilciliği`
          : "Temsilcilik Görünümü";
    return (
      <YardimDashboard
        headerLabel={headerLabel}
        updatedAt={fmtTime(run.finishedAt)}
        taranan={run.rowCount ?? 0}
        esik={esik}
        units={detayRows}
        bins={bins}
        exportUrl={`/api/export/yardim?esik=${esik}`}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary-dark">Yardım Raporu</h1>
          <p className="mt-1 text-sm text-ink/60">
            {fmtTime(run.finishedAt)} itibarıyla bekleyen başvurular ·{" "}
            {run.rowCount ?? 0} kayıt tarandı
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <form className="flex items-center gap-2 text-sm" method="GET">
            {sp.bolge && <input type="hidden" name="bolge" value={sp.bolge} />}
            <label htmlFor="esik">Kritik eşik</label>
            <input
              id="esik"
              name="esik"
              type="number"
              min={1}
              max={365}
              defaultValue={esik}
              className="w-20 rounded-lg border border-mint px-2 py-1"
            />
            <button className="rounded-lg bg-primary px-3 py-1.5 text-white">Uygula</button>
          </form>
          <a
            href={`/api/export/yardim?esik=${esik}`}
            className="rounded-lg border border-primary px-3 py-1.5 text-sm text-primary transition hover:bg-primary hover:text-white"
          >
            ⬇ Excel
          </a>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-ink/60">Sosyal İnceleme Bekleyen</p>
          <p className="mt-1 text-3xl font-semibold text-primary-dark">
            {scope.all
              ? toplamSi
              : birimler.reduce((s, b) => s + (b.si?.count ?? 0), 0)}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-ink/60">Bölge Koordinatörü Kararında</p>
          <p className="mt-1 text-3xl font-semibold text-primary-dark">
            {scope.all
              ? toplamBk
              : birimler.reduce((s, b) => s + (b.bk?.count ?? 0), 0)}
          </p>
        </div>
        <div className="rounded-2xl border-2 border-amber/60 bg-white p-5 shadow-sm">
          <p className="text-xs text-ink/60">Kritik (&gt;{esik} gün)</p>
          <p className="mt-1 text-3xl font-semibold text-amber">
            {scope.all
              ? toplamKritik
              : birimler.reduce((s, b) => s + kritikAdet(b, esik), 0)}
          </p>
        </div>
      </div>

      {scope.all && (
        <section>
          <h2 className="font-heading text-lg font-semibold">Bölge Özeti</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary text-left text-white">
                  <th className="px-4 py-2.5 font-medium">Bölge</th>
                  <th className="px-4 py-2.5 font-medium">Sosyal İnceleme</th>
                  <th className="px-4 py-2.5 font-medium">Gün Aralığı</th>
                  <th className="px-4 py-2.5 font-medium">Koordinatör Kararı</th>
                  <th className="px-4 py-2.5 font-medium">Gün Aralığı</th>
                  <th className="px-4 py-2.5 font-medium">Kritik</th>
                </tr>
              </thead>
              <tbody>
                {bolgeler.map((b, i) => {
                  const kritik = kritikAdet(b, esik);
                  return (
                    <tr key={b.label} className={i % 2 ? "bg-cream/60" : ""}>
                      <td className="px-4 py-2">
                        <a
                          href={`/yardim?bolge=${encodeURIComponent(b.label)}&esik=${esik}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {b.label}
                        </a>
                      </td>
                      <td className="px-4 py-2">{b.si?.count ?? 0}</td>
                      <td className="px-4 py-2 text-ink/70">{range(b.si?.days ?? [])}</td>
                      <td className="px-4 py-2">{b.bk?.count ?? 0}</td>
                      <td className="px-4 py-2 text-ink/70">{range(b.bk?.days ?? [])}</td>
                      <td className="px-4 py-2">
                        {kritik > 0 ? (
                          <span className="rounded-full bg-amber/20 px-2 py-0.5 font-semibold text-amber">
                            {kritik}
                          </span>
                        ) : (
                          <span className="text-ink/40">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">
            Temsilcilik Detayı{sp.bolge ? ` — ${sp.bolge}` : ""}
          </h2>
          {scope.all && (
            <form method="GET" className="flex items-center gap-2 text-sm">
              <input type="hidden" name="esik" value={esik} />
              <select
                name="bolge"
                defaultValue={sp.bolge ?? ""}
                className="rounded-lg border border-mint px-2 py-1"
              >
                <option value="">Tüm bölgeler</option>
                {seciliBolgeler.map((b) => (
                  <option key={b} value={b!}>
                    {b}
                  </option>
                ))}
              </select>
              <button className="rounded-lg bg-primary px-3 py-1.5 text-white">
                Filtrele
              </button>
            </form>
          )}
        </div>
        <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
          <YardimTable rows={detayRows} defaultOpen={user.role === "TEMSILCI"} />
        </div>
        <p className="mt-2 text-xs text-ink/50">
          Temsilcilik satırına tıklayınca başvuruların ilçe (yerleşim), ilçe
          satırına tıklayınca mahalle kırılımı açılır.{" "}
          Rapordaki sayılar başvurunun <strong>şehir/yerleşimine</strong> göredir;
          portal linkleri ise başvurunun <strong>sorumlu birimi</strong> filtresiyle
          açılır. Sorumlu birimi farklı bir birimde (örn. merkezde) olan dosyalar
          linkte görünmez — bu yüzden portal, buradaki sayıdan az kayıt
          gösterebilir.
        </p>
      </section>

      {unmatchedRows.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold text-ink/70">
            Eşlenmeyen Kayıtlar (yalnız yöneticiler görür)
          </h2>
          <div className="mt-3 rounded-2xl bg-white p-4 text-sm shadow-sm">
            <ul className="space-y-1">
              {unmatchedRows.map((r) => (
                <li key={r.id} className="flex justify-between">
                  <span>{r.unitLabel}</span>
                  <span className="text-ink/60">
                    {r.count} başvuru ({r.stageKey === "si" ? "Sosyal İnceleme" : "Koordinatör"})
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink/50">
              Bu şehir/yerleşimler birim listesiyle eşleştirilemedi. Portalda yeni
              birim açıldıysa yardım raporunu yeniden güncelleyin.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
