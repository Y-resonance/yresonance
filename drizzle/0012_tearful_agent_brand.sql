CREATE TABLE `datasource_connections` (
	`datasource_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`encrypted_config` text NOT NULL,
	FOREIGN KEY (`datasource_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
