import { requireActiveUser, isAnyAdmin } from "@/lib/auth/dal";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireActiveUser();
  // Bölge müdürü yalnız kullanım takibine girer; diğer alt sayfalar kendi rol korumasıyla kapalıdır.
  if (!isAnyAdmin(user) && user.role !== "BOLGE_MUDURU") redirect("/");
  return <>{children}</>;
}
