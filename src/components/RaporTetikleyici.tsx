"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

interface JobStatus {
  status: "queued" | "running" | "done" | "error";
  progressPct: number;
  progressMsg: string | null;
  error: string | null;
  rowCount: number | null;
}

interface Props {
  kind: "bagis" | "yardim";
  title: string;
  children?: React.ReactNode; // form alanları
  buildBody: (form: HTMLFormElement) => Record<string, unknown>;
}

export function RaporTetikleyici({ kind, title, children, buildBody }: Props) {
  const router = useRouter();
  const [runId, setRunId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!runId) return;
    timer.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${runId}`);
        if (!res.ok) return;
        const data: JobStatus = await res.json();
        setJob(data);
        if (data.status === "done" || data.status === "error") {
          if (timer.current) clearInterval(timer.current);
          if (data.status === "done") router.refresh();
        }
      } catch {
        // geçici ağ hatası: sonraki turda tekrar dene
      }
    }, 2000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [runId, router]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setJob(null);
    try {
      const res = await fetch(`/api/reports/${kind}/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(e.currentTarget)),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Tetikleme başarısız.");
        return;
      }
      setRunId(data.runId);
      setJob({ status: "queued", progressPct: 0, progressMsg: "Sıraya alındı…", error: null, rowCount: null });
    } catch {
      setError("Sunucuya ulaşılamadı.");
    }
  }

  const busy = job !== null && (job.status === "queued" || job.status === "running");

  return (
    <form onSubmit={submit} className="rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="font-heading text-lg font-semibold text-primary">{title}</h2>
      <div className="mt-4 space-y-3">{children}</div>
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {job && (
        <div className="mt-4">
          <div className="h-2 overflow-hidden rounded-full bg-cream">
            <div
              className={`h-full rounded-full transition-all ${
                job.status === "error" ? "bg-red-500" : "bg-primary"
              }`}
              style={{ width: `${job.status === "done" ? 100 : job.progressPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-ink/70">
            {job.status === "error"
              ? job.error
              : job.status === "done"
                ? `Tamamlandı — ${job.rowCount ?? 0} kayıt işlendi.`
                : (job.progressMsg ?? "Çalışıyor…")}
          </p>
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        className="mt-5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-60"
      >
        {busy ? "Güncelleniyor…" : "Raporu Güncelle"}
      </button>
    </form>
  );
}
