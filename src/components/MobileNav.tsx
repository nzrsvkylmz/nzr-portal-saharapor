"use client";

/**
 * Mobil alt gezinme çubuğu (yalnız dar ekranda görünür). Bağlantılar sunucuda
 * role göre hesaplanıp prop olarak gelir; aktif sekme vurgusu yol adından.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface MobileNavLink {
  href: string;
  label: string;
  icon: string;
}

export function MobileNav({ links }: { links: MobileNavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-mint bg-white shadow-[0_-2px_8px_rgba(0,0,0,0.06)] sm:hidden">
      {links.map((l) => {
        const active =
          l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] " +
              (active ? "font-semibold text-primary-dark" : "text-ink/60")
            }
          >
            <span aria-hidden className="text-lg leading-none">
              {l.icon}
            </span>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
