CREATE TABLE `datasource_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`provider` text NOT NULL,
	`created_by` text NOT NULL,
	`account` text,
	`status` text NOT NULL,
	`encrypted_config` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `datasource_authorizations_workspace_idx` ON `datasource_authorizations` (`workspace_id`);