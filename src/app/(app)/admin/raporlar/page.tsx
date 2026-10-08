import { desc, eq } from "drizzle-orm";
import { requireActiveUser, isAdminBagis, isAdminYardim } from "@/lib/auth/dal";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { appSettings, portalSessions, reportRuns } from "@/lib/db/schema";
import { BagisForm, YardimForm } from "./forms";

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(d);
}

interface CachedFilters {
  activities: Array<[string, string]>;
  pools: Array<[string, string]>;
  types: Array<[string, string]>;
}

/**
 * İlk aşamada yalnızca bu faaliyetler ve Serbest fon raporlanır
 * (portal ID'leri: bagis-demo/storage/filters.json ile doğrulandı).
 */
const ALLOWED_ACTIVITIES: Array<[string, string]> = [
  ["1", "Genel Bağış"],
  ["15", "Sadaka"],
];
const ALLOWED_POOLS: Array<[string, string]> = [["1", "Serbest"]];

const DEFAULT_TYPES: Array<[string, string]> = [
  ["1", "Nakit Bağış"],
  ["2", "Çek Senet"],
  ["3", "Kredi Kartı"],
  ["4", "Online Bağış"],
  ["5", "Banka Bağış"],
  ["6", "SMS Bağış"],
  ["7", "Ayni Bağış"],
];

export default async function RaporlarPage() {
  const user = await requireActiveUser();
  const canBagis = isAdminBagis(user);
  const canYardim = isAdminYardim(user);
  if (!canBagis && !canYardim) redirect("/admin");

  const portal = await db.query.portalSessions.findFirst({
    where: eq(portalSessions.userId, user.id),
  });
  const portalOk = portal?.state === "authenticated";

  const filterRow = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, "bagis.filters"),
  });
  const filters = (filterRow?.value as CachedFilters | undefined) ?? {
    activities: [],
    pools: [],
    types: DEFAULT_TYPES,
  };

  // Son güncellemeler: herkes yalnız kendi alanının loglarını görür
  const lastRuns = (
    await db
      .select()
      .from(reportRuns)
      .where(
        canBagis && canYardim
          ? undefined
          : eq(reportRuns.kind, canBagis ? "bagis" : "yardim"),
      )
      .orderBy(desc(reportRuns.createdAt))
      .limit(10)
  );

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const STATUS_TR: Record<string, string> = {
    queued: "sırada",
    running: "çalışıyor",
    done: "tamamlandı",
    error: "hata",
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-primary-dark">Rapor Güncelleme</h1>
        <p className="mt-1 text-sm text-ink/60">
          Güncelleme, sizin portal oturumunuzla yapılır ve sonuç tüm saha
          kullanıcılarının ekranlarına yansır.
        </p>
      </div>

      {!portalOk && (
        <p className="rounded-xl bg-amber/15 px-4 py-3 text-sm">
          Portal oturumunuz doğrulanmış görünmüyor
          {portal?.state ? ` (durum: ${portal.state})` : ""}. Güncelleme hata
          verirse çıkış yapıp yeniden giriş yapın — giriş sırasında portal
          oturumunuz tazelenir.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {canBagis && (
          <BagisForm
            defaults={{ ay: currentMonth }}
            activities={ALLOWED_ACTIVITIES}
            pools={ALLOWED_POOLS}
            types={filters.types.length ? filters.types : DEFAULT_TYPES}
          />
        )}
        {canYardim && <YardimForm />}
      </div>

      <section>
        <h2 className="font-heading text-lg font-semibold">Son Güncellemeler</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary text-left text-white">
                <th className="px-4 py-2.5 font-medium">Tür</th>
                <th className="px-4 py-2.5 font-medium">Durum</th>
                <th className="px-4 py-2.5 font-medium">Kayıt</th>
                <th className="px-4 py-2.5 font-medium">Başlangıç</th>
                <th className="px-4 py-2.5 font-medium">Bitiş</th>
                <th className="px-4 py-2.5 font-medium">Not</th>
              </tr>
            </thead>
            <tbody>
              {lastRuns.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink/50">
                    Henüz güncelleme yapılmadı.
                  </td>
                </tr>
              )}
              {lastRuns.map((r, i) => (
                <tr key={r.id} className={i % 2 ? "bg-cream/60" : ""}>
                  <td className="px-4 py-2">
                    {r.kind === "bagis" ? "Bağış" : "Yardım"}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        r.status === "done"
                          ? "text-primary-dark"
                          : r.status === "error"
                            ? "text-red-700"
                            : "text-ink/70"
                      }
                    >
                      {STATUS_TR[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2">{r.rowCount ?? "—"}</td>
                  <td className="px-4 py-2">{fmtTime(r.createdAt)}</td>
                  <td className="px-4 py-2">{fmtTime(r.finishedAt)}</td>
                  <td className="max-w-xs truncate px-4 py-2 text-xs text-ink/60">
                    {r.error ?? r.progressMsg ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
