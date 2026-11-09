CREATE TABLE `refund_request_seats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`refund_id` integer NOT NULL,
	`seat_id` integer NOT NULL,
	FOREIGN KEY (`refund_id`) REFERENCES `refunds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`seat_id`) REFERENCES `seats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refund_request_seats_refund_idx` ON `refund_request_seats` (`refund_id`);--> statement-breakpoint
CREATE INDEX `refund_request_seats_seat_idx` ON `refund_request_seats` (`seat_id`);--> statement-breakpoint
ALTER TABLE `seats` ADD `refunded_at` text;