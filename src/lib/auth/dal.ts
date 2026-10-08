/**
 * Data-access katmanı yetki yardımcıları. Sayfa/route başında çağrılır;
 * gerçek veri kapsamı (scope) sorgu düzeyinde ayrıca uygulanır.
 */
import { redirect } from "next/navigation";
import type { Role, User } from "@/lib/db/schema";
import { getSessionUser } from "./session";

/** Aktif oturum + aktif kullanıcı ister; yoksa /login'e yollar. */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.status === "disabled") redirect("/login?err=disabled");
  return user;
}

/** Rolü atanmış (pending olmayan) kullanıcı ister. */
export async function requireActiveUser(): Promise<User> {
  const user = await requireUser();
  if (user.status === "pending" || !user.role) redirect("/bekliyor");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await requireActiveUser();
  if (!user.role || !roles.includes(user.role)) redirect("/");
  return user;
}

export function isAdminBagis(user: User): boolean {
  return user.role === "SUPER_ADMIN" || user.role === "ADMIN_BAGIS";
}

export function isAdminYardim(user: User): boolean {
  return user.role === "SUPER_ADMIN" || user.role === "ADMIN_YARDIM";
}

/** Bağış raporunu görebilir mi — yardım admini (sosyal yardımlar) göremez. */
export function canViewBagis(user: User): boolean {
  return user.role !== "ADMIN_YARDIM";
}

/** Yardım raporunu görebilir mi — bağış admini (muhasebe) göremez. */
export function canViewYardim(user: User): boolean {
  return user.role !== "ADMIN_BAGIS";
}

export function isAnyAdmin(user: User): boolean {
  return (
    user.role === "SUPER_ADMIN" ||
    user.role === "ADMIN_BAGIS" ||
    user.role === "ADMIN_YARDIM"
  );
}
