/** Sunucu başlangıcında bir kez çalışır (Next.js instrumentation hook). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DATABASE_URL) {
    const { recoverStaleRuns } = await import("@/lib/jobs/runner");
    try {
      await recoverStaleRuns();
    } catch {
      // DB henüz hazır değilse boot'u engelleme; healthcheck zaten yakalar
    }
  }
}
