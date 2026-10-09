import { and, count, eq, gt, ne } from "drizzle-orm";
import { requireRole } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { auditLog, units, userUnits, users, type User } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const ROL_ADI: Record<string, string> = {
  SUPER_ADMIN: "Süper Admin",
  ADMIN_BAGIS: "Muhasebe",
  ADMIN_YARDIM: "Sosyal Yardımlar",
  BOLGE_MUDURU: "Bölge Müdürü",
  TEMSILCI: "Temsilci",
};

const GUN_SECENEKLERI = [7, 15, 30] as const;

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(d);
}

function gunOnce(d: Date): string {
  const gun = Math.floor((Date.now() - d.getTime()) / 86400_000);
  if (gun <= 0) return "bugün";
  if (gun === 1) return "dün";
  return `${gun} gün önce`;
}

function bolgeOrder(label: string): number {
  return Number(/^(\d+)\./.exec(label)?.[1] ?? 999);
}

export default async function KullanimPage({
  searchParams,
}: {
  searchParams: Promise<{ gun?: string }>;
}) {
  await requireRole("SUPER_ADMIN");
  const sp = await searchParams;
  const gun = GUN_SECENEKLERI.includes(Number(sp.gun) as 7 | 15 | 30)
    ? Number(sp.gun)
    : 15;
  const esik = new Date(Date.now() - gun * 86400_000);

  const allUsers = await db
    .select()
    .from(users)
    .where(ne(users.status, "disabled"));
  const assignments = await db
    .select({
      userId: userUnits.userId,
      unitName: units.name,
      bolgeLabel: units.bolgeLabel,
    })
    .from(userUnits)
    .innerJoin(units, eq(userUnits.unitId, units.id));
  const loginRows = await db
    .select({ userId: auditLog.userId, adet: count() })
    .from(auditLog)
    .where(and(eq(auditLog.action, "login"), gt(auditLog.createdAt, esik)))
    .groupBy(auditLog.userId);
  const loginCount = new Map(loginRows.map((r) => [r.userId, r.adet]));

  const unitsByUser = new Map<string, { names: string[]; bolgeler: Set<string> }>();
  for (const a of assignments) {
    const e = unitsByUser.get(a.userId) ?? { names: [], bolgeler: new Set<string>() };
    e.names.push(a.unitName);
    if (a.bolgeLabel) e.bolgeler.add(a.bolgeLabel);
    unitsByUser.set(a.userId, e);
  }

  /** Kullanıcının bölge etiketi: müdürde bolgeNo, temsilcide birimlerinin bölgeleri. */
  const bolgeText = (u: User): string => {
    if (u.role === "BOLGE_MUDURU" && u.bolgeNo) return `${u.bolgeNo}.BÖLGE`;
    const b = unitsByUser.get(u.id)?.bolgeler;
    return b?.size ? [...b].sort((x, y) => bolgeOrder(x) - bolgeOrder(y)).join(", ") : "—";
  };
  const birimText = (u: User): string =>
    unitsByUser.get(u.id)?.names.join(", ") ?? "—";

  const hicGirmeyen = allUsers
    .filter((u) => !u.lastLoginAt)
    .sort((a, b) => bolgeOrder(bolgeText(a)) - bolgeOrder(bolgeText(b)));
  const aktif = allUsers.filter((u) => u.lastLoginAt && u.lastLoginAt >= esik);
  const eskiyenler = allUsers
    .filter((u) => u.lastLoginAt && u.lastLoginAt < esik)
    .sort((a, b) => b.lastLoginAt!.getTime() - a.lastLoginAt!.getTime());

  // Saha özeti: bölge bazında temsilci kullanım durumu + bölge müdürü
  interface BolgeOzet {
    bolge: string;
    temsilciToplam: number;
    temsilciAktif: number;
    temsilciHic: number;
    mudur: User | null;
  }
  const ozet = new Map<string, BolgeOzet>();
  const entry = (bolge: string): BolgeOzet => {
    const e =
      ozet.get(bolge) ??
      { bolge, temsilciToplam: 0, temsilciAktif: 0, temsilciHic: 0, mudur: null };
    ozet.set(bolge, e);
    return e;
  };
  for (const u of allUsers) {
    if (u.role === "TEMSILCI") {
      for (const bolge of unitsByUser.get(u.id)?.bolgeler ?? []) {
        const e = entry(bolge);
        e.temsilciToplam += 1;
        if (!u.lastLoginAt) e.temsilciHic += 1;
        else if (u.lastLoginAt >= esik) e.temsilciAktif += 1;
      }
    } else if (u.role === "BOLGE_MUDURU" && u.bolgeNo) {
      entry(`${u.bolgeNo}.BÖLGE`).mudur = u;
    }
  }
  const ozetRows = [...ozet.values()].sort(
    (a, b) => bolgeOrder(a.bolge) - bolgeOrder(b.bolge),
  );

  const sonGirisler = [...allUsers].sort((a, b) => {
    if (!a.lastLoginAt) return 1;
    if (!b.lastLoginAt) return -1;
    return b.lastLoginAt.getTime() - a.lastLoginAt.getTime();
  });

  function UserCells({ user }: { user: User }) {
    return (
      <>
        <td className="px-4 py-2">
          <span className="font-medium">{user.displayName ?? user.portalNick}</span>{" "}
          <span className="text-xs text-ink/40">@{user.portalNick}</span>
        </td>
        <td className="px-4 py-2 text-xs">{user.role ? ROL_ADI[user.role] : "yetki bekliyor"}</td>
        <td className="px-4 py-2 text-xs">{bolgeText(user)}</td>
        <td className="px-4 py-2 text-xs">{user.role === "TEMSILCI" ? birimText(user) : "—"}</td>
      </>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary-dark">Kullanım Takibi</h1>
          <p className="mt-1 text-sm text-ink/60">
            Giriş kayıtlarına göre saha kullanımı. Devre dışı kullanıcılar sayıma dahil değildir.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {GUN_SECENEKLERI.map((g) => (
            <a
              key={g}
              href={`/admin/kullanim?gun=${g}`}
              className={
                g === gun
                  ? "rounded-full bg-primary px-4 py-1.5 font-semibold text-white"
                  : "rounded-full bg-white px-4 py-1.5 text-ink/70 shadow-sm transition hover:bg-mint"
              }
            >
              Son {g} gün
            </a>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-ink/60">Toplam Kullanıcı</p>
          <p className="mt-1 text-2xl font-semibold text-primary-dark">{allUsers.length}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-ink/60">Son {gun} Günde Giren</p>
          <p className="mt-1 text-2xl font-semibold text-primary-dark">{aktif.length}</p>
          <p className="mt-1 text-xs text-ink/50">
            %{allUsers.length ? Math.round((aktif.length / allUsers.length) * 100) : 0}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-ink/60">{gun}+ Gündür Girmeyen</p>
          <p className="mt-1 text-2xl font-semibold text-amber">{eskiyenler.length}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-ink/60">Hiç Girmeyen</p>
          <p className="mt-1 text-2xl font-semibold text-red-700">{hicGirmeyen.length}</p>
        </div>
      </div>

      {ozetRows.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold">Bölge Bazlı Saha Özeti</h2>
          <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary text-left text-white">
                  <th className="px-4 py-2.5 font-medium">Bölge</th>
                  <th className="px-4 py-2.5 font-medium">Bölge Müdürü</th>
                  <th className="px-4 py-2.5 font-medium">Müdür Son Giriş</th>
                  <th className="px-4 py-2.5 font-medium">Temsilci</th>
                  <th className="px-4 py-2.5 font-medium">Son {gun} Gün Aktif</th>
                  <th className="px-4 py-2.5 font-medium">Hiç Girmeyen</th>
                </tr>
              </thead>
              <tbody>
                {ozetRows.map((r, i) => (
                  <tr key={r.bolge} className={i % 2 ? "bg-cream/60" : ""}>
                    <td className="px-4 py-2 font-medium">{r.bolge}</td>
                    <td className="px-4 py-2">
                      {r.mudur ? (r.mudur.displayName ?? r.mudur.portalNick) : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {r.mudur
                        ? r.mudur.lastLoginAt
                          ? `${fmtTime(r.mudur.lastLoginAt)} (${gunOnce(r.mudur.lastLoginAt)})`
                          : "hiç girmedi"
                        : "—"}
                    </td>
                    <td className="px-4 py-2">{r.temsilciToplam}</td>
                    <td className="px-4 py-2">
                      <span className={r.temsilciAktif ? "text-primary-dark" : "text-ink/40"}>
                        {r.temsilciAktif}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={r.temsilciHic ? "font-semibold text-red-700" : "text-ink/40"}>
                        {r.temsilciHic}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {hicGirmeyen.length > 0 && (
        <section>
          <h2 className="font-heading text-lg font-semibold">
            Hiç Giriş Yapmayanlar ({hicGirmeyen.length})
          </h2>
          <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-primary text-left text-white">
                  <th className="px-4 py-2.5 font-medium">Kullanıcı</th>
                  <th className="px-4 py-2.5 font-medium">Rol</th>
                  <th className="px-4 py-2.5 font-medium">Bölge</th>
                  <th className="px-4 py-2.5 font-medium">Birim</th>
                  <th className="px-4 py-2.5 font-medium">Kayıt Tarihi</th>
                </tr>
              </thead>
              <tbody>
                {hicGirmeyen.map((u, i) => (
                  <tr key={u.id} className={i % 2 ? "bg-cream/60" : ""}>
                    <UserCells user={u} />
                    <td className="px-4 py-2 text-xs">{fmtTime(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="font-heading text-lg font-semibold">
          Tüm Kullanıcılar — Son Giriş
        </h2>
        <div className="mt-3 overflow-x-auto rounded-2xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-primary text-left text-white">
                <th className="px-4 py-2.5 font-medium">Kullanıcı</th>
                <th className="px-4 py-2.5 font-medium">Rol</th>
                <th className="px-4 py-2.5 font-medium">Bölge</th>
                <th className="px-4 py-2.5 font-medium">Birim</th>
                <th className="px-4 py-2.5 font-medium">Son Giriş</th>
                <th className="px-4 py-2.5 font-medium">Son {gun} Gün Giriş</th>
              </tr>
            </thead>
            <tbody>
              {sonGirisler.map((u, i) => (
                <tr key={u.id} className={i % 2 ? "bg-cream/60" : ""}>
                  <UserCells user={u} />
                  <td className="px-4 py-2 text-xs">
                    {u.lastLoginAt
                      ? `${fmtTime(u.lastLoginAt)} (${gunOnce(u.lastLoginAt)})`
                      : <span className="font-semibold text-red-700">hiç girmedi</span>}
                  </td>
                  <td className="px-4 py-2">{loginCount.get(u.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
