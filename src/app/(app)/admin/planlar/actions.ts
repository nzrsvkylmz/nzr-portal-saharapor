"use server";

import { revalidatePath } from "next/cache";
import { requireActiveUser, isAdminBagis } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { auditLog, plans } from "@/lib/db/schema";

/** Seçili ay için bölge planlarını topluca kaydeder (upsert). */
export async function savePlans(formData: FormData): Promise<void> {
  const user = await requireActiveUser();
  if (!isAdminBagis(user)) throw new Error("Planları yalnızca muhasebe düzenler.");

  const month = String(formData.get("month") ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Geçersiz ay.");

  const entries: Array<{ bolgeLabel: string; amount: string }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("plan:")) continue;
    const bolgeLabel = key.slice(5);
    const amount = Number(String(value).replace(/\./g, "").replace(",", "."));
    if (Number.isNaN(amount) || amount < 0) continue;
    entries.push({ bolgeLabel, amount: amount.toFixed(2) });
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
    await tx.insert(auditLog).values({
      userId: user.id,
      action: "plans_update",
      detail: { month, count: entries.length },
    });
  });

  revalidatePath("/admin/planlar");
  revalidatePath("/bagis");
}
