"use server";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireActiveUser, isAdminBagis } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { auditLog, plans, unitPlans, units } from "@/lib/db/schema";

/**
 * Seçili ay için il temsilciliği planlarını kaydeder (upsert). Bölge hedefleri
 * ayrı girilmez: her kayıtta o ayın bölge hedefleri, il planlarının bölge
 * bazlı toplamından yeniden türetilip plans tablosuna yazılır — ikisi asla
 * birbirinden ayrışmaz.
 */
export async function savePlans(formData: FormData): Promise<void> {
  const user = await requireActiveUser();
  if (!isAdminBagis(user)) throw new Error("Planları yalnızca muhasebe düzenler.");

  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Geçersiz ay.");

  const parseAmount = (value: FormDataEntryValue): string | null => {
    const amount = Number(String(value).replace(/\./g, "").replace(",", "."));
    if (Number.isNaN(amount) || amount < 0) return null;
    return amount.toFixed(2);
  };

  const unitEntries: Array<{ unitId: number; amount: string }> = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("uplan:")) {
      const unitId = Number(key.slice(6));
      const amount = parseAmount(value);
      if (Number.isInteger(unitId) && unitId > 0 && amount !== null) {
        unitEntries.push({ unitId, amount });
      }
    }
  }

  await db.transaction(async (tx) => {
    for (const e of unitEntries) {
      await tx
        .insert(unitPlans)
        .values({ month, unitId: e.unitId, amount: e.amount, updatedBy: user.id })
        .onConflictDoUpdate({
          target: [unitPlans.month, unitPlans.unitId],
          set: { amount: e.amount, updatedBy: user.id, updatedAt: new Date() },
        });
    }

    // bölge hedefleri = il planlarının bölge bazlı toplamı (tam senkron)
    const sums = await tx
      .select({
        bolgeLabel: units.bolgeLabel,
        total: sql<string>`sum(${unitPlans.amount})`,
      })
      .from(unitPlans)
      .innerJoin(units, eq(units.id, unitPlans.unitId))
      .where(and(eq(unitPlans.month, month), isNotNull(units.bolgeLabel)))
      .groupBy(units.bolgeLabel);
    await tx.delete(plans).where(eq(plans.month, month));
    for (const s of sums) {
      if (!s.bolgeLabel) continue;
      await tx.insert(plans).values({
        month,
        bolgeLabel: s.bolgeLabel,
        amount: Number(s.total).toFixed(2),
        updatedBy: user.id,
      });
    }

    await tx.insert(auditLog).values({
      userId: user.id,
      action: "plans_update",
      detail: { month, unitCount: unitEntries.length, bolgeCount: sums.length },
    });
  });

  revalidatePath("/admin/planlar");
  revalidatePath("/bagis");
}
