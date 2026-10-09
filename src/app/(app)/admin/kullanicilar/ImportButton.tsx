"use client";

import { useFormStatus } from "react-dom";

/** İçe aktarma formu gönder butonu: portal isteği sürerken durum gösterir. */
export function ImportButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-white disabled:cursor-wait disabled:border-ink/30 disabled:bg-ink/5 disabled:text-ink/50"
    >
      {pending ? "⏳ Portaldan okunuyor…" : children}
    </button>
  );
}
