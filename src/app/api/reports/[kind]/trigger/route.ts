import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { isAdminBagis, isAdminYardim } from "@/lib/auth/dal";
import { RunConflict, startRun } from "@/lib/jobs/runner";
import { toTrDate } from "@/lib/domain/normalize";

/**
 * Rapor güncelleme tetikleyici. Şimdilik yalnızca oturumlu admin;
 * ileriki fazda CRON_TOKEN'lı servis hesabı da bu route'u çağıracak.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (kind !== "bagis" && kind !== "yardim") {
    return NextResponse.json({ error: "Bilinmeyen rapor türü." }, { status: 404 });
  }

  const user = await getSessionUser();
  if (!user || user.status !== "active" || !user.role) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }
  if (kind === "bagis" && !isAdminBagis(user)) {
    return NextResponse.json({ error: "Bağış raporunu yalnızca muhasebe günceller." }, { status: 403 });
  }
  if (kind === "yardim" && !isAdminYardim(user)) {
    return NextResponse.json(
      { error: "Yardım raporunu yalnızca sosyal yardımlar birimi günceller." },
      { status: 403 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let jobParams;
  if (kind === "bagis") {
    const now = new Date();
    const monthRx = /^\d{4}-(0[1-9]|1[0-2])$/;
    const ayA = String(body.ayA ?? "").trim();
    const ayB = String(body.ayB ?? "").trim();
    let dateA: string;
    let dateB: string;
    if (ayA || ayB) {
      // ay seçimi (UI): aralık tam aylara çevrilir
      if (!monthRx.test(ayA) || !monthRx.test(ayB)) {
        return NextResponse.json(
          { error: "Aylar YYYY-AA biçiminde olmalı." },
          { status: 400 },
        );
      }
      if (ayA > ayB) {
        return NextResponse.json(
          { error: "Başlangıç ayı bitiş ayından sonra olamaz." },
          { status: 400 },
        );
      }
      const [ya, ma] = ayA.split("-").map(Number);
      const [yb, mb] = ayB.split("-").map(Number);
      dateA = toTrDate(new Date(ya, ma - 1, 1));
      dateB = toTrDate(new Date(yb, mb, 0)); // bitiş ayının son günü
    } else {
      // tarih biçimi (API/cron geriye dönük uyumluluk); varsayılan: içinde bulunulan ay
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      dateA = String(body.dateA ?? "").trim() || toTrDate(monthStart);
      dateB = String(body.dateB ?? "").trim() || toTrDate(now);
      if (!/^\d{2}\.\d{2}\.\d{4}$/.test(dateA) || !/^\d{2}\.\d{2}\.\d{4}$/.test(dateB)) {
        return NextResponse.json(
          { error: "Tarihler GG.AA.YYYY biçiminde olmalı." },
          { status: 400 },
        );
      }
    }
    // Varsayılan: Genel Bağış (1) + Sadaka (15), Serbest fon (1)
    jobParams = {
      dateA,
      dateB,
      types: String(body.types ?? "1,2,3,4,5").replace(/[^\d,]/g, "") || "1,2,3,4,5",
      activity: String(body.activity ?? "1,15"),
      pool: String(body.pool ?? "1"),
    };
  } else {
    jobParams = {
      thresholdDays: Number(body.thresholdDays) > 0 ? Number(body.thresholdDays) : 90,
    };
  }

  try {
    const runId = await startRun(kind, jobParams, user.id);
    return NextResponse.json({ runId });
  } catch (err) {
    if (err instanceof RunConflict) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
