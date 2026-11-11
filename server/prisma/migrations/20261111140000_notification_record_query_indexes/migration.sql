CREATE INDEX "notifications_published_idx" ON "notifications"("published_at" DESC, "id" DESC);

CREATE INDEX "notifications_status_published_idx" ON "notifications"("status", "published_at" DESC, "id" DESC);

CREATE INDEX "notification_inbox_items_notification_idx" ON "notification_inbox_items"("notification_id");

CREATE INDEX "assistant_deliveries_notification_idx" ON "assistant_deliveries"("notification_id");
