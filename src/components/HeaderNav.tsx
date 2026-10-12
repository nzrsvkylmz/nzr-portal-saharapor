"use client";

/** Masaüstü üst menüsü: aktif sekme hap (pill) vurgusuyla. */
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface HeaderNavLink {
  href: string;
  label: string;
}

export function HeaderNav({ links }: { links: HeaderNavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 sm:flex">
      {links.map((l) => {
        const active =
          l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              "rounded-full px-4 py-1.5 text-sm transition " +
              (active
                ? "bg-white/15 font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,.2)]"
                : "text-white/75 hover:bg-white/10 hover:text-white")
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
