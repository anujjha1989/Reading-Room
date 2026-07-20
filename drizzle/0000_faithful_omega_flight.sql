CREATE TABLE `reading_state` (
	`user_email` text NOT NULL,
	`book_id` text NOT NULL,
	`file_id` text,
	`favorite` integer DEFAULT false NOT NULL,
	`last_opened` integer,
	`progress_label` text,
	`position` text,
	`status` text DEFAULT 'unread' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_email`, `book_id`)
);
