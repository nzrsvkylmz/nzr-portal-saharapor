import Link from "next/link";
import { requireActiveUser, isAdminBagis, isAdminYardim } from "@/lib/auth/dal";

export default async function AdminHome() {
  const user = await requireActiveUser();
  const isSuper = user.role === "SUPER_ADMIN";

  const cards = [
    isSuper && {
      href: "/admin/kullanicilar",
      title: "Kullanıcılar",
      desc: "Bekleyen kullanıcıları onayla, rol ve birim ata",
    },
    (isAdminBagis(user) || isAdminYardim(user)) && {
      href: "/admin/raporlar",
      title: "Rapor Güncelleme",
      desc: "Portaldan güncel veriyi çek, snapshot oluştur",
    },
    isAdminBagis(user) && {
      href: "/admin/planlar",
      title: "Aylık Planlar",
      desc: "Bölge bazlı aylık bağış hedeflerini düzenle",
    },
    isSuper && {
      href: "/admin/birimler",
      title: "Birimler",
      desc: "Organizasyon hiyerarşisi ve eşlenmeyen kayıtlar",
    },
  ].filter(Boolean) as Array<{ href: string; title: string; desc: string }>;

  return (
    <div>
      <h1 className="text-2xl font-semibold text-primary-dark">Yönetim Paneli</h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-2xl bg-white p-6 shadow-sm transition hover:shadow-md"
          >
            <h2 className="font-heading text-lg font-semibold text-primary">{c.title}</h2>
            <p className="mt-2 text-sm text-ink/70">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
