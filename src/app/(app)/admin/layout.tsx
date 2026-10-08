import { requireActiveUser, isAnyAdmin } from "@/lib/auth/dal";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireActiveUser();
  if (!isAnyAdmin(user)) redirect("/");
  return <>{children}</>;
}
