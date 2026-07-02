CREATE TABLE "agent_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"agent" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"severity" text,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_id" text,
	"model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"genre" text DEFAULT 'biography' NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"agent" text NOT NULL,
	"genre" text DEFAULT 'common' NOT NULL,
	"version" text DEFAULT 'v1' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system_prompt" text NOT NULL,
	"user_prompt_template" text NOT NULL,
	"output_format" text,
	"eval_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"section_id" text NOT NULL,
	"chapter_title" text NOT NULL,
	"section_title" text NOT NULL,
	"body" text NOT NULL,
	"editor_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"follow_up_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fact_check_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"continuity_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_id" text,
	"model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_reports" ADD CONSTRAINT "agent_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_reports_project_agent_idx" ON "agent_reports" USING btree ("project_id","agent");--> statement-breakpoint
CREATE INDEX "agent_reports_target_idx" ON "agent_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "prompts_agent_genre_version_idx" ON "prompt_templates" USING btree ("agent","genre","version");--> statement-breakpoint
CREATE INDEX "sections_project_chapter_idx" ON "sections" USING btree ("project_id","chapter_id");--> statement-breakpoint
CREATE INDEX "sections_key_idx" ON "sections" USING btree ("project_id","chapter_id","section_id");