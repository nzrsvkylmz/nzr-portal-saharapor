import { and, asc, eq, isNotNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { requireActiveUser, isAdminBagis } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { plans, unitPlans, units } from "@/lib/db/schema";
import { savePlans } from "./actions";

function fmtTutar(v: number): string {
  return v.toLocaleString("tr-TR", { minimumFractionDigits: 0 });
}

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

  const allUnits = await db
    .select()
    .from(units)
    .where(and(eq(units.active, true), isNotNull(units.bolgeNo)))
    .orderBy(asc(units.bolgeNo), asc(units.name));
  const unitById = new Map(allUnits.map((u) => [u.id, u]));
  // il temsilcilikleri: bölge müdürlüğü olmayan, onay beklemeyen, üst düzey
  // birimler (alt kırılımlar hariç: üstü yoksa ya da üstü bölge müdürlüğüyse)
  const ilUnits = allUnits.filter(
    (u) =>
      !u.isBolgeMudurlugu &&
      !u.needsReview &&
      (u.parentUnitId === null || unitById.get(u.parentUnitId)?.isBolgeMudurlugu),
  );

  const planRows = await db.select().from(plans).where(eq(plans.month, month));
  const planByBolge = new Map(planRows.map((r) => [r.bolgeLabel, Number(r.amount)]));
  const unitPlanRows = await db
    .select()
    .from(unitPlans)
    .where(eq(unitPlans.month, month));
  const planByUnit = new Map(unitPlanRows.map((r) => [r.unitId, Number(r.amount)]));

  // bölge blokları: bölge etiketi + o bölgenin il temsilcilikleri
  const bolgeler: Array<{ label: string; units: typeof ilUnits }> = [];
  {
    const seen = new Map<string, { label: string; units: typeof ilUnits }>();
    for (const u of allUnits) {
      if (!u.bolgeLabel) continue;
      if (!seen.has(u.bolgeLabel)) {
        const e = { label: u.bolgeLabel, units: [] as typeof ilUnits };
        seen.set(u.bolgeLabel, e);
        bolgeler.push(e);
      }
    }
    for (const u of ilUnits) {
      if (u.bolgeLabel) seen.get(u.bolgeLabel)?.units.push(u);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-primary-dark">
          Aylık Genel Bağış Planları
        </h1>
        <p className="mt-1 text-sm text-ink/60">
          Bölge ve il temsilciliği bazlı aylık hedefler; bağış raporundaki
          gerçekleşme oranları bu değerlere göre hesaplanır.
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
        <form action={savePlans} className="space-y-4">
          <input type="hidden" name="month" value={month} />
          {bolgeler.map((b) => (
            <section key={b.label} className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mint/60 pb-3">
                <h2 className="font-heading font-semibold text-primary-dark">{b.label}</h2>
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-ink/60">Bölge hedefi</span>
                  <span className="text-ink/50">₺</span>
                  <input
                    name={`plan:${b.label}`}
                    defaultValue={
                      planByBolge.has(b.label) ? fmtTutar(planByBolge.get(b.label)!) : ""
                    }
                    inputMode="decimal"
                    className="w-32 rounded-lg border border-mint px-2 py-1 text-right font-semibold"
                  />
                </label>
              </div>
              {b.units.length > 0 && (
                <div className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  {b.units.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>{u.name}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-ink/50">₺</span>
                        <input
                          name={`uplan:${u.id}`}
                          defaultValue={
                            planByUnit.has(u.id) ? fmtTutar(planByUnit.get(u.id)!) : ""
                          }
                          inputMode="decimal"
                          className="w-28 rounded-lg border border-mint px-2 py-1 text-right"
                        />
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </section>
          ))}
          <button
            type="submit"
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark"
          >
            {month} planlarını kaydet
          </button>
        </form>
      )}
    </div>
  );
}
