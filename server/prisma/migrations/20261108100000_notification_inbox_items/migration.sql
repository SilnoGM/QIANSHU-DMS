BEGIN;

CREATE TABLE "notification_inbox_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "template_version" INTEGER NOT NULL,
    "title_snapshot" TEXT NOT NULL,
    "body_snapshot" TEXT NOT NULL,
    "link_url_snapshot" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_inbox_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_inbox_items_notification_user_key"
    ON "notification_inbox_items" ("notification_id", "user_id");

CREATE INDEX "notification_inbox_items_user_archived_created_idx"
    ON "notification_inbox_items" ("user_id", "archived_at", "created_at" DESC);

CREATE INDEX "notification_inbox_items_user_event_created_idx"
    ON "notification_inbox_items" ("user_id", "event_type", "created_at" DESC);

CREATE INDEX "notification_inbox_items_user_read_archived_idx"
    ON "notification_inbox_items" ("user_id", "read_at", "archived_at");

ALTER TABLE "notification_inbox_items"
    ADD CONSTRAINT "notification_inbox_items_event_type_check" CHECK ("event_type" <> ''),
    ADD CONSTRAINT "notification_inbox_items_title_snapshot_check" CHECK ("title_snapshot" <> ''),
    ADD CONSTRAINT "notification_inbox_items_body_snapshot_check" CHECK ("body_snapshot" <> '');

ALTER TABLE "notification_inbox_items"
    ADD CONSTRAINT "notification_inbox_items_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "notifications" ("id") ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "notification_inbox_items"
    ADD CONSTRAINT "notification_inbox_items_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE RESTRICT;

INSERT INTO "notification_channel_settings" ("channel", "enabled")
VALUES ('IN_APP', true)
ON CONFLICT ("channel") DO NOTHING;

INSERT INTO "notification_templates" (
    "key", "channel", "name", "message_kind", "title_template", "body_template", "variables", "max_length", "enabled"
)
VALUES (
    'purchase.review.pending',
    'IN_APP',
    '采购审核待办',
    'TEXT',
    '采购单 {{orderNo}} 待审核',
    $body$客户：{{customerName}}
金额：{{currencyCode}} {{totalAmount}}
明细：{{lineCount}} 行 / {{partCount}} 个货件$body$,
    $variables$[
      {"name":"orderNo","required":true,"maxLength":64,"sensitive":false},
      {"name":"customerName","required":true,"maxLength":128,"sensitive":true},
      {"name":"currencyCode","required":true,"maxLength":16,"sensitive":false},
      {"name":"totalAmount","required":true,"maxLength":32,"sensitive":true},
      {"name":"lineCount","required":true,"maxLength":16,"sensitive":false},
      {"name":"partCount","required":true,"maxLength":16,"sensitive":false}
    ]$variables$::jsonb,
    2000,
    true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" (
    "key", "channel", "name", "message_kind", "title_template", "body_template", "variables", "max_length", "enabled"
)
VALUES (
    'invoice.review.pending',
    'IN_APP',
    '开票审核待办',
    'TEXT',
    '开票申请 {{invoiceNo}} 待审核',
    $body$购买方：{{buyerName}}
金额：{{totalAmount}}
明细：{{lineCount}} 行$body$,
    $variables$[
      {"name":"invoiceNo","required":true,"maxLength":64,"sensitive":false},
      {"name":"buyerName","required":true,"maxLength":128,"sensitive":true},
      {"name":"totalAmount","required":true,"maxLength":32,"sensitive":true},
      {"name":"lineCount","required":true,"maxLength":16,"sensitive":false}
    ]$variables$::jsonb,
    2000,
    true
)
ON CONFLICT ("key", "channel") DO NOTHING;

INSERT INTO "notification_templates" (
    "key", "channel", "name", "message_kind", "title_template", "body_template", "variables", "max_length", "enabled"
)
VALUES (
    'shipment.arrived',
    'IN_APP',
    '货件到仓待办',
    'TEXT',
    '采购单 {{orderNo}} 货件到仓',
    $body$货件：{{partNumbers}}
到仓时间：{{receivedAt}}
客户：{{customerName}}$body$,
    $variables$[
      {"name":"orderNo","required":true,"maxLength":64,"sensitive":false},
      {"name":"partNumbers","required":true,"maxLength":128,"sensitive":false},
      {"name":"receivedAt","required":true,"maxLength":64,"sensitive":false},
      {"name":"customerName","required":true,"maxLength":128,"sensitive":true}
    ]$variables$::jsonb,
    2000,
    true
)
ON CONFLICT ("key", "channel") DO NOTHING;

COMMIT;
