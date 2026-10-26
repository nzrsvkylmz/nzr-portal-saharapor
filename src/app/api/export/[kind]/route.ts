import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  bagisAggregates,
  plans,
  reportRuns,
  unitPlans,
  units,
  yardimAggregates,
} from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { canViewBagis, canViewYardim } from "@/lib/auth/dal";
import { visibleScope } from "@/lib/domain/scope";
import {
  monthList,
  monthsInRange,
  rowsForMonthRange,
  rowsForSart,
  sartList,
} from "@/lib/domain/bagis-view";
import { trDateToMonth } from "@/lib/domain/normalize";
import { KRITIK_STAGE_KEYS, STAGE_KEYS } from "@/lib/domain/yardim-stages";
import {
  buildBagisXlsx,
  buildYardimXlsx,
  type BagisExcelRow,
  type YardimExcelRow,
} from "@/lib/excel";
import type { BagisParams } from "@/lib/jobs/bagis-job";

/** Scope'lu Excel export — veri, isteyen kullanıcının kapsamına göre üretilir. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  const user = await getSessionUser();
  if (!user || user.status !== "active" || !user.role) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }
  if (kind === "bagis" && !canViewBagis(user)) {
    return NextResponse.json({ error: "Bağış raporuna erişiminiz yok." }, { status: 403 });
  }
  if (kind === "yardim" && !canViewYardim(user)) {
    return NextResponse.json({ error: "Yardım raporuna erişiminiz yok." }, { status: 403 });
  }
  const scope = await visibleScope(user, kind === "bagis" ? "bagis" : "yardim");
  const esik = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("esik")) || 60));
  // dashboard'daki bölge seçimi (drill-down) exporta da uygulanır
  const bolgeParam = (req.nextUrl.searchParams.get("bolge") ?? "").trim();

  if (kind === "bagis") {
    const run = await db.query.reportRuns.findFirst({
      where: and(eq(reportRuns.kind, "bagis"), eq(reportRuns.status, "done")),
      orderBy: desc(reportRuns.finishedAt),
    });
    if (!run) return NextResponse.json({ error: "Rapor yok." }, { status: 404 });
    const p = run.params as unknown as BagisParams;
    // kalıcı aylık depo: run'dan bağımsız okunur
    const allAggRows = await db.select().from(bagisAggregates);
    // ay aralığı + şart filtresi sayfadakiyle aynı
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const ayRx = /^\d{4}-\d{2}$/;
    const aylar = monthList(allAggRows);
    const fallback = aylar.length
      ? currentMonth
      : (trDateToMonth(p.dateA ?? "") ?? currentMonth);
    const ayAParam = req.nextUrl.searchParams.get("ayA") ?? "";
    const ayBParam = req.nextUrl.searchParams.get("ayB") ?? "";
    let ayA = ayRx.test(ayAParam) ? ayAParam : fallback;
    let ayB = ayRx.test(ayBParam) ? ayBParam : ayA;
    if (ayA > ayB) [ayA, ayB] = [ayB, ayA];
    const ayLabel = ayA === ayB ? `${ayA} ayı` : `${ayA} – ${ayB}`;
    const monthRows = rowsForMonthRange(allAggRows, ayA, ayB);
    const sartlar = sartList(allAggRows);
    const sartParam = req.nextUrl.searchParams.get("sart") ?? "";
    let sart = sartlar.includes(sartParam) ? sartParam : null;
    // saha rollerinin varsayılanı Genel Bağış; seçtikleri şartı indirebilirler
    // ("Tümü" yok — sayfadaki kuralla aynı)
    if (!scope.all && !sart && sartlar.includes("Genel Bağış")) sart = "Genel Bağış";
    const sartRows = rowsForSart(monthRows, sart);
    const aggRows = bolgeParam
      ? sartRows.filter((r) => r.bolgeLabel === bolgeParam)
      : sartRows;
    const planMonths = monthsInRange(ayA, ayB);
    const planRows = planMonths.length
      ? await db.select().from(plans).where(inArray(plans.month, planMonths))
      : [];
    const planByBolge = new Map<string, number>();
    for (const r of planRows) {
      planByBolge.set(
        r.bolgeLabel,
        (planByBolge.get(r.bolgeLabel) ?? 0) + Number(r.amount),
      );
    }

    // plan hedefleri Genel Bağış içindir (şart kırılımı olmayan eski snapshot hariç)
    const includePlan = sart === "Genel Bağış" || sartlar.length === 0;

    // il temsilciliği plan hedefleri (aralık toplamı)
    const unitPlanRows = planMonths.length
      ? await db.select().from(unitPlans).where(inArray(unitPlans.month, planMonths))
      : [];
    const planByUnit = new Map<number, number>();
    for (const r of unitPlanRows) {
      planByUnit.set(r.unitId, (planByUnit.get(r.unitId) ?? 0) + Number(r.amount));
    }

    // il–ilçe hiyerarşisi: sayfadaki Birim Dağılımı ile aynı gruplama
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

    const unitAggRows = aggRows.filter((r) => {
      if (r.scope !== "unit") return false;
      if (scope.all) return true;
      if (user.role === "BOLGE_MUDURU") return scope.bolgeLabels.includes(r.bolgeLabel);
      return (
        (r.unitId !== null && scope.unitIds.includes(r.unitId)) ||
        scope.unitLabels.includes(r.unitLabel ?? "")
      );
    });

    interface Grup {
      bolge: string;
      label: string;
      amount: number;
      count: number;
      plan: number | null;
      own: { amount: number; count: number } | null;
      children: { label: string; amount: number; count: number; plan: number | null }[];
    }
    const groupMap = new Map<string, Grup>();
    for (const r of unitAggRows) {
      const amount = Number(r.totalAmount);
      const top = r.unitId !== null ? topOf(r.unitId) : null;
      const key = top ? `u${top.id}` : `l|${r.bolgeLabel}|${r.unitLabel ?? ""}`;
      let g = groupMap.get(key);
      if (!g) {
        g = {
          bolge: r.bolgeLabel,
          label: top ? top.name : (r.unitLabel ?? "—"),
          amount: 0,
          count: 0,
          plan: top ? (planByUnit.get(top.id) ?? null) : null,
          own: null,
          children: [],
        };
        groupMap.set(key, g);
      }
      g.amount += amount;
      g.count += r.donationCount;
      if (top && top.id !== r.unitId) {
        const childPlan = r.unitId !== null ? (planByUnit.get(r.unitId) ?? null) : null;
        if (childPlan) g.plan = (g.plan ?? 0) + childPlan;
        g.children.push({
          label: r.unitLabel ?? "—",
          amount,
          count: r.donationCount,
          plan: childPlan,
        });
      } else {
        g.own = { amount, count: r.donationCount };
      }
    }
    // planı olup bağışı olmayan iller de %0 ile listelenir (kapsam içi)
    if (includePlan) {
      for (const [unitId, plan] of planByUnit) {
        if (plan <= 0 || groupMap.has(`u${unitId}`)) continue;
        const u = unitById.get(unitId);
        if (!u || !u.active || topOf(unitId)?.id !== unitId) continue;
        if (bolgeParam && u.bolgeLabel !== bolgeParam) continue;
        const visible = scope.all
          ? true
          : user.role === "BOLGE_MUDURU"
            ? u.bolgeLabel !== null && scope.bolgeLabels.includes(u.bolgeLabel)
            : scope.unitIds.includes(unitId);
        if (!visible) continue;
        groupMap.set(`u${unitId}`, {
          bolge: u.bolgeLabel ?? "—",
          label: u.name,
          amount: 0,
          count: 0,
          plan,
          own: null,
          children: [],
        });
      }
    }

    // bölge özet satırları: admin hepsi, bölge müdürü kendi bölgesi
    const bolgeAggRows = aggRows.filter(
      (r) =>
        r.scope === "bolge" &&
        (scope.all ||
          (user.role === "BOLGE_MUDURU" && scope.bolgeLabels.includes(r.bolgeLabel))),
    );

    const n = (l: string) => Number(/^(\d+)/.exec(l)?.[1]) || 900;
    const bolgeSirali = [
      ...new Set([
        ...bolgeAggRows.map((r) => r.bolgeLabel),
        ...[...groupMap.values()].map((g) => g.bolge),
      ]),
    ].sort((a, b) => n(a) - n(b) || a.localeCompare(b, "tr"));
    const bolgeAggByLabel = new Map(bolgeAggRows.map((r) => [r.bolgeLabel, r]));

    // ağaç kırılımı: bölge satırı → iller (birleşik toplam) → ilçeler
    const rows: BagisExcelRow[] = [];
    for (const bolge of bolgeSirali) {
      const bAgg = bolgeAggByLabel.get(bolge);
      if (bAgg) {
        rows.push({
          seviye: "bolge",
          bolge,
          birim: null,
          plan: includePlan ? (planByBolge.get(bolge) ?? null) : null,
          gelir: Number(bAgg.totalAmount),
          adet: bAgg.donationCount,
        });
      }
      const gruplar = [...groupMap.values()]
        .filter((g) => g.bolge === bolge)
        .sort((a, b) => b.amount - a.amount);
      for (const g of gruplar) {
        rows.push({
          seviye: "il",
          bolge,
          birim: g.label,
          plan: includePlan ? g.plan : null,
          gelir: g.amount,
          adet: g.count,
        });
        const children = [...g.children].sort((a, b) => b.amount - a.amount);
        if (g.own && children.length > 0) {
          children.unshift({
            label: `${g.label} (il geneli)`,
            amount: g.own.amount,
            count: g.own.count,
            plan: null,
          });
        }
        for (const c of children) {
          rows.push({
            seviye: "ilce",
            bolge,
            birim: c.label,
            plan: includePlan ? c.plan : null,
            gelir: c.amount,
            adet: c.count,
          });
        }
      }
    }

    const buf = await buildBagisXlsx(
      `Bağış Raporu — ${bolgeParam ? `${bolgeParam} — ` : ""}${sart ? `${sart} — ` : ""}${aylar.length ? ayLabel : `${p.dateA} – ${p.dateB}`}`,
      rows,
      includePlan,
    );
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="bagis_raporu_${p.dateA.replace(/\./g, "-")}_${p.dateB.replace(/\./g, "-")}.xlsx"`,
      },
    });
  }

  if (kind === "yardim") {
    const run = await db.query.reportRuns.findFirst({
      where: and(eq(reportRuns.kind, "yardim"), eq(reportRuns.status, "done")),
      orderBy: desc(reportRuns.finishedAt),
    });
    if (!run) return NextResponse.json({ error: "Rapor yok." }, { status: 404 });
    const aggRows = await db
      .select()
      .from(yardimAggregates)
      .where(eq(yardimAggregates.runId, run.id));

    const visible = aggRows.filter((r) => {
      if (bolgeParam && r.bolgeLabel !== bolgeParam) return false; // bölge seçimi
      if (r.scope === "unmatched") return scope.all;
      if (r.scope === "bolge") return scope.all;
      if (scope.all) return true;
      return (
        (r.unitId !== null && scope.unitIds.includes(r.unitId)) ||
        scope.unitLabels.includes(r.unitLabel ?? "")
      );
    });

    // bölge|birim → aşama bazlı gün birleşimi
    const merged = new Map<
      string,
      { bolge: string; birim: string | null; days: Map<string, number[]> }
    >();
    for (const r of visible) {
      if (!STAGE_KEYS.includes(r.stageKey)) continue; // bilinmeyen/eski aşama
      const key =
        r.scope === "bolge"
          ? `B|${r.bolgeLabel}`
          : `U|${r.bolgeLabel ?? "EŞLENMEYEN"}|${r.unitLabel}`;
      const cur = merged.get(key) ?? {
        bolge: r.bolgeLabel ?? "EŞLENMEYEN",
        birim: r.scope === "bolge" ? null : (r.unitLabel ?? null),
        days: new Map<string, number[]>(),
      };
      const days = (r.days as number[]) ?? [];
      cur.days.set(r.stageKey, [...(cur.days.get(r.stageKey) ?? []), ...days]);
      merged.set(key, cur);
    }

    const aralik = (d: number[]) => {
      const v = d.filter((x) => x >= 0);
      if (!v.length) return "—";
      const min = Math.min(...v);
      const max = Math.max(...v);
      return min === max ? `${min}` : `${min}–${max}`;
    };
    const n = (l: string) => Number(/^(\d+)/.exec(l)?.[1]) || 900;
    const rows: YardimExcelRow[] = [...merged.values()]
      .sort(
        (a, b) =>
          n(a.bolge) - n(b.bolge) ||
          (a.birim === null ? -1 : 1) - (b.birim === null ? -1 : 1) ||
          (a.birim ?? "").localeCompare(b.birim ?? "", "tr"),
      )
      .map((m) => ({
        bolge: m.bolge,
        birim: m.birim,
        stages: STAGE_KEYS.map((k) => {
          const d = m.days.get(k) ?? [];
          return { adet: d.length, aralik: aralik(d) };
        }),
        // kritik yalnız Sİ+BK günlerinden hesaplanır (rapor sayfasıyla aynı kural)
        kritik: KRITIK_STAGE_KEYS.flatMap((k) => m.days.get(k) ?? []).filter(
          (d) => d > esik,
        ).length,
      }));

    const buf = await buildYardimXlsx(
      `Yardım Raporu — ${bolgeParam ? `${bolgeParam} — ` : ""}kritik eşik ${esik} gün — ${new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeZone: "Europe/Istanbul" }).format(run.finishedAt ?? new Date())}`,
      rows,
    );
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="yardim_raporu.xlsx"`,
      },
    });
  }

  return NextResponse.json({ error: "Bilinmeyen rapor türü." }, { status: 404 });
}
