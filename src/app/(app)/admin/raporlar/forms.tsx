"use client";

import { RaporTetikleyici } from "@/components/RaporTetikleyici";

const inputCls =
  "rounded-lg border border-mint px-2 py-1.5 text-sm outline-none focus:border-primary";

export function BagisForm({
  defaults,
  activities,
  pools,
  types,
}: {
  defaults: { ay: string };
  activities: Array<[string, string]>;
  pools: Array<[string, string]>;
  types: Array<[string, string]>;
}) {
  return (
    <RaporTetikleyici
      kind="bagis"
      title="Bağış Raporu"
      buildBody={(form) => {
        const fd = new FormData(form);
        return {
          ayA: fd.get("ayA"),
          ayB: fd.get("ayB"),
          types: fd.getAll("types").join(",") || "1,2,3,4,5",
          activity: fd.getAll("activity").join(",") || "1,15",
          pool: fd.get("pool") || "1",
        };
      }}
    >
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          Başlangıç ayı
          <input name="ayA" type="month" defaultValue={defaults.ay} required className={inputCls} />
        </label>
        <label className="flex items-center gap-2">
          Bitiş ayı
          <input name="ayB" type="month" defaultValue={defaults.ay} required className={inputCls} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          Fon Bölgesi
          <select name="pool" defaultValue={pools[0]?.[0]} className={inputCls}>
            {pools.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="text-sm">
        <legend className="mb-1 text-ink/70">Faaliyetler (birden fazla seçilebilir)</legend>
        <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
          {activities.map(([v, t]) => (
            <label key={v} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="activity"
                value={v}
                defaultChecked={["1", "15"].includes(v)}
                className="accent-primary"
              />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="text-sm">
        <legend className="mb-1 text-ink/70">Bağış türleri</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {types.map(([v, t]) => (
            <label key={v} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="types"
                value={v}
                defaultChecked={["1", "2", "3", "4", "5"].includes(v)}
                className="accent-primary"
              />
              {t}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-ink/50">
        Seçilen aylar portaldan tam ay olarak yeniden çekilip yenilenir; diğer
        aylar son halleriyle kalır. Günlük kullanım: yalnız içinde bulunulan
        ay. Portalda geçmişe dönük düzeltme yapıldıysa o ayı da kapsayacak
        şekilde seçin (ör. Eylül–Ekim).
      </p>
    </RaporTetikleyici>
  );
}

export function YardimForm() {
  return (
    <RaporTetikleyici
      kind="yardim"
      title="Yardım Raporu"
      buildBody={(form) => {
        const fd = new FormData(form);
        return { thresholdDays: Number(fd.get("thresholdDays") ?? 90) };
      }}
    >
      <p className="text-sm text-ink/70">
        Sosyal İnceleme ve Bölge Koordinatörü Kararı aşamalarındaki TÜM
        bekleyen başvurular çekilir, birim listesi senkronlanır.
      </p>
      <label className="flex items-center gap-2 text-sm">
        Kritik eşik (gün)
        <input
          name="thresholdDays"
          type="number"
          min={1}
          max={365}
          defaultValue={90}
          className={inputCls + " w-24"}
        />
      </label>
      <p className="text-xs text-ink/50">Çekim ~25-60 sn sürer; sayfadan ayrılmayın.</p>
    </RaporTetikleyici>
  );
}
