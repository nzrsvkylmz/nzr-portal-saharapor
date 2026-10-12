import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { canViewBagis, requireActiveUser } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { bagisAggregates, plans, reportRuns, unitPlans, units } from "@/lib/db/schema";
import { visibleScope } from "@/lib/domain/scope";
import { trDateToMonth } from "@/lib/domain/normalize";
import {
  monthList,
  monthsInRange,
  rowsForMonthRange,
  rowsForSart,
  sartList,
} from "@/lib/domain/bagis-view";
import type { BagisParams } from "@/lib/jobs/bagis-job";
import type { UnitChildRow, UnitGroupRow } from "./UnitTable";
import BagisDashboard, {
  type BagisBolge,
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
      if (scope.all) return true; // yönetici: bölge seçimi dashboard'da yapılır
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
        ? true
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

  // Dashboard verisi (saha + yönetici): depodaki TÜM ayların kapsam içi
  // satırlarından aylık trendler ve birim bazlı seriler.
  const dashMonthRows = allAggRows.filter((r) => {
    if (r.scope !== "unit" || r.month === null) return false;
    if (sart && r.activity !== sart) return false;
    if (scope.all) return true;
    if (user.role === "BOLGE_MUDURU") return scope.bolgeLabels.includes(r.bolgeLabel);
    return (
      (r.unitId !== null && scope.unitIds.includes(r.unitId)) ||
      scope.unitLabels.includes(r.unitLabel ?? "")
    );
  });
  const aylarAsc = [...new Set(dashMonthRows.map((r) => r.month!))].sort();

  // kapsamdaki üst (il) birimler ve tüm ayların birim plan hedefleri
  const groupIds = new Set(
    unitGroups
      .filter((g) => g.key.startsWith("u"))
      .map((g) => Number(g.key.slice(1))),
  );
  const trendPlanRows = aylarAsc.length
    ? await db.select().from(unitPlans).where(inArray(unitPlans.month, aylarAsc))
    : [];
  const unitPlanByMonth = new Map<string, number>();
  const planByUnitMonth = new Map<string, number>();
  for (const r of trendPlanRows) {
    const top = topOf(r.unitId);
    if (!top || !groupIds.has(top.id)) continue;
    unitPlanByMonth.set(r.month, (unitPlanByMonth.get(r.month) ?? 0) + Number(r.amount));
    const k = `${top.id}|${r.month}`;
    planByUnitMonth.set(k, (planByUnitMonth.get(k) ?? 0) + Number(r.amount));
  }

  const monthlyTotal = new Map<string, number>();
  const monthlyByGroup = new Map<number, Map<string, number>>();
  for (const r of dashMonthRows) {
    const amt = Number(r.totalAmount);
    monthlyTotal.set(r.month!, (monthlyTotal.get(r.month!) ?? 0) + amt);
    const top = r.unitId !== null ? topOf(r.unitId) : null;
    if (top) {
      const m = monthlyByGroup.get(top.id) ?? new Map<string, number>();
      m.set(r.month!, (m.get(r.month!) ?? 0) + amt);
      monthlyByGroup.set(top.id, m);
    }
  }

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

  const exportQs = new URLSearchParams({ ayA, ayB });
  if (sart) exportQs.set("sart", sart);
  const exportUrl = `/api/export/bagis?${exportQs}`;
  const updatedAt = fmtTime(run.finishedAt);

  // Saha rolleri (bölge müdürü / temsilci): kendi kapsamının dashboard'u
  if (!scope.all) {
    const monthly: MonthPoint[] = aylarAsc.map((ay) => ({
      ay,
      amount: monthlyTotal.get(ay) ?? 0,
      plan: unitPlanByMonth.get(ay) ?? 0,
    }));
    const headerLabel =
      user.role === "BOLGE_MUDURU"
        ? `${scope.bolgeLabels[0] ?? ""} · Saha Görünümü`
        : dashUnits.length === 1
          ? `${dashUnits[0].label} Temsilciliği`
          : "Temsilcilik Görünümü";
    return (
      <BagisDashboard
        headerLabel={headerLabel}
        updatedAt={updatedAt}
        ayA={ayA}
        ayB={ayB}
        ayLabel={ayLabel}
        exportUrl={exportUrl}
        units={dashUnits}
        monthly={monthly}
      />
    );
  }

  // ---- Yönetici dashboard'u: bölge kartları → il drill-down ----
  const numbered = bolgeRows.filter((r) => /^\d+\./.test(r.bolgeLabel));
  // Birime/bölgeye eşlenmeyen bağışlar (BELİRTİLMEMİŞ vb.): portalda birim
  // seçilmeden girilen kayıtlar. Yalnız genel toplam kartında gösterilir.
  const unnumbered = bolgeRows.filter((r) => !/^\d+\./.test(r.bolgeLabel));
  const birimsizGelir = unnumbered.reduce((s, r) => s + Number(r.totalAmount), 0);
  const birimsizAdet = unnumbered.reduce((s, r) => s + r.donationCount, 0);

  // bölge bazlı aylık trend (depodaki tüm aylar) + bölge plan hedefleri
  const bolgeMonthRows = allAggRows.filter(
    (r) =>
      r.scope === "bolge" &&
      r.month !== null &&
      (!sart || r.activity === sart) &&
      /^\d+\./.test(r.bolgeLabel),
  );
  const bolgeAylik = new Map<string, Map<string, number>>();
  for (const r of bolgeMonthRows) {
    const m = bolgeAylik.get(r.bolgeLabel) ?? new Map<string, number>();
    m.set(r.month!, (m.get(r.month!) ?? 0) + Number(r.totalAmount));
    bolgeAylik.set(r.bolgeLabel, m);
  }
  const bolgePlanRows =
    planVisible && aylarAsc.length
      ? await db.select().from(plans).where(inArray(plans.month, aylarAsc))
      : [];
  const bolgePlanAy = new Map<string, number>();
  const planAyToplam = new Map<string, number>();
  for (const r of bolgePlanRows) {
    const k = `${r.bolgeLabel}|${r.month}`;
    bolgePlanAy.set(k, (bolgePlanAy.get(k) ?? 0) + Number(r.amount));
    planAyToplam.set(r.month, (planAyToplam.get(r.month) ?? 0) + Number(r.amount));
  }

  const adminBolgeler: BagisBolge[] = numbered.map((r) => ({
    label: r.bolgeLabel,
    amount: Number(r.totalAmount),
    count: r.donationCount,
    plan: planVisible ? (planByBolge.get(r.bolgeLabel) ?? null) : null,
    monthly: aylarAsc.map((ay) => ({
      ay,
      amount: bolgeAylik.get(r.bolgeLabel)?.get(ay) ?? 0,
      plan: planVisible ? (bolgePlanAy.get(`${r.bolgeLabel}|${ay}`) ?? 0) : 0,
    })),
  }));

  const adminMonthly: MonthPoint[] = aylarAsc.map((ay) => ({
    ay,
    amount: [...bolgeAylik.values()].reduce((s, m) => s + (m.get(ay) ?? 0), 0),
    plan: planVisible ? (planAyToplam.get(ay) ?? 0) : 0,
  }));

  return (
    <BagisDashboard
      headerLabel="Genel Görünüm · Tüm Bölgeler"
      updatedAt={updatedAt}
      ayA={ayA}
      ayB={ayB}
      ayLabel={ayLabel}
      exportUrl={exportUrl}
      units={dashUnits}
      monthly={adminMonthly}
      admin={{
        bolgeler: adminBolgeler,
        sartlar,
        sart,
        planVisible,
        belirtilmemisGelir: birimsizGelir,
        belirtilmemisAdet: birimsizAdet,
      }}
    />
  );
}
