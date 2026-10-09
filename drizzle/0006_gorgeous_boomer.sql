CREATE TABLE "unit_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" char(7) NOT NULL,
	"unit_id" integer NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unit_plans" ADD CONSTRAINT "unit_plans_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_plans" ADD CONSTRAINT "unit_plans_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unit_plans_month_unit" ON "unit_plans" USING btree ("month","unit_id");