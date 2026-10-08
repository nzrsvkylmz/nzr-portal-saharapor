/**
 * Rapor işi çalıştırıcısı. Route handler iş kaydını açar, işi AYNI Node
 * prosesinde async yürütür (Railway kalıcı proses — tek replika varsayımı),
 * UI /api/jobs/:id ile poll eder. Tek-iş kilidi: report_runs üzerinde
 * partial unique index (one_active_run) — DB düzeyinde garanti.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { reportRuns } from "@/lib/db/schema";
import { LoginRequired, VerifyRequired } from "@/lib/portal/errors";
import { markPortalState } from "@/lib/portal/cookiejar";
import { runYardimJob, type YardimParams } from "./yardim-job";
import { runBagisJob, type BagisParams } from "./bagis-job";

export class RunConflict extends Error {
  constructor() {
    super("Devam eden bir güncelleme var. Bitmesini bekleyin.");
  }
}

export type RunKind = "bagis" | "yardim";

export async function startRun(
  kind: RunKind,
  params: YardimParams | BagisParams,
  userId: string,
  isCron = false,
): Promise<string> {
  let runId: string;
  try {
    const [row] = await db
      .insert(reportRuns)
      .values({ kind, params, triggeredBy: userId, isCron, status: "queued" })
      .returning({ id: reportRuns.id });
    runId = row.id;
  } catch (err) {
    // 23505: one_active_run ihlali → zaten çalışan iş var
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "23505"
    ) {
      throw new RunConflict();
    }
    throw err;
  }

  // Bilinçli olarak await edilmez: istek hemen döner, iş arkada sürer.
  void executeRun(runId, kind, params, userId);
  return runId;
}

export async function updateProgress(
  runId: string,
  pct: number,
  msg: string,
): Promise<void> {
  await db
    .update(reportRuns)
    .set({ status: "running", progressPct: pct, progressMsg: msg })
    .where(eq(reportRuns.id, runId));
}

async function executeRun(
  runId: string,
  kind: RunKind,
  params: YardimParams | BagisParams,
  userId: string,
): Promise<void> {
  const progress = (pct: number, msg: string) => updateProgress(runId, pct, msg);
  try {
    const rowCount =
      kind === "yardim"
        ? await runYardimJob(runId, userId, params as YardimParams, progress)
        : await runBagisJob(runId, userId, params as BagisParams, progress);
    await db
      .update(reportRuns)
      .set({
        status: "done",
        progressPct: 100,
        progressMsg: "Tamamlandı",
        rowCount,
        finishedAt: new Date(),
      })
      .where(eq(reportRuns.id, runId));
  } catch (err) {
    let message = err instanceof Error ? err.message : String(err);
    if (err instanceof LoginRequired || err instanceof VerifyRequired) {
      await markPortalState(userId, err instanceof LoginRequired ? "login" : "verify");
      message += " — Çıkış yapıp portal kimliğinizle yeniden giriş yapın.";
    }
    await db
      .update(reportRuns)
      .set({ status: "error", error: message.slice(0, 1000), finishedAt: new Date() })
      .where(eq(reportRuns.id, runId));
  }
}

/** Boot'ta yarım kalmış işleri kapat (sunucu yeniden başlamış demektir). */
export async function recoverStaleRuns(): Promise<void> {
  await db
    .update(reportRuns)
    .set({
      status: "error",
      error: "Sunucu yeniden başladı; güncellemeyi tekrar tetikleyin.",
      finishedAt: new Date(),
    })
    .where(inArray(reportRuns.status, ["queued", "running"]));
}
