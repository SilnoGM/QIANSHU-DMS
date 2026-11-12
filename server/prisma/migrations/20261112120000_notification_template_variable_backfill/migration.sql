BEGIN;

-- 站内模板标题使用了单号占位符，但 variables 白名单漏声明，渲染层会按
-- TEMPLATE_VARIABLE_MISSING 跳过整个站内渠道。这里只做幂等补齐，不覆盖
-- 已存在的定义，避免影响后续人工调整。
WITH "backfill" ("key", "variable") AS (
  VALUES
    ('sales.receipt.pending', 'collectionNo'),
    ('sales.receipt.approved', 'collectionNo'),
    ('sales.receipt.rejected', 'collectionNo'),
    ('purchase.review.approved', 'orderNo'),
    ('purchase.review.rejected', 'orderNo'),
    ('purchase.order.cancelled', 'orderNo'),
    ('purchase.order.completed', 'orderNo'),
    ('sales.order.completed', 'orderNo'),
    ('sales.order.terminated', 'orderNo'),
    ('shipment.signed', 'orderNo'),
    ('invoice.returned', 'invoiceNo'),
    ('invoice.notified', 'invoiceNo'),
    ('invoice.issued', 'invoiceNo'),
    ('invoice.settled', 'invoiceNo'),
    ('invoice.cancelled', 'invoiceNo'),
    ('fund.withdrawal.pending', 'withdrawalNo'),
    ('fund.withdrawal.approved', 'withdrawalNo'),
    ('fund.withdrawal.rejected', 'withdrawalNo'),
    ('operations.advertising-recharge.pending', 'rechargeNo'),
    ('operations.advertising-recharge.paid', 'rechargeNo'),
    ('operations.advertising-recharge.rejected', 'rechargeNo'),
    ('operations.advertising-recharge.voided', 'rechargeNo'),
    ('operations.machine-viewing.created', 'appointmentNo'),
    ('slh.reconciliation.completed', 'batchNo'),
    ('shipment.storage-claim.pending', 'shipmentNo'),
    ('shipment.storage-claim.approved', 'shipmentNo'),
    ('shipment.storage-claim.rejected', 'shipmentNo')
)
UPDATE "notification_templates" AS "template"
SET "variables" = "template"."variables" || jsonb_build_array(
        jsonb_build_object(
            'name', "backfill"."variable",
            'required', false,
            'maxLength', 64,
            'sensitive', false
        )
    ),
    "version" = "template"."version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
FROM "backfill"
WHERE "template"."key" = "backfill"."key"
  AND "template"."channel" = 'IN_APP'
  AND NOT "template"."variables" @> jsonb_build_array(
        jsonb_build_object('name', "backfill"."variable")
    );

COMMIT;
