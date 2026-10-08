import { asc, eq, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireActiveUser, isAdminBagis } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { plans, units } from "@/lib/db/schema";
import { savePlans } from "./actions";

export default async function PlanlarPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const user = await requireActiveUser();
  if (!isAdminBagis(user)) redirect("/admin");

  const sp = await searchParams;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = /^\d{4}-\d{2}$/.test(sp.ay ?? "") ? sp.ay! : currentMonth;

  // bölge listesi: units'ten; henüz senkron yoksa plan kayıtlarından
  const unitBolgeler = await db
    .selectDistinct({ bolgeNo: units.bolgeNo, bolgeLabel: units.bolgeLabel })
    .from(units)
    .where(isNotNull(units.bolgeNo))
    .orderBy(asc(units.bolgeNo));
  const planRows = await db.select().from(plans).where(eq(plans.month, month));
  const planByBolge = new Map(planRows.map((r) => [r.bolgeLabel, Number(r.amount)]));

  const bolgeler = unitBolgeler.length
    ? (unitBolgeler.map((b) => b.bolgeLabel).filter(Boolean) as string[])
    : [...planByBolge.keys()].sort(
        (a, b) => (Number(/^(\d+)/.exec(a)?.[1]) || 0) - (Number(/^(\d+)/.exec(b)?.[1]) || 0),
      );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary-dark">Aylık Bağış Planları</h1>
        <p className="mt-1 text-sm text-ink/60">
          Bölge bazlı aylık hedefler; bağış raporundaki gerçekleşme oranı bu
          değerlere göre hesaplanır.
        </p>
      </div>

      <form method="GET" className="flex items-center gap-2 text-sm">
        <label htmlFor="ay">Ay</label>
        <input
          id="ay"
          name="ay"
          type="month"
          defaultValue={month}
          className="rounded-lg border border-mint px-2 py-1"
        />
        <button className="rounded-lg bg-primary px-3 py-1.5 text-white">Getir</button>
      </form>

      {bolgeler.length === 0 ? (
        <p className="rounded-xl bg-amber/15 px-4 py-3 text-sm">
          Bölge listesi boş. Önce yardım raporu güncellenerek birimlerin
          senkronlanması gerekir.
        </p>
      ) : (
        <form action={savePlans} className="rounded-2xl bg-white p-6 shadow-sm">
          <input type="hidden" name="month" value={month} />
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {bolgeler.map((b) => (
              <label key={b} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{b}</span>
                <div className="flex items-center gap-1">
                  <span className="text-ink/50">₺</span>
                  <input
                    name={`plan:${b}`}
                    defaultValue={
                      planByBolge.has(b)
                        ? planByBolge.get(b)!.toLocaleString("tr-TR", {
                            minimumFractionDigits: 0,
                          })
                        : ""
                    }
                    inputMode="decimal"
                    className="w-32 rounded-lg border border-mint px-2 py-1 text-right"
                  />
                </div>
              </label>
            ))}
          </div>
          <button
            type="submit"
            className="mt-6 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
          >
            {month} planlarını kaydet
          </button>
        </form>
      )}
    </div>
  );
}
