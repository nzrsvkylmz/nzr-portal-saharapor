import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { canViewBagis, canViewYardim, isAnyAdmin } from "@/lib/auth/dal";
import { LogoutButton } from "@/components/LogoutButton";
import { MobileNav, type MobileNavLink } from "@/components/MobileNav";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Süper Admin",
  ADMIN_BAGIS: "Muhasebe (Bağış)",
  ADMIN_YARDIM: "Sosyal Yardımlar",
  BOLGE_MUDURU: "Bölge Müdürü",
  TEMSILCI: "Temsilci",
};

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const active = user.status === "active" && !!user.role;
  const sahaRolu = user.role === "BOLGE_MUDURU" || user.role === "TEMSILCI";

  const mobileLinks: MobileNavLink[] = active
    ? ([
        !sahaRolu && { href: "/", label: "Özet", icon: "🏠" },
        canViewYardim(user) && { href: "/yardim", label: "Yardım", icon: "🤝" },
        canViewBagis(user) && { href: "/bagis", label: "Bağış", icon: "₺" },
        isAnyAdmin(user) && { href: "/admin", label: "Yönetim", icon: "⚙️" },
      ].filter(Boolean) as MobileNavLink[])
    : [];

  return (
    <div className="min-h-screen">
      <header className="bg-primary text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-8">
            <Link
              href="/"
              className="flex items-center gap-2.5 font-heading text-lg font-bold tracking-wide"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="NEZİR"
                width={34}
                height={30}
                className="rounded-lg bg-white p-0.5"
              />
              NEZİR <span className="font-normal text-white/70">Saha Rapor</span>
            </Link>
            {active && (
              <nav className="hidden items-center gap-1 sm:flex">
                {canViewYardim(user) && (
                  <Link
                    href="/yardim"
                    className="rounded-lg px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/10"
                  >
                    Yardım Raporu
                  </Link>
                )}
                {canViewBagis(user) && (
                  <Link
                    href="/bagis"
                    className="rounded-lg px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/10"
                  >
                    Bağış Raporu
                  </Link>
                )}
                {isAnyAdmin(user) && (
                  <Link
                    href="/admin"
                    className="rounded-lg px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/10"
                  >
                    Yönetim
                  </Link>
                )}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-white/70 sm:inline">
              {user.displayName ?? user.portalNick}
              {user.role ? ` · ${ROLE_LABELS[user.role]}` : ""}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      {/* mobil alt menü yüksekliği kadar güvenli boşluk */}
      <main className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:pb-8">{children}</main>
      {mobileLinks.length > 0 && <MobileNav links={mobileLinks} />}
    </div>
  );
}
