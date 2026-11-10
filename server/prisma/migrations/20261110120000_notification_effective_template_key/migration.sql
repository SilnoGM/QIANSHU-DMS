-- 渠道策略可以覆盖业务默认模板键；只存版本号无法反查实际渲染的是哪份模板。
ALTER TABLE "notification_inbox_items" ADD COLUMN "template_key" VARCHAR(64);
ALTER TABLE "assistant_deliveries" ADD COLUMN "template_key" VARCHAR(64);

UPDATE "notification_inbox_items" AS item
SET "template_key" = notification."template_key"
FROM "notifications" AS notification
WHERE notification."id" = item."notification_id";

UPDATE "assistant_deliveries" AS delivery
SET "template_key" = notification."template_key"
FROM "notifications" AS notification
WHERE notification."id" = delivery."notification_id";

ALTER TABLE "notification_inbox_items" ALTER COLUMN "template_key" SET NOT NULL;
ALTER TABLE "assistant_deliveries" ALTER COLUMN "template_key" SET NOT NULL;
