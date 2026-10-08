/**
 * Rol → görünür birim kümesi. TÜM rapor sorguları bu kapsamla süzülür;
 * client tarafında asla filtreleme yapılmaz.
 *
 * Alan (domain) ayrımı:
 *  - "bagis": temsilci, atandığı birim + admin'in bağladığı TÜM alt birimleri
 *    görür (parent_unit_id hiyerarşisi — isimden tahmin edilmez).
 *  - "yardim": temsilci yalnız atandığı birim(ler)i görür; alt kırılım yok.
 * Bölge müdürü her iki alanda kendi bölgesinin tamamını, adminler her şeyi görür.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { units, userUnits, type Unit, type User } from "@/lib/db/schema";

export type ScopeDomain = "bagis" | "yardim";

export interface VisibleScope {
  all: boolean; // adminler: her şey (EŞLENMEYEN/DİĞER dahil)
  bolgeLabels: string[]; // görünür bölge etiketleri ('1.BÖLGE')
  unitIds: number[]; // görünür birim id'leri
  unitLabels: string[]; // görünür birim adları (aggregate satır eşleşmesi için)
}

/** Atanan birimlerden parent_unit_id hiyerarşisi boyunca tüm altları toplar. */
function withDescendants(assigned: Unit[], all: Unit[]): Unit[] {
  const children = new Map<number, Unit[]>();
  for (const u of all) {
    if (u.parentUnitId != null) {
      children.set(u.parentUnitId, [...(children.get(u.parentUnitId) ?? []), u]);
    }
  }
  const byId = new Map<number, Unit>();
  const queue = [...assigned];
  while (queue.length) {
    const cur = queue.pop()!;
    if (byId.has(cur.id)) continue;
    byId.set(cur.id, cur);
    for (const child of children.get(cur.id) ?? []) queue.push(child);
  }
  return [...byId.values()];
}

export async function visibleScope(
  user: User,
  domain: ScopeDomain,
): Promise<VisibleScope> {
  if (
    user.role === "SUPER_ADMIN" ||
    user.role === "ADMIN_BAGIS" ||
    user.role === "ADMIN_YARDIM"
  ) {
    return { all: true, bolgeLabels: [], unitIds: [], unitLabels: [] };
  }

  if (user.role === "BOLGE_MUDURU" && user.bolgeNo) {
    const rows = await db
      .select()
      .from(units)
      .where(eq(units.bolgeNo, user.bolgeNo));
    return {
      all: false,
      bolgeLabels: [`${user.bolgeNo}.BÖLGE`],
      unitIds: rows.map((u) => u.id),
      unitLabels: rows.map((u) => u.name),
    };
  }

  if (user.role === "TEMSILCI") {
    const assignedRows = await db
      .select({ unit: units })
      .from(userUnits)
      .innerJoin(units, eq(userUnits.unitId, units.id))
      .where(eq(userUnits.userId, user.id));
    const assigned = assignedRows.map((r) => r.unit).filter((u) => u.active);

    let list: Unit[];
    if (domain === "bagis") {
      const all = await db.select().from(units).where(eq(units.active, true));
      list = withDescendants(assigned, all);
    } else {
      list = assigned; // yardımda alt kırılım yok
    }
    return {
      all: false,
      bolgeLabels: [...new Set(list.map((u) => u.bolgeLabel).filter(Boolean))] as string[],
      unitIds: list.map((u) => u.id),
      unitLabels: list.map((u) => u.name),
    };
  }

  return { all: false, bolgeLabels: [], unitIds: [], unitLabels: [] };
}
