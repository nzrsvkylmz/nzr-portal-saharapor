"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
      className="rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
    >
      Çıkış
    </button>
  );
}
