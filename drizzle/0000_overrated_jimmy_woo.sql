CREATE TYPE "public"."bagis_scope" AS ENUM('bolge', 'unit');--> statement-breakpoint
CREATE TYPE "public"."portal_state" AS ENUM('authenticated', 'verify', 'login', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('SUPER_ADMIN', 'ADMIN_BAGIS', 'ADMIN_YARDIM', 'BOLGE_MUDURU', 'TEMSILCI');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('bagis', 'yardim');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'done', 'error');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."yardim_scope" AS ENUM('bolge', 'unit', 'unmatched');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bagis_aggregates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"scope" "bagis_scope" NOT NULL,
	"bolge_label" text NOT NULL,
	"unit_id" integer,
	"unit_label" text,
	"donation_count" integer NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" char(7) NOT NULL,
	"bolge_label" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"cookie_jar_enc" text NOT NULL,
	"state" "portal_state" DEFAULT 'unknown' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "report_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "run_kind" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"progress_msg" text,
	"error" text,
	"row_count" integer,
	"triggered_by" uuid,
	"is_cron" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	"ip" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" serial PRIMARY KEY NOT NULL,
	"dep_id" text NOT NULL,
	"name" text NOT NULL,
	"bolge_no" integer,
	"bolge_label" text,
	"is_bolge_mudurlugu" boolean DEFAULT false NOT NULL,
	"city_key" text,
	"district_key" text,
	"active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone,
	CONSTRAINT "units_dep_id_unique" UNIQUE("dep_id")
);
--> statement-breakpoint
CREATE TABLE "user_units" (
	"user_id" uuid NOT NULL,
	"unit_id" integer NOT NULL,
	CONSTRAINT "user_units_user_id_unit_id_pk" PRIMARY KEY("user_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_nick" text NOT NULL,
	"display_name" text,
	"role" "role",
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	"bolge_no" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_portal_nick_unique" UNIQUE("portal_nick")
);
--> statement-breakpoint
CREATE TABLE "yardim_aggregates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"scope" "yardim_scope" NOT NULL,
	"bolge_label" text,
	"unit_id" integer,
	"unit_label" text,
	"stage_key" text NOT NULL,
	"days" jsonb NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bagis_aggregates" ADD CONSTRAINT "bagis_aggregates_run_id_report_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bagis_aggregates" ADD CONSTRAINT "bagis_aggregates_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_units" ADD CONSTRAINT "user_units_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_units" ADD CONSTRAINT "user_units_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yardim_aggregates" ADD CONSTRAINT "yardim_aggregates_run_id_report_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."report_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yardim_aggregates" ADD CONSTRAINT "yardim_aggregates_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bagis_agg_run_scope" ON "bagis_aggregates" USING btree ("run_id","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_month_bolge" ON "plans" USING btree ("month","bolge_label");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_run" ON "report_runs" USING btree ("kind") WHERE "report_runs"."status" IN ('queued','running');--> statement-breakpoint
CREATE INDEX "yardim_agg_run_scope" ON "yardim_aggregates" USING btree ("run_id","scope");