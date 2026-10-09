import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigserial,
  boolean,
  char,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", [
  "SUPER_ADMIN",
  "ADMIN_BAGIS",
  "ADMIN_YARDIM",
  "BOLGE_MUDURU",
  "TEMSILCI",
]);

export const userStatusEnum = pgEnum("user_status", [
  "pending",
  "active",
  "disabled",
]);

export const portalStateEnum = pgEnum("portal_state", [
  "authenticated",
  "verify",
  "login",
  "unknown",
]);

export const runKindEnum = pgEnum("run_kind", ["bagis", "yardim"]);

export const runStatusEnum = pgEnum("run_status", [
  "queued",
  "running",
  "done",
  "error",
]);

export const yardimScopeEnum = pgEnum("yardim_scope", [
  "bolge",
  "unit",
  "unmatched",
]);

export const bagisScopeEnum = pgEnum("bagis_scope", ["bolge", "unit"]);

export const unitSourceEnum = pgEnum("unit_source", ["portal", "bagis", "manuel"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  portalNick: text("portal_nick").notNull().unique(), // lower(trim) normalize edilerek yazılır
  displayName: text("display_name"),
  role: roleEnum("role"), // NULL = yetki bekliyor
  status: userStatusEnum("status").notNull().default("pending"),
  bolgeNo: integer("bolge_no"), // BOLGE_MUDURU kapsamı
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const userUnits = pgTable(
  "user_units",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.unitId] })],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // sha256(opak token)
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  userAgent: text("user_agent"),
  ip: text("ip"),
});

export const portalSessions = pgTable("portal_sessions", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  cookieJarEnc: text("cookie_jar_enc").notNull(), // AES-256-GCM(iv||ct||tag) base64
  state: portalStateEnum("state").notNull().default("unknown"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
});

export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  depId: text("dep_id").notNull().unique(), // portal department id; bağış kaynaklılarda 'bagis:<norm>'
  name: text("name").notNull(), // "Malatya", "Diyarbakır-Kayapınar"
  bolgeNo: integer("bolge_no"), // özel birimlerde NULL
  bolgeLabel: text("bolge_label"), // "1.BÖLGE"
  isBolgeMudurlugu: boolean("is_bolge_mudurlugu").notNull().default(false),
  cityKey: text("city_key"), // norm("Diyarbakır") — yalnız öneri; görünürlüğe karar vermez
  districtKey: text("district_key"), // norm("Kayapınar")
  active: boolean("active").notNull().default(true), // yalnız admin yönetir; senkronlar dokunmaz
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  // Evren üyelikleri: iki ayrı portal listesi, iki ayrı senkron yönetir.
  bagisBirimi: boolean("bagis_birimi").notNull().default(false), // departman ağacında bağış kabul birimi
  yardimBirimi: boolean("yardim_birimi").notNull().default(false), // yardım "Sorumlu Birim" listesinde
  // Admin alanları: portal senkronu bunlara ASLA dokunmaz.
  parentUnitId: integer("parent_unit_id").references((): AnyPgColumn => units.id, {
    onDelete: "set null",
  }), // il temsilciliği → alt birim hiyerarşisi (yalnız admin ekranından atanır)
  source: unitSourceEnum("source").notNull().default("portal"),
  needsReview: boolean("needs_review").notNull().default(false), // yeni keşfedilen birim onay kuyruğunda
});

/** Bağış kabul birimi serbest metni → birim eşlemesi (yeniden adlandırma/varyant). */
export const unitAliases = pgTable("unit_aliases", {
  id: serial("id").primaryKey(),
  aliasKey: text("alias_key").notNull().unique(), // norm(ham etiket)
  aliasLabel: text("alias_label").notNull(), // ekranda gösterilen ham biçim
  unitId: integer("unit_id")
    .notNull()
    .references(() => units.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reportRuns = pgTable(
  "report_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: runKindEnum("kind").notNull(),
    status: runStatusEnum("status").notNull().default("queued"),
    params: jsonb("params").notNull().default({}),
    progressPct: integer("progress_pct").notNull().default(0),
    progressMsg: text("progress_msg"),
    error: text("error"),
    rowCount: integer("row_count"),
    triggeredBy: uuid("triggered_by").references(() => users.id),
    isCron: boolean("is_cron").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    // Tek-iş kilidi: aynı tür için aynı anda tek aktif çalıştırma
    uniqueIndex("one_active_run")
      .on(t.kind)
      .where(sql`${t.status} IN ('queued','running')`),
  ],
);

export const yardimAggregates = pgTable(
  "yardim_aggregates",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => reportRuns.id, { onDelete: "cascade" }),
    scope: yardimScopeEnum("scope").notNull(),
    bolgeLabel: text("bolge_label"),
    unitId: integer("unit_id").references(() => units.id),
    unitLabel: text("unit_label"),
    stageKey: text("stage_key").notNull(), // 'si' | 'bk' — genişleyebilir
    days: jsonb("days").notNull(), // bekleyen gün listesi [120,3,45,...]
    count: integer("count").notNull(),
  },
  (t) => [index("yardim_agg_run_scope").on(t.runId, t.scope)],
);

/**
 * Kalıcı aylık bağış deposu: her çekim kapsadığı ayların satırlarını silip
 * yeniden yazar, diğer aylar son halleriyle kalır. runId yalnız izlenebilirlik
 * içindir; run temizliğinde satırlar silinmez (set null).
 */
export const bagisAggregates = pgTable(
  "bagis_aggregates",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id").references(() => reportRuns.id, { onDelete: "set null" }),
    scope: bagisScopeEnum("scope").notNull(),
    activity: text("activity"), // bağış şartı etiketi ('Genel Bağış', 'Sadaka'); eski snapshot'larda NULL
    month: char("month", { length: 7 }), // '2026-10' — ay kırılımı; eski snapshot'larda NULL
    bolgeLabel: text("bolge_label").notNull(), // '1.BÖLGE' | 'DİĞER' | 'BELİRTİLMEMİŞ'
    unitId: integer("unit_id").references(() => units.id),
    unitLabel: text("unit_label"), // bölge toplam satırında NULL
    donationCount: integer("donation_count").notNull(),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [index("bagis_agg_run_scope").on(t.runId, t.scope)],
);

export const plans = pgTable(
  "plans",
  {
    id: serial("id").primaryKey(),
    month: char("month", { length: 7 }).notNull(), // '2026-10'
    bolgeLabel: text("bolge_label").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("plans_month_bolge").on(t.month, t.bolgeLabel)],
);

/** İl temsilciliği (birim) bazlı aylık Genel Bağış hedefleri. */
export const unitPlans = pgTable(
  "unit_plans",
  {
    id: serial("id").primaryKey(),
    month: char("month", { length: 7 }).notNull(), // '2026-10'
    unitId: integer("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("unit_plans_month_unit").on(t.month, t.unitId)],
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof users.$inferSelect;
export type Unit = typeof units.$inferSelect;
export type ReportRun = typeof reportRuns.$inferSelect;
export type Role = NonNullable<User["role"]>;
