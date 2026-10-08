import { asc, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { units, userUnits, users } from "@/lib/db/schema";
import {
  importBolgeMudurleri,
  importMuhasebe,
  importTemsilciler,
  updateUserAccess,
} from "./actions";

const ROLE_OPTIONS = [
  ["", "— Rol seç —"],
  ["TEMSILCI", "Temsilci"],
  ["BOLGE_MUDURU", "Bölge Müdürü"],
  ["ADMIN_BAGIS", "Muhasebe (Bağış Admin)"],
  ["ADMIN_YARDIM", "Sosyal Yardımlar (Yardım Admin)"],
  ["SUPER_ADMIN", "Süper Admin"],
] as const;

const ROL_FILTRELERI = [
  ["", "Tümü"],
  ["TEMSILCI", "Temsilciler"],
  ["BOLGE_MUDURU", "Bölge Müdürleri"],
  ["ADMIN", "Adminler"],
] as const;

export default async function KullanicilarPage({
  searchParams,
}: {
  searchParams: Promise<{ mesaj?: string; hata?: string; rol?: string }>;
}) {
  await requireRole("SUPER_ADMIN");
  const { mesaj, hata, rol } = await searchParams;

  const allUsers = await db.select().from(users).orderBy(asc(users.createdAt));
  const allUnits = await db
    .select()
    .from(units)
    .where(eq(units.active, true))
    .orderBy(asc(units.bolgeNo), asc(units.name));
  const assignments = await db.select().from(userUnits);

  const unitsByUser = new Map<string, number[]>();
  for (const a of assignments) {
    const list = unitsByUser.get(a.userId) ?? [];
    list.push(a.unitId);
    unitsByUser.set(a.userId, list);
  }
  const unitNameById = new Map(allUnits.map((u) => [u.id, u.name]));

  const bolgeler = [...new Set(allUnits.map((u) => u.bolgeNo).filter(Boolean))] as number[];
  const pending = allUsers.filter((u) => u.status === "pending" || !u.role);
  const tanimli = allUsers.filter((u) => u.status !== "pending" && u.role);
  const rolSecimi = ROL_FILTRELERI.some(([v]) => v === rol) ? (rol ?? "") : "";
  const active = tanimli.filter((u) => {
    if (!rolSecimi) return true;
    if (rolSecimi === "ADMIN") {
      return u.role === "ADMIN_BAGIS" || u.role === "ADMIN_YARDIM" || u.role === "SUPER_ADMIN";
    }
    return u.role === rolSecimi;
  });
  const rolSayisi = (v: string) =>
    v === ""
      ? tanimli.length
      : v === "ADMIN"
        ? tanimli.filter(
            (u) =>
              u.role === "ADMIN_BAGIS" || u.role === "ADMIN_YARDIM" || u.role === "SUPER_ADMIN",
          ).length
        : tanimli.filter((u) => u.role === v).length;

  function UserRow({ user }: { user: (typeof allUsers)[number] }) {
    const assigned = unitsByUser.get(user.id) ?? [];
    return (
      <form
        action={updateUserAccess}
        className="grid gap-3 rounded-2xl bg-white p-5 shadow-sm sm:grid-cols-[1fr_auto]"
      >
        <input type="hidden" name="userId" value={user.id} />
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{user.displayName ?? user.portalNick}</span>
            <span className="text-xs text-ink/50">@{user.portalNick}</span>
            {user.status === "pending" || !user.role ? (
              <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs text-ink">
                yetki bekliyor
              </span>
            ) : user.status === "disabled" ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
                devre dışı
              </span>
            ) : (
              <span className="rounded-full bg-mint px-2 py-0.5 text-xs text-primary-dark">
                aktif
              </span>
            )}
            {!user.lastLoginAt && user.role && (
              <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink/60">
                henüz giriş yapmadı
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2">
              Rol
              <select
                name="role"
                defaultValue={user.role ?? ""}
                className="rounded-lg border border-mint px-2 py-1"
              >
                {ROLE_OPTIONS.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Bölge (müdür için)
              <select
                name="bolgeNo"
                defaultValue={user.bolgeNo ?? ""}
                className="rounded-lg border border-mint px-2 py-1"
              >
                <option value="">—</option>
                {bolgeler.map((b) => (
                  <option key={b} value={b}>
                    {b}.BÖLGE
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              Durum
              <select
                name="status"
                defaultValue={user.status === "disabled" ? "disabled" : "active"}
                className="rounded-lg border border-mint px-2 py-1"
              >
                <option value="active">Aktif</option>
                <option value="disabled">Devre dışı</option>
              </select>
            </label>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-ink/60">
              Birimler (temsilci için) —{" "}
              {assigned.length
                ? assigned.map((id) => unitNameById.get(id) ?? "?").join(", ")
                : "atama yok"}
            </summary>
            <div className="mt-2 space-y-2">
              {assigned.length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {assigned.map((id) => (
                    <label key={id} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        name="keepUnitIds"
                        value={id}
                        defaultChecked
                        className="accent-primary"
                      />
                      {unitNameById.get(id) ?? `#${id}`}
                    </label>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  name="addUnitNames"
                  list="unit-options"
                  placeholder="birim ekle (yazarak ara)"
                  className="w-56 rounded-lg border border-mint px-2 py-1"
                />
                <input
                  name="addUnitNames"
                  list="unit-options"
                  placeholder="birim ekle"
                  className="w-56 rounded-lg border border-mint px-2 py-1"
                />
              </div>
              <p className="text-xs text-ink/50">
                İşareti kaldırılan birim kayıtta çıkarılır. Bağışta alt birimler
                hiyerarşiden otomatik gelir; genelde tek birim yeterlidir.
              </p>
            </div>
          </details>
        </div>
        <div className="flex items-start justify-end">
          <button
            type="submit"
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark"
          >
            Kaydet
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary-dark">Kullanıcılar</h1>
          <p className="mt-1 text-sm text-ink/60">
            Kullanıcılar Sistem Plus kimliğiyle giriş yaptığında burada görünür;
            rol ve birim atandığında raporlara erişir. İçe aktarılan kullanıcılar
            ilk girişlerinde doğrudan kendi kapsamlarını görür.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={importBolgeMudurleri}>
            <button
              type="submit"
              className="rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-white"
            >
              ⇅ Bölge müdürlerini içe aktar
            </button>
          </form>
          <form action={importMuhasebe}>
            <button
              type="submit"
              className="rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-white"
            >
              ⇅ Muhasebeyi içe aktar
            </button>
          </form>
          <form action={importTemsilciler}>
            <button
              type="submit"
              className="rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-white"
            >
              ⇅ Temsilcileri içe aktar
            </button>
          </form>
        </div>
      </div>

      {mesaj && (
        <p className="rounded-xl bg-mint/40 px-4 py-3 text-sm text-primary-dark">{mesaj}</p>
      )}
      {hata && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{hata}</p>
      )}

      {/* Tek paylaşımlı birim arama listesi: satır başına seçenek üretilmez */}
      <datalist id="unit-options">
        {allUnits
          .filter((u) => !u.isBolgeMudurlugu)
          .map((u) => (
            <option key={u.id} value={u.name}>
              {u.bolgeLabel ? `${u.bolgeLabel} · ${u.name}` : u.name}
            </option>
          ))}
      </datalist>

      {allUnits.length === 0 && (
        <p className="rounded-xl bg-amber/15 px-4 py-3 text-sm">
          Birim listesi henüz boş. Temsilci ataması yapabilmek için önce{" "}
          <a href="/admin/raporlar" className="font-medium text-primary underline">
            Rapor Güncelleme
          </a>{" "}
          ekranından yardım raporunu bir kez çekin (birimler portaldan senkronlanır).
        </p>
      )}

      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold">
            Onay Bekleyenler ({pending.length})
          </h2>
          {pending.map((u) => (
            <UserRow key={u.id} user={u} />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="font-heading text-lg font-semibold">
            Tanımlı Kullanıcılar ({active.length})
          </h2>
          <div className="flex flex-wrap gap-2 text-sm">
            {ROL_FILTRELERI.map(([v, t]) => (
              <a
                key={v}
                href={v ? `/admin/kullanicilar?rol=${v}` : "/admin/kullanicilar"}
                className={
                  rolSecimi === v
                    ? "rounded-full bg-primary px-4 py-1.5 font-semibold text-white"
                    : "rounded-full bg-white px-4 py-1.5 text-ink/70 shadow-sm transition hover:bg-mint"
                }
              >
                {t} ({rolSayisi(v)})
              </a>
            ))}
          </div>
        </div>
        {active.length === 0 ? (
          <p className="text-sm text-ink/60">Bu filtrede kullanıcı yok.</p>
        ) : (
          active.map((u) => <UserRow key={u.id} user={u} />)
        )}
      </section>
    </div>
  );
}
