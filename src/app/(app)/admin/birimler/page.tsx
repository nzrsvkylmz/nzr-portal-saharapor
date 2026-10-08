import { asc, eq } from "drizzle-orm";
import { requireRole } from "@/lib/auth/dal";
import { db } from "@/lib/db";
import { unitAliases, units, type Unit } from "@/lib/db/schema";
import { isExcludedUnit } from "@/lib/domain/matching";
import { norm } from "@/lib/domain/normalize";
import {
  addAlias,
  applySuggestedParents,
  createUnit,
  deleteAlias,
  mergeUnitAsAlias,
  syncBagisBirimleri,
  updateUnit,
} from "./actions";

const inputCls =
  "rounded-lg border border-mint px-2 py-1 text-sm outline-none focus:border-primary";
const btnCls =
  "rounded-xl bg-primary px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-primary-dark";

function fmtTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(d);
}

const SOURCE_BADGE: Record<string, [string, string]> = {
  portal: ["portal", "bg-mint text-primary-dark"],
  bagis: ["bağış verisi", "bg-amber/25 text-ink"],
  manuel: ["manuel", "bg-ink/10 text-ink"],
};

export default async function BirimlerPage({
  searchParams,
}: {
  searchParams: Promise<{ hata?: string; mesaj?: string; evren?: string }>;
}) {
  await requireRole("SUPER_ADMIN");
  const { hata, mesaj, evren: evrenRaw } = await searchParams;
  const evren = evrenRaw === "yardim" || evrenRaw === "tum" ? evrenRaw : "bagis";

  const allUnits = (
    await db.select().from(units).orderBy(asc(units.bolgeNo), asc(units.name))
  ).filter((u) => !isExcludedUnit(u.name));
  const aliases = await db
    .select({ alias: unitAliases, unitName: units.name })
    .from(unitAliases)
    .innerJoin(units, eq(unitAliases.unitId, units.id))
    .orderBy(asc(unitAliases.aliasLabel));

  const nameById = new Map(allUnits.map((u) => [u.id, u.name]));
  const bolgeNos = [...new Set(allUnits.map((u) => u.bolgeNo).filter(Boolean))].sort(
    (a, b) => (a as number) - (b as number),
  ) as number[];

  const pending = allUnits.filter((u) => u.needsReview && u.active);
  const inEvren = (u: Unit) =>
    evren === "tum" ? true : evren === "yardim" ? u.yardimBirimi : u.bagisBirimi;
  const rest = allUnits.filter((u) => !(u.needsReview && u.active) && inEvren(u));

  const sayilar = {
    bagis: allUnits.filter((u) => u.bagisBirimi && !(u.needsReview && u.active)).length,
    yardim: allUnits.filter((u) => u.yardimBirimi && !(u.needsReview && u.active)).length,
    tum: allUnits.filter((u) => !(u.needsReview && u.active)).length,
  };

  const byBolge = new Map<string, Unit[]>();
  for (const u of rest) {
    const key = u.bolgeLabel ?? "BÖLGESİZ";
    byBolge.set(key, [...(byBolge.get(key) ?? []), u]);
  }
  const lastSync = allUnits.reduce<Date | null>(
    (acc, u) => (u.syncedAt && (!acc || u.syncedAt > acc) ? u.syncedAt : acc),
    null,
  );

  /** Tire sezgisi yalnız öneri üretir; kaydetmeden hiçbir etkisi yok. */
  function parentSuggestion(u: Unit): string {
    if (u.parentUnitId || !u.name.includes("-")) return "";
    const prefix = u.name.replace(/ - /g, "-").split("-")[0].trim();
    const hit = allUnits.find(
      (x) => x.id !== u.id && !x.needsReview && norm(x.name) === norm(prefix),
    );
    return hit?.name ?? "";
  }

  function EditFields({ u }: { u: Unit }) {
    const suggestion = parentSuggestion(u);
    return (
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          Üst birim
          <input
            name="parentName"
            list="unit-options"
            defaultValue={u.parentUnitId ? (nameById.get(u.parentUnitId) ?? "") : ""}
            placeholder={suggestion ? `öneri: ${suggestion}` : "— yok (il düzeyi) —"}
            className={inputCls + " w-56"}
          />
        </label>
        <label className="flex items-center gap-2">
          Bölge
          <select name="bolgeNo" defaultValue={u.bolgeNo ?? ""} className={inputCls}>
            <option value="">—</option>
            {bolgeNos.map((b) => (
              <option key={b} value={b}>
                {b}.BÖLGE
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={u.active} className="accent-primary" />
          Aktif
        </label>
        <button type="submit" className={btnCls}>
          {u.needsReview ? "Kaydet ve Onayla" : "Kaydet"}
        </button>
      </div>
    );
  }

  function UnitBadges({ u }: { u: Unit }) {
    const [label, cls] = SOURCE_BADGE[u.source] ?? SOURCE_BADGE.manuel;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={u.active ? "font-medium" : "font-medium text-ink/40 line-through"}>
          {u.isBolgeMudurlugu ? <strong>{u.name}</strong> : u.name}
        </span>
        {u.bagisBirimi && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary-dark">
            bağış
          </span>
        )}
        {u.yardimBirimi && (
          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">
            yardım
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>
        {u.needsReview && (
          <span className="rounded-full bg-amber/25 px-2 py-0.5 text-xs">onay bekliyor</span>
        )}
        {u.parentUnitId && (
          <span className="text-xs text-ink/50">
            üst: {nameById.get(u.parentUnitId) ?? "?"}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary-dark">Birimler</h1>
          <p className="mt-1 text-sm text-ink/60">
            İki ayrı evren tek kayıtta buluşur: <strong>bağış kabul birimleri</strong>{" "}
            (departman ağacı) ve <strong>yardım sorumlu birimleri</strong>. Üst birim
            hiyerarşisi yalnız bağış görünürlüğünü etkiler ve yalnızca bu ekrandan
            atanır. Son senkron: {fmtTime(lastSync)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={syncBagisBirimleri}>
            <button
              type="submit"
              className="rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-white"
            >
              ⇅ Bağış birimlerini senkronla
            </button>
          </form>
          {pending.length > 0 && (
            <form action={applySuggestedParents}>
              <button
                type="submit"
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark"
              >
                ✓ Önerilen üst birimleri uygula ({pending.length})
              </button>
            </form>
          )}
        </div>
      </div>

      {mesaj && (
        <p className="rounded-xl bg-mint/40 px-4 py-3 text-sm text-primary-dark">{mesaj}</p>
      )}
      {hata && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {hata}
        </p>
      )}

      <datalist id="unit-options">
        {allUnits
          .filter((u) => !u.needsReview)
          .map((u) => (
            <option key={u.id} value={u.name}>
              {u.bolgeLabel ? `${u.bolgeLabel} · ${u.name}` : u.name}
            </option>
          ))}
      </datalist>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">Yeni Birim Oluştur</h2>
        <p className="text-sm text-ink/60">
          Portal/bağış verisinde olmayan ara düzey birimler için — ör. il
          statüsündeki &quot;Bağlar&quot; temsilciliğini oluşturup
          Bağlar-Bismil gibi alt birimleri ona bağlayabilirsiniz.
        </p>
        <form
          action={createUnit}
          className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-5 text-sm shadow-sm"
        >
          <input name="name" required placeholder="birim adı (ör. Bağlar)" className={inputCls + " w-56"} />
          <label className="flex items-center gap-2">
            Bölge
            <select name="bolgeNo" defaultValue="" className={inputCls}>
              <option value="">—</option>
              {bolgeNos.map((b) => (
                <option key={b} value={b}>
                  {b}.BÖLGE
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Üst birim
            <input
              name="parentName"
              list="unit-options"
              placeholder="— yok (il düzeyi) —"
              className={inputCls + " w-56"}
            />
          </label>
          <button type="submit" className={btnCls}>
            Oluştur
          </button>
        </form>
      </section>

      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold">
            Onay Bekleyenler ({pending.length})
          </h2>
          <p className="text-sm text-ink/60">
            Raporlarda görünen ama tanımlı olmayan birimler. Üst birim/bölge
            atayıp onaylayın. &quot;Eşle&quot; yalnızca <em>aynı birimin farklı
            yazımı</em> içindir (gelecekteki raporlar hedef birime sayılır) —
            hiyerarşi kurmaz. Üst birim listede yoksa önce aşağıdan
            &quot;Yeni Birim Oluştur&quot;.
          </p>
          {pending.map((u) => (
            <div key={u.id} className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
              <UnitBadges u={u} />
              <form action={updateUnit}>
                <input type="hidden" name="unitId" value={u.id} />
                <EditFields u={u} />
              </form>
              <form action={mergeUnitAsAlias} className="flex flex-wrap items-center gap-3 border-t border-mint/50 pt-3 text-sm">
                <input type="hidden" name="unitId" value={u.id} />
                <span className="text-ink/60">veya mevcut birime eşle:</span>
                <input
                  name="targetName"
                  list="unit-options"
                  required
                  placeholder="hedef birim adı"
                  className={inputCls + " w-56"}
                />
                <button type="submit" className={btnCls}>
                  Eşle
                </button>
              </form>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold">
          Takma Adlar ({aliases.length})
        </h2>
        <p className="text-sm text-ink/60">
          Bağış raporlarında farklı yazılan birim adlarını doğru birime yönlendirir.
        </p>
        <div className="space-y-2 rounded-2xl bg-white p-5 shadow-sm">
          {aliases.length === 0 ? (
            <p className="text-sm text-ink/60">Tanımlı takma ad yok.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {aliases.map(({ alias, unitName }) => (
                <li key={alias.id} className="flex items-center gap-3">
                  <span>
                    <span className="font-medium">{alias.aliasLabel}</span>
                    <span className="text-ink/50"> → {unitName}</span>
                  </span>
                  <form action={deleteAlias}>
                    <input type="hidden" name="aliasId" value={alias.id} />
                    <button type="submit" className="text-xs text-red-700 underline">
                      sil
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addAlias} className="flex flex-wrap items-center gap-3 border-t border-mint/50 pt-3 text-sm">
            <input name="aliasLabel" required placeholder="raporlardaki yazım" className={inputCls + " w-56"} />
            <span className="text-ink/50">→</span>
            <input
              name="targetName"
              list="unit-options"
              required
              placeholder="hedef birim adı"
              className={inputCls + " w-56"}
            />
            <button type="submit" className={btnCls}>
              Takma Ad Ekle
            </button>
          </form>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="font-heading text-lg font-semibold">Birim Listesi</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            {(
              [
                ["bagis", `Bağış birimleri (${sayilar.bagis})`],
                ["yardim", `Yardım birimleri (${sayilar.yardim})`],
                ["tum", `Tümü (${sayilar.tum})`],
              ] as const
            ).map(([k, t]) => (
              <a
                key={k}
                href={`/admin/birimler?evren=${k}`}
                className={
                  evren === k
                    ? "rounded-full bg-primary px-4 py-1.5 font-semibold text-white"
                    : "rounded-full bg-white px-4 py-1.5 text-ink/70 shadow-sm transition hover:bg-mint"
                }
              >
                {t}
              </a>
            ))}
          </div>
        </div>
        {rest.length === 0 ? (
          <p className="rounded-xl bg-amber/15 px-4 py-3 text-sm">
            Henüz birim senkronlanmadı. Yardım raporunu bir kez güncelleyin.
          </p>
        ) : (
          [...byBolge.entries()].map(([bolge, list]) => (
            <details key={bolge} className="rounded-2xl bg-white p-5 shadow-sm" open={bolge === "BÖLGESİZ"}>
              <summary className="cursor-pointer font-heading font-semibold text-primary">
                {bolge} ({list.length})
              </summary>
              <div className="mt-3 space-y-3">
                {list.map((u) => (
                  <form
                    key={u.id}
                    action={updateUnit}
                    className="space-y-2 border-b border-mint/40 pb-3 last:border-b-0 last:pb-0"
                  >
                    <input type="hidden" name="unitId" value={u.id} />
                    <UnitBadges u={u} />
                    <EditFields u={u} />
                  </form>
                ))}
              </div>
            </details>
          ))
        )}
      </section>
    </div>
  );
}
