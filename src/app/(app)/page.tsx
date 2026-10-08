import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { canViewBagis, canViewYardim, requireActiveUser, isAnyAdmin } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { reportRuns } from "@/lib/db/schema";

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(d);
}

export default async function Dashboard() {
  const user = await requireActiveUser();
  // Saha rolleri önce yardım raporunu görür; bağışa menüden geçerler
  if (user.role === "BOLGE_MUDURU" || user.role === "TEMSILCI") redirect("/yardim");

  const [lastBagis] = await db
    .select()
    .from(reportRuns)
    .where(eq(reportRuns.kind, "bagis"))
    .orderBy(desc(reportRuns.createdAt))
    .limit(1);
  const [lastYardim] = await db
    .select()
    .from(reportRuns)
    .where(eq(reportRuns.kind, "yardim"))
    .orderBy(desc(reportRuns.createdAt))
    .limit(1);

  const cards = [
    canViewBagis(user) && {
      href: "/bagis",
      title: "Bağış Raporu",
      desc: "Bölge ve temsilcilik bazlı bağış dağılımı, plan–gerçekleşme oranları",
      updated: lastBagis?.status === "done" ? fmtTime(lastBagis.finishedAt) : "henüz yok",
    },
    canViewYardim(user) && {
      href: "/yardim",
      title: "Yardım Raporu",
      desc: "Bekleyen yardım başvuruları, aşama dağılımı ve kritik dosyalar",
      updated: lastYardim?.status === "done" ? fmtTime(lastYardim.finishedAt) : "henüz yok",
    },
  ].filter(Boolean) as Array<{ href: string; title: string; desc: string; updated: string }>;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary-dark">
        Hoş geldiniz{user.displayName ? `, ${user.displayName}` : ""}
      </h1>
      <p className="mt-1 text-sm text-ink/60">
        Sorumluluk alanınızdaki güncel rapor özetleri aşağıdadır.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-2xl bg-white p-6 shadow-sm transition hover:shadow-md"
          >
            <h2 className="font-heading text-lg font-semibold text-primary group-hover:text-primary-dark">
              {c.title}
            </h2>
            <p className="mt-2 text-sm text-ink/70">{c.desc}</p>
            <p className="mt-4 text-xs text-ink/50">Son güncelleme: {c.updated}</p>
          </Link>
        ))}
        {isAnyAdmin(user) && (
          <Link
            href="/admin"
            className="group rounded-2xl border border-mint bg-mint/30 p-6 transition hover:bg-mint/50"
          >
            <h2 className="font-heading text-lg font-semibold text-primary-dark">
              Yönetim Paneli
            </h2>
            <p className="mt-2 text-sm text-ink/70">
              Rapor güncelleme, kullanıcı yetkilendirme ve plan yönetimi
            </p>
          </Link>
        )}
      </div>
    </div>
  );
}
