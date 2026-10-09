"use client";

import { useFormStatus } from "react-dom";

/**
 * İçe aktarma formu gönder butonu. İşlem sürerken tüm ekranı kaplayan bir
 * bekleme perdesi gösterir; böylece kullanıcı başka yere tıklayıp sonucu
 * kaçıramaz (sayfadan ayrılınca sonuç mesajı tarayıcıya ulaşamıyor).
 */
export function ImportButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-white disabled:cursor-wait disabled:border-ink/30 disabled:bg-ink/5 disabled:text-ink/50"
      >
        {pending ? "⏳ Portaldan okunuyor…" : children}
      </button>
      {pending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4">
          <div className="max-w-sm rounded-2xl bg-white px-6 py-5 text-center shadow-xl">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-mint border-t-primary" />
            <p className="font-semibold text-primary-dark">Portaldan okunuyor…</p>
            <p className="mt-1 text-sm text-ink/60">
              Lütfen bekleyin, sayfadan ayrılmayın. İşlem bitince sonuç özeti
              bu sayfada gösterilecek.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
