import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/dal";

export default async function BekliyorPage() {
  const user = await requireUser();
  if (user.status === "active" && user.role) redirect("/");

  return (
    <div className="mx-auto max-w-md pt-16 text-center">
      <div className="rounded-2xl bg-white p-10 shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-mint text-2xl">
          ⏳
        </div>
        <h1 className="text-xl font-semibold text-primary-dark">Yetki Bekleniyor</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink/70">
          Girişiniz doğrulandı ancak hesabınıza henüz bir rol ve birim
          atanmadı. Sistem yöneticiniz onayladığında raporlara erişebileceksiniz.
        </p>
      </div>
    </div>
  );
}
