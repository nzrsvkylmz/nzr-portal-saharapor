import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { reportRuns } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user || user.status !== "active" || !user.role) {
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  }
  const { id } = await params;
  const run = await db.query.reportRuns.findFirst({ where: eq(reportRuns.id, id) });
  if (!run) return NextResponse.json({ error: "İş bulunamadı." }, { status: 404 });
  return NextResponse.json({
    id: run.id,
    kind: run.kind,
    status: run.status,
    progressPct: run.progressPct,
    progressMsg: run.progressMsg,
    error: run.error,
    rowCount: run.rowCount,
    finishedAt: run.finishedAt,
  });
}
