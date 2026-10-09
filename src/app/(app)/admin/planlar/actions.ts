"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser, isAdminBagis } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { auditLog, plans, unitPlans } from "@/lib/db/schema";

/** Seçili ay için bölge ve il temsilciliği planlarını topluca kaydeder (upsert). */
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

  const entries: Array<{ bolgeLabel: string; amount: string }> = [];
  const unitEntries: Array<{ unitId: number; amount: string }> = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("plan:")) {
      const amount = parseAmount(value);
      if (amount !== null) entries.push({ bolgeLabel: key.slice(5), amount });
    } else if (key.startsWith("uplan:")) {
      const unitId = Number(key.slice(6));
      const amount = parseAmount(value);
      if (Number.isInteger(unitId) && unitId > 0 && amount !== null) {
        unitEntries.push({ unitId, amount });
      }
    }
  }

  await db.transaction(async (tx) => {
    for (const e of entries) {
      await tx
        .insert(plans)
        .values({ month, bolgeLabel: e.bolgeLabel, amount: e.amount, updatedBy: user.id })
        .onConflictDoUpdate({
          target: [plans.month, plans.bolgeLabel],
          set: { amount: e.amount, updatedBy: user.id, updatedAt: new Date() },
        });
    }
    for (const e of unitEntries) {
      await tx
        .insert(unitPlans)
        .values({ month, unitId: e.unitId, amount: e.amount, updatedBy: user.id })
        .onConflictDoUpdate({
          target: [unitPlans.month, unitPlans.unitId],
          set: { amount: e.amount, updatedBy: user.id, updatedAt: new Date() },
        });
    }
    await tx.insert(auditLog).values({
      userId: user.id,
      action: "plans_update",
      detail: { month, count: entries.length, unitCount: unitEntries.length },
    });
  });

  revalidatePath("/admin/planlar");
  revalidatePath("/bagis");
}
