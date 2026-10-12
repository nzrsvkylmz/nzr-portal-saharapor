"use client";

/**
 * Mobil alt gezinme çubuğu (yalnız dar ekranda görünür). Bağlantılar sunucuda
 * role göre hesaplanıp prop olarak gelir; aktif sekme gradient hap ikonuyla
 * vurgulanır. Çentikli cihazlar için safe-area dolgusu vardır.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export type MobileNavIcon = "home" | "yardim" | "bagis" | "admin";

export interface MobileNavLink {
  href: string;
  label: string;
  icon: MobileNavIcon;
}

const ICONS: Record<MobileNavIcon, React.ReactNode> = {
  home: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  yardim: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  ),
  bagis: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
      <path d="M7 6h1v4" />
      <path d="m16.71 13.88.7.71-2.82 2.82" />
    </svg>
  ),
  admin: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
};

export function MobileNav({ links }: { links: MobileNavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex rounded-t-2xl border-t border-mint/70 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,77,50,0.10)] backdrop-blur sm:hidden">
      {links.map((l) => {
        const active =
          l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className="flex flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px]"
          >
            <span
              aria-hidden
              className="flex h-7 w-14 items-center justify-center rounded-full transition"
              style={
                active
                  ? {
                      background: "linear-gradient(135deg,#00764b,#2f9e77)",
                      color: "white",
                      boxShadow: "0 2px 8px rgba(0,118,75,.35)",
                    }
                  : { color: "#2d3a35", opacity: 0.55 }
              }
            >
              {ICONS[l.icon]}
            </span>
            <span
              className={active ? "font-semibold text-primary-dark" : "text-ink/55"}
            >
              {l.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
