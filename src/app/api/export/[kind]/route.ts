import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { bagisAggregates, plans, reportRuns, yardimAggregates } from "@/lib/db/schema";
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
import { buildBagisXlsx, buildYardimXlsx, type YardimExcelRow } from "@/lib/excel";
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
  const esik = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("esik")) || 90));

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
    // saha rolleri yalnız Genel Bağış indirir (sayfadaki kuralla aynı)
    if (!scope.all && sartlar.includes("Genel Bağış")) sart = "Genel Bağış";
    const aggRows = rowsForSart(monthRows, sart);
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
    const includePlan = scope.all && (sart === "Genel Bağış" || sartlar.length === 0);
    const rows = aggRows
      .filter((r) => {
        if (scope.all) return r.scope === "bolge" || r.scope === "unit";
        if (r.scope === "bolge") return false;
        return (
          (r.unitId !== null && scope.unitIds.includes(r.unitId)) ||
          scope.unitLabels.includes(r.unitLabel ?? "") ||
          (user.role === "BOLGE_MUDURU" && scope.bolgeLabels.includes(r.bolgeLabel))
        );
      })
      .sort((a, b) => {
        const n = (l: string) => Number(/^(\d+)/.exec(l)?.[1]) || 900;
        return (
          n(a.bolgeLabel) - n(b.bolgeLabel) ||
          (a.scope === "bolge" ? -1 : 1) - (b.scope === "bolge" ? -1 : 1) ||
          Number(b.totalAmount) - Number(a.totalAmount)
        );
      })
      .map((r) => ({
        bolge: r.bolgeLabel,
        birim: r.scope === "bolge" ? null : r.unitLabel,
        plan: r.scope === "bolge" ? (planByBolge.get(r.bolgeLabel) ?? null) : null,
        gelir: Number(r.totalAmount),
        adet: r.donationCount,
      }));

    const buf = await buildBagisXlsx(
      `Bağış Raporu — ${sart ? `${sart} — ` : ""}${aylar.length ? ayLabel : `${p.dateA} – ${p.dateB}`}`,
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
      if (r.scope === "unmatched") return scope.all;
      if (r.scope === "bolge") return scope.all;
      if (scope.all) return true;
      return (
        (r.unitId !== null && scope.unitIds.includes(r.unitId)) ||
        scope.unitLabels.includes(r.unitLabel ?? "")
      );
    });

    // bölge|birim → si/bk birleşimi
    const merged = new Map<
      string,
      { bolge: string; birim: string | null; si: number[]; bk: number[] }
    >();
    for (const r of visible) {
      const key =
        r.scope === "bolge"
          ? `B|${r.bolgeLabel}`
          : `U|${r.bolgeLabel ?? "EŞLENMEYEN"}|${r.unitLabel}`;
      const cur = merged.get(key) ?? {
        bolge: r.bolgeLabel ?? "EŞLENMEYEN",
        birim: r.scope === "bolge" ? null : (r.unitLabel ?? null),
        si: [],
        bk: [],
      };
      const days = (r.days as number[]) ?? [];
      if (r.stageKey === "si") cur.si.push(...days);
      else cur.bk.push(...days);
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
        siAdet: m.si.length,
        siAralik: aralik(m.si),
        bkAdet: m.bk.length,
        bkAralik: aralik(m.bk),
        kritik: [...m.si, ...m.bk].filter((d) => d > esik).length,
      }));

    const buf = await buildYardimXlsx(
      `Yardım Raporu — kritik eşik ${esik} gün — ${new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeZone: "Europe/Istanbul" }).format(run.finishedAt ?? new Date())}`,
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
