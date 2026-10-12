import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { canViewBagis, requireActiveUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { bagisAggregates, plans, reportRuns, unitPlans, units } from "@/lib/db/schema";
import { visibleScope } from "@/lib/domain/scope";
import { trDateToMonth, trMoney } from "@/lib/domain/normalize";
import {
  monthList,
  monthsInRange,
  rowsForMonthRange,
  rowsForSart,
  sartList,
} from "@/lib/domain/bagis-view";
import type { BagisParams } from "@/lib/jobs/bagis-job";
import UnitTable, { type UnitChildRow, type UnitGroupRow } from "./UnitTable";
import BagisDashboard, {
  type BagisDashUnit,
  type MonthPoint,
} from "./BagisDashboard";

export const dynamic = "force-dynamic";

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(d);
}

function bolgeOrder(label: string): number {
  const m = /^(\d+)\./.exec(label);
  if (m) return Number(m[1]);
  return label === "BELİRTİLMEMİŞ" ? 900 : 901;
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

export default async function BagisPage({
  searchParams,
}: {
  searchParams: Promise<{ bolge?: string; sart?: string; ayA?: string; ayB?: string }>;
}) {
  const user = await requireActiveUser();
  if (!canViewBagis(user)) redirect("/yardim"); // sosyal yardımlar bağışı görmez
  const scope = await visibleScope(user, "bagis");
  const sp = await searchParams;

  const run = await db.query.reportRuns.findFirst({
    where: and(eq(reportRuns.kind, "bagis"), eq(reportRuns.status, "done")),
    orderBy: desc(reportRuns.finishedAt),
  });

  // kalıcı aylık depo: run'dan bağımsız, her ay son çekilen haliyle durur
  const allAggRows = await db.select().from(bagisAggregates);

  if (!run || allAggRows.length === 0) {
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <div className="rounded-2xl bg-white p-10 shadow-sm">
          <h1 className="text-xl font-semibold text-primary-dark">Bağış Raporu</h1>
          <p className="mt-3 text-sm text-ink/70">
            Henüz rapor oluşturulmadı. Muhasebe birimi ilk güncellemeyi
            yaptığında burada görünecek.
          </p>
        </div>
      </div>
    );
  }

  const p = run.params as unknown as BagisParams;

  // ay aralığı filtresi: başlangıç–bitiş ayı; varsayılan içinde bulunulan ay
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const aylar = monthList(allAggRows);
  const ayRx = /^\d{4}-\d{2}$/;
  const fallback = aylar.length
    ? currentMonth
    : (trDateToMonth(p.dateA ?? "") ?? currentMonth);
  let ayA = ayRx.test(sp.ayA ?? "") ? sp.ayA! : fallback;
  let ayB = ayRx.test(sp.ayB ?? "") ? sp.ayB! : ayA;
  if (ayA > ayB) [ayA, ayB] = [ayB, ayA];
  const ayLabel = ayA === ayB ? `${ayA} ayı` : `${ayA} – ${ayB}`;
  const monthRows = rowsForMonthRange(allAggRows, ayA, ayB);

  // bağış şartı (faaliyet) filtresi: Tümü | Genel Bağış | Sadaka | …
  // Saha rolleri (temsilci/bölge müdürü) yalnız Genel Bağış görür; şart
  // seçimi ve diğer şartların verisi admin'e özeldir.
  const sartlar = sartList(allAggRows);
  let sart = sartlar.includes(sp.sart ?? "") ? (sp.sart as string) : null;
  if (!scope.all && sartlar.includes("Genel Bağış")) sart = "Genel Bağış";
  const aggRows = rowsForSart(monthRows, sart);
  // plan hedefleri Genel Bağış içindir; diğer görünümlerde oran yanıltıcı olur.
  // (eski, şart kırılımı olmayan snapshot'larda önceki davranış korunur)
  const planVisible = sart === "Genel Bağış" || sartlar.length === 0;

  // plan: aralıktaki ayların hedefleri bölge bazında toplanır
  const planMonths = monthsInRange(ayA, ayB);
  const planRows = planMonths.length
    ? await db.select().from(plans).where(inArray(plans.month, planMonths))
    : [];
  const planByBolge = new Map<string, number>();
  for (const r of planRows) {
    planByBolge.set(r.bolgeLabel, (planByBolge.get(r.bolgeLabel) ?? 0) + Number(r.amount));
  }

  // il temsilciliği hedefleri: aralıktaki ayların birim planları toplanır
  const unitPlanRows = planMonths.length
    ? await db.select().from(unitPlans).where(inArray(unitPlans.month, planMonths))
    : [];
  const planByUnit = new Map<number, number>();
  for (const r of unitPlanRows) {
    planByUnit.set(r.unitId, (planByUnit.get(r.unitId) ?? 0) + Number(r.amount));
  }

  const bolgeRows = aggRows
    .filter(
      (r) =>
        r.scope === "bolge" &&
        (scope.all || scope.bolgeLabels.includes(r.bolgeLabel)),
    )
    .sort((a, b) => bolgeOrder(a.bolgeLabel) - bolgeOrder(b.bolgeLabel));

  const unitRows = aggRows
    .filter((r) => {
      if (r.scope !== "unit") return false;
      if (scope.all) return !sp.bolge || r.bolgeLabel === sp.bolge;
      if (user.role === "BOLGE_MUDURU") return scope.bolgeLabels.includes(r.bolgeLabel);
      return (
        (r.unitId !== null && scope.unitIds.includes(r.unitId)) ||
        scope.unitLabels.includes(r.unitLabel ?? "")
      );
    })
    .sort(
      (a, b) =>
        bolgeOrder(a.bolgeLabel) - bolgeOrder(b.bolgeLabel) ||
        Number(b.totalAmount) - Number(a.totalAmount),
    );

  // İl–ilçe hiyerarşisi: unit satırları üst (il) temsilciliği altında
  // gruplanır; ilin planı ve oranı kendi + ilçe bağışlarının birleşik
  // toplamı üzerinden hesaplanır. Üst birim = parent zinciri boyunca en
  // üstteki, bölge müdürlüğü olmayan birim (Kocaeli-Gölcük gibi il
  // statüsündekiler kendi başına kalır).
  const allUnits = await db
    .select({
      id: units.id,
      name: units.name,
      parentUnitId: units.parentUnitId,
      bolgeLabel: units.bolgeLabel,
      isBolgeMudurlugu: units.isBolgeMudurlugu,
      active: units.active,
    })
    .from(units);
  const unitById = new Map(allUnits.map((u) => [u.id, u]));
  const topOf = (id: number) => {
    let cur = unitById.get(id);
    const seen = new Set<number>();
    while (cur && cur.parentUnitId != null && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = unitById.get(cur.parentUnitId);
      if (!parent || parent.isBolgeMudurlugu) break;
      cur = parent;
    }
    return cur ?? null;
  };

  type GroupDraft = UnitGroupRow & { own: UnitChildRow | null };
  const groupMap = new Map<string, GroupDraft>();
  for (const r of unitRows) {
    const amount = Number(r.totalAmount);
    const top = r.unitId !== null ? topOf(r.unitId) : null;
    const key = top ? `u${top.id}` : `l|${r.bolgeLabel}|${r.unitLabel ?? ""}`;
    let g = groupMap.get(key);
    if (!g) {
      g = {
        key,
        bolgeLabel: r.bolgeLabel,
        label: top ? top.name : (r.unitLabel ?? "—"),
        count: 0,
        amount: 0,
        plan: top ? (planByUnit.get(top.id) ?? null) : null,
        children: [],
        own: null,
      };
      groupMap.set(key, g);
    }
    g.count += r.donationCount;
    g.amount += amount;
    if (top && top.id !== r.unitId) {
      const childPlan = r.unitId !== null ? (planByUnit.get(r.unitId) ?? null) : null;
      if (childPlan) g.plan = (g.plan ?? 0) + childPlan;
      g.children.push({
        key: `c${r.unitId}`,
        label: r.unitLabel ?? "—",
        count: r.donationCount,
        amount,
        plan: childPlan,
      });
    } else {
      g.own = {
        key: `${key}-own`,
        label: "",
        count: r.donationCount,
        amount,
        plan: null,
      };
    }
  }

  // Planı olup bu aralıkta hiç bağışı olmayan il temsilcilikleri de %0
  // oranıyla listelenir (yalnız kapsam içindekiler).
  if (planVisible) {
    for (const [unitId, plan] of planByUnit) {
      if (plan <= 0 || groupMap.has(`u${unitId}`)) continue;
      const u = unitById.get(unitId);
      if (!u || !u.active || topOf(unitId)?.id !== unitId) continue;
      const visible = scope.all
        ? !sp.bolge || u.bolgeLabel === sp.bolge
        : user.role === "BOLGE_MUDURU"
          ? u.bolgeLabel !== null && scope.bolgeLabels.includes(u.bolgeLabel)
          : scope.unitIds.includes(unitId);
      if (!visible) continue;
      groupMap.set(`u${unitId}`, {
        key: `u${unitId}`,
        bolgeLabel: u.bolgeLabel ?? "—",
        label: u.name,
        count: 0,
        amount: 0,
        plan,
        children: [],
        own: null,
      });
    }
  }

  const unitGroups: UnitGroupRow[] = [...groupMap.values()]
    .map((g) => {
      const children = [...g.children].sort((a, b) => b.amount - a.amount);
      if (g.own && children.length > 0) {
        children.unshift({ ...g.own, label: `${g.label} (il geneli)` });
      }
      return {
        key: g.key,
        bolgeLabel: g.bolgeLabel,
        label: g.label,
        count: g.count,
        amount: g.amount,
        plan: g.plan,
        children,
      };
    })
    .sort(
      (a, b) =>
        bolgeOrder(a.bolgeLabel) - bolgeOrder(b.bolgeLabel) || b.amount - a.amount,
    );

  // saha rolleri için sorumluluk alanı plan toplamı (kart + oran)
  const scopePlan = scope.all
    ? 0
    : unitGroups.reduce((s, g) => s + (g.plan ?? 0), 0);

  // Saha rolleri (bölge müdürü / temsilci): kart + grafik dashboard'u.
  if (!scope.all) {
    // Aylık trend: depodaki TÜM ayların kapsam içi Genel Bağış satırları
    const sahaMonthRows = allAggRows.filter((r) => {
      if (r.scope !== "unit" || r.month === null) return false;
      if (sart && r.activity !== sart) return false;
      if (user.role === "BOLGE_MUDURU") return scope.bolgeLabels.includes(r.bolgeLabel);
      return (
        (r.unitId !== null && scope.unitIds.includes(r.unitId)) ||
        scope.unitLabels.includes(r.unitLabel ?? "")
      );
    });
    const aylarAsc = [...new Set(sahaMonthRows.map((r) => r.month!))].sort();

    // kapsamdaki üst (il) birimler ve tüm ayların plan hedefleri
    const groupIds = new Set(
      unitGroups
        .filter((g) => g.key.startsWith("u"))
        .map((g) => Number(g.key.slice(1))),
    );
    const trendPlanRows = aylarAsc.length
      ? await db.select().from(unitPlans).where(inArray(unitPlans.month, aylarAsc))
      : [];
    const planByMonth = new Map<string, number>();
    const planByUnitMonth = new Map<string, number>();
    for (const r of trendPlanRows) {
      const top = topOf(r.unitId);
      if (!top || !groupIds.has(top.id)) continue;
      planByMonth.set(r.month, (planByMonth.get(r.month) ?? 0) + Number(r.amount));
      const k = `${top.id}|${r.month}`;
      planByUnitMonth.set(k, (planByUnitMonth.get(k) ?? 0) + Number(r.amount));
    }

    const monthlyTotal = new Map<string, number>();
    const monthlyByGroup = new Map<number, Map<string, number>>();
    for (const r of sahaMonthRows) {
      const amt = Number(r.totalAmount);
      monthlyTotal.set(r.month!, (monthlyTotal.get(r.month!) ?? 0) + amt);
      const top = r.unitId !== null ? topOf(r.unitId) : null;
      if (top) {
        const m = monthlyByGroup.get(top.id) ?? new Map<string, number>();
        m.set(r.month!, (m.get(r.month!) ?? 0) + amt);
        monthlyByGroup.set(top.id, m);
      }
    }
    const monthly: MonthPoint[] = aylarAsc.map((ay) => ({
      ay,
      amount: monthlyTotal.get(ay) ?? 0,
      plan: planByMonth.get(ay) ?? 0,
    }));

    const dashUnits: BagisDashUnit[] = unitGroups.map((g) => {
      const id = g.key.startsWith("u") ? Number(g.key.slice(1)) : null;
      return {
        key: g.key,
        label: g.label,
        bolgeLabel: g.bolgeLabel,
        amount: g.amount,
        count: g.count,
        plan: g.plan,
        children: g.children.map((c) => ({
          label: c.label,
          amount: c.amount,
          count: c.count,
          plan: c.plan,
        })),
        monthly: aylarAsc.map((ay) => ({
          ay,
          amount: id !== null ? (monthlyByGroup.get(id)?.get(ay) ?? 0) : 0,
          plan: id !== null ? (planByUnitMonth.get(`${id}|${ay}`) ?? 0) : 0,
        })),
      };
    });

    const headerLabel =
      user.role === "BOLGE_MUDURU"
        ? `${scope.bolgeLabels[0] ?? ""} · Saha Görünümü`
        : dashUnits.length === 1
          ? `${dashUnits[0].label} Temsilciliği`
          : "Temsilcilik Görünümü";
    const exportQs = new URLSearchParams({ ayA, ayB });
    if (sart) exportQs.set("sart", sart);
    return (
      <BagisDashboard
        headerLabel={headerLabel}
        updatedAt={fmtTime(run.finishedAt)}
        ayA={ayA}
        ayB={ayB}
        ayLabel={ayLabel}
        exportUrl={`/api/export/bagis?${exportQs}`}
        units={dashUnits}
        monthly={monthly}
      />
    );
  }

  // toplam satırı yalnız numaralı bölgeleri sayar (DİĞER/BELİRTİLMEMİŞ hariç)
  const numbered = bolgeRows.filter((r) => /^\d+\./.test(r.bolgeLabel));
  const toplamGelir = numbered.reduce((s, r) => s + Number(r.totalAmount), 0);
  const toplamAdet = numbered.reduce((s, r) => s + r.donationCount, 0);
  const toplamPlan = numbered.reduce(
    (s, r) => s + (planByBolge.get(r.bolgeLabel) ?? 0),
    0,
  );

  // Birime/bölgeye eşlenmeyen bağışlar (BELİRTİLMEMİŞ vb.): portalda birim
  // seçilmeden girilen kayıtlar. Yalnız admin kartlarında genel toplama katılır.
  const unnumbered = bolgeRows.filter((r) => !/^\d+\./.test(r.bolgeLabel));
  const birimsizGelir = unnumbered.reduce((s, r) => s + Number(r.totalAmount), 0);
  const birimsizAdet = unnumbered.reduce((s, r) => s + r.donationCount, 0);

  const scopeGelir = scope.all
    ? toplamGelir + birimsizGelir
    : unitRows.reduce((s, r) => s + Number(r.totalAmount), 0);
  const scopeAdet = scope.all
    ? toplamAdet + birimsizAdet
    : unitRows.reduce((s, r) => s + r.donationCount, 0);

  const seciliBolgeler = scope.all
    ? [...new Set(aggRows.filter((r) => r.scope === "unit").map((r) => r.bolgeLabel))].sort(
        (a, b) => bolgeOrder(a) - bolgeOrder(b),
      )
    : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary-dark">
            {scope.all ? "Bağış Raporu" : "Genel Bağış Raporu"}
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            {sartlar.length > 0 && scope.all ? `${sart ?? "Tüm şartlar"} · ` : ""}
            {aylar.length > 0 ? ayLabel : `${p.dateA} – ${p.dateB} dönemi`} ·{" "}
            {fmtTime(run.finishedAt)} tarihinde güncellendi
          </p>
        </div>
        <a
          href={`/api/export/bagis?ayA=${encodeURIComponent(ayA)}&ayB=${encodeURIComponent(ayB)}${sart ? `&sart=${encodeURIComponent(sart)}` : ""}`}
          className="rounded-lg border border-primary px-3 py-1.5 text-sm text-primary transition hover:bg-primary hover:text-white"
        >
          ⬇ Excel
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {aylar.length > 0 && (
          <form
            method="GET"
            className="flex w-full flex-wrap items-center gap-2 text-sm sm:w-auto"
          >
            {sart && <input type="hidden" name="sart" value={sart} />}
            <label htmlFor="ayA" className="shrink-0">
              Aylar
            </label>
            <input
              id="ayA"
              name="ayA"
              type="month"
              defaultValue={ayA}
              className="w-36 min-w-0 max-w-full rounded-lg border border-mint bg-white px-2 py-1"
            />
            <span className="shrink-0 text-ink/50">–</span>
            <input
              name="ayB"
              type="month"
              defaultValue={ayB}
              className="w-36 min-w-0 max-w-full rounded-lg border border-mint bg-white px-2 py-1"
            />
            <button className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-white">
              Getir
            </button>
          </form>
        )}
        {sartlar.length > 0 && scope.all && (
          <div className="flex flex-wrap gap-2 text-sm">
            {[null, ...sartlar].map((s) => {
              const qs = new URLSearchParams();
              if (s) qs.set("sart", s);
              if (aylar.length) {
                qs.set("ayA", ayA);
                qs.set("ayB", ayB);
              }
              if (sp.bolge) qs.set("bolge", sp.bolge);
              const href = qs.size ? `/bagis?${qs}` : "/bagis";
              const seçili = s === sart;
              return (
                <a
                  key={s ?? "tumu"}
                  href={href}
                  className={
                    seçili
                      ? "rounded-full bg-primary px-4 py-1.5 font-semibold text-white"
                      : "rounded-full bg-white px-4 py-1.5 text-ink/70 shadow-sm transition hover:bg-mint"
                  }
                >
                  {s ?? "Tümü"}
                </a>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-ink/60">
            {scope.all ? "Toplam Gelir" : "Sorumluluk Alanı Geliri"}
          </p>
          <p className="mt-1 text-2xl font-semibold text-primary-dark">
            {trMoney(scopeGelir)}
          </p>
          {scope.all && birimsizGelir > 0 && (
            <p className="mt-1 text-xs text-ink/60">
              Bölgeler: {trMoney(toplamGelir)} · Belirtilmemiş: {trMoney(birimsizGelir)}
            </p>
          )}
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-ink/60">Bağış Adedi</p>
          <p className="mt-1 text-2xl font-semibold text-primary-dark">{scopeAdet}</p>
          {scope.all && birimsizAdet > 0 && (
            <p className="mt-1 text-xs text-ink/60">
              Bölgeler: {toplamAdet} · Belirtilmemiş: {birimsizAdet}
            </p>
          )}
        </div>
        {scope.all && planVisible && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-xs text-ink/60">Plan ({ayLabel})</p>
            <p className="mt-1 text-2xl font-semibold text-primary-dark">
              {toplamPlan > 0 ? trMoney(toplamPlan) : "—"}
            </p>
            {toplamPlan > 0 && (
              <p className="mt-1 text-xs">{oranBadge(toplamGelir / toplamPlan)}</p>
            )}
          </div>
        )}
        {!scope.all && planVisible && scopePlan > 0 && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-xs text-ink/60">Plan ({ayLabel})</p>
            <p className="mt-1 text-2xl font-semibold text-primary-dark">
              {trMoney(scopePlan)}
            </p>
            <p className="mt-1 text-xs">{oranBadge(scopeGelir / scopePlan)}</p>
          </div>
        )}
      </div>

      {(scope.all || user.role === "BOLGE_MUDURU") && bolgeRows.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold">Bölge Özeti</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary text-left text-white">
                  <th className="px-4 py-2.5 font-medium">Sıra</th>
                  <th className="px-4 py-2.5 font-medium">Bölge</th>
                  {planVisible && <th className="px-4 py-2.5 font-medium">Aylık Plan</th>}
                  <th className="px-4 py-2.5 font-medium">Gerçekleşen</th>
                  {planVisible && <th className="px-4 py-2.5 font-medium">Oran</th>}
                  <th className="px-4 py-2.5 font-medium">Adet</th>
                </tr>
              </thead>
              <tbody>
                {bolgeRows.map((r, i) => {
                  const plan = planByBolge.get(r.bolgeLabel) ?? null;
                  const gelir = Number(r.totalAmount);
                  const qs = new URLSearchParams({ bolge: r.bolgeLabel });
                  if (sart) qs.set("sart", sart);
                  if (aylar.length) {
                    qs.set("ayA", ayA);
                    qs.set("ayB", ayB);
                  }
                  return (
                    <tr key={r.bolgeLabel} className={i % 2 ? "bg-cream/60" : ""}>
                      <td className="px-4 py-2 text-ink/50">{i + 1}</td>
                      <td className="px-4 py-2">
                        {scope.all ? (
                          <a
                            href={`/bagis?${qs}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {r.bolgeLabel}
                          </a>
                        ) : (
                          <span className="font-medium">{r.bolgeLabel}</span>
                        )}
                      </td>
                      {planVisible && (
                        <td className="px-4 py-2">{plan ? trMoney(plan) : "—"}</td>
                      )}
                      <td className="px-4 py-2">{trMoney(gelir)}</td>
                      {planVisible && (
                        <td className="px-4 py-2">
                          {oranBadge(plan && plan > 0 ? gelir / plan : null)}
                        </td>
                      )}
                      <td className="px-4 py-2">{r.donationCount}</td>
                    </tr>
                  );
                })}
                {scope.all && (
                  <tr className="border-t-2 border-mint bg-mint/30 font-semibold">
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2">Genel Toplam</td>
                    {planVisible && (
                      <td className="px-4 py-2">
                        {toplamPlan > 0 ? trMoney(toplamPlan) : "—"}
                      </td>
                    )}
                    <td className="px-4 py-2">{trMoney(toplamGelir + birimsizGelir)}</td>
                    {planVisible && <td className="px-4 py-2" />}
                    <td className="px-4 py-2">{toplamAdet + birimsizAdet}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">
            Birim Dağılımı{sp.bolge ? ` — ${sp.bolge}` : ""}
          </h2>
          {scope.all && (
            <form method="GET" className="flex items-center gap-2 text-sm">
              {sart && <input type="hidden" name="sart" value={sart} />}
              {aylar.length > 0 && (
                <>
                  <input type="hidden" name="ayA" value={ayA} />
                  <input type="hidden" name="ayB" value={ayB} />
                </>
              )}
              <select
                name="bolge"
                defaultValue={sp.bolge ?? ""}
                className="rounded-lg border border-mint px-2 py-1"
              >
                <option value="">Tüm bölgeler</option>
                {seciliBolgeler.map((b) => (
                  <option key={b} value={b}>
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
          <UnitTable
            groups={unitGroups}
            planVisible={planVisible}
            defaultOpen={user.role === "TEMSILCI"}
          />
        </div>
        <p className="mt-2 text-xs text-ink/50">
          İl satırları ilçe kırılımlarını da kapsar; satıra tıklayınca kırılım açılır.
          &quot;… Merkez&quot; satırları bölge müdürlüğü üzerinden kabul edilen bağışlardır.
        </p>
      </section>
    </div>
  );
}
