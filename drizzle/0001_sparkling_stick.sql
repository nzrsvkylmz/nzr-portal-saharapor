CREATE TYPE "public"."unit_source" AS ENUM('portal', 'bagis', 'manuel');--> statement-breakpoint
CREATE TABLE "unit_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"alias_key" text NOT NULL,
	"alias_label" text NOT NULL,
	"unit_id" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unit_aliases_alias_key_unique" UNIQUE("alias_key")
);
--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "parent_unit_id" integer;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "source" "unit_source" DEFAULT 'portal' NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "unit_aliases" ADD CONSTRAINT "unit_aliases_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_aliases" ADD CONSTRAINT "unit_aliases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_parent_unit_id_units_id_fk" FOREIGN KEY ("parent_unit_id") REFERENCES "public"."units"("id") ON DELETE set null ON UPDATE no action;