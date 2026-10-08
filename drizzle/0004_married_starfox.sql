ALTER TABLE "bagis_aggregates" DROP CONSTRAINT "bagis_aggregates_run_id_report_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "bagis_aggregates" ALTER COLUMN "run_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bagis_aggregates" ADD CONSTRAINT "bagis_aggregates_run_id_report_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."report_runs"("id") ON DELETE set null ON UPDATE no action;