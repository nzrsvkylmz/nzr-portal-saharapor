import Link from "next/link";
import { requireUser } from "@/lib/auth/dal";
import { canViewBagis, canViewYardim, isAnyAdmin } from "@/lib/auth/dal";
import { LogoutButton } from "@/components/LogoutButton";
import { HeaderNav, type HeaderNavLink } from "@/components/HeaderNav";
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
        !sahaRolu && { href: "/", label: "Özet", icon: "home" },
        canViewYardim(user) && { href: "/yardim", label: "Yardım", icon: "yardim" },
        canViewBagis(user) && { href: "/bagis", label: "Bağış", icon: "bagis" },
        isAnyAdmin(user) && { href: "/admin", label: "Yönetim", icon: "admin" },
      ].filter(Boolean) as MobileNavLink[])
    : [];

  const headerLinks: HeaderNavLink[] = active
    ? ([
        canViewYardim(user) && { href: "/yardim", label: "Yardım Raporu" },
        canViewBagis(user) && { href: "/bagis", label: "Bağış Raporu" },
        isAnyAdmin(user) && { href: "/admin", label: "Yönetim" },
      ].filter(Boolean) as HeaderNavLink[])
    : [];

  const adSoyad = user.displayName ?? user.portalNick;

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-40 text-white shadow-[0_2px_12px_rgba(0,77,50,0.25)]"
        style={{ background: "linear-gradient(120deg,#004d32 0%,#00764b 55%,#15855c 100%)" }}
      >
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
                className="rounded-xl bg-white p-0.5 shadow-sm"
              />
              NEZİR <span className="font-normal text-white/70">Rapor</span>
            </Link>
            {active && <HeaderNav links={headerLinks} />}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-2 sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-sm font-bold">
                {adSoyad.charAt(0).toLocaleUpperCase("tr")}
              </span>
              <span className="leading-tight">
                <span className="block text-xs font-semibold text-white/95">{adSoyad}</span>
                {user.role && (
                  <span className="block text-[10px] text-white/60">
                    {ROLE_LABELS[user.role]}
                  </span>
                )}
              </span>
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
