BEGIN;

-- 旧模板/策略 → 事件渠道内容的一次性复制。
--
-- 口径：
-- 1. 每个已登记事件的每条 notification_channel_policies 都复制为同事件同渠道的 notification_event_channels；
--    渠道已存在（管理员已用新模型配置过）时整行跳过，不覆盖新配置。
-- 2. 有效模板键 = 策略显式 template_key，否则该事件的旧默认模板键（下方 mapping）。
-- 3. 模板存在时复制一条 TEXT 消息；模板 media_policy 启用 IMAGE 时再复制一条 IMAGE 附件项。
-- 4. 模板缺失或模板停用时仍复制渠道元数据，但 enabled=false 且不写消息，保持旧路径“跳过”的有效行为。
-- 5. 旧 notification_templates / notification_channel_policies 表本迁移不删除，保留一个发布周期供回滚核对；
--    代码在此版本已停止读写旧表。
CREATE TEMP TABLE "notification_event_legacy_mapping" (
  "event_type" text PRIMARY KEY,
  "template_key" text NOT NULL
) ON COMMIT DROP;

INSERT INTO "notification_event_legacy_mapping" ("event_type", "template_key")
VALUES
    ('PURCHASE_REVIEW_PENDING', 'purchase.review.pending'),
    ('INVOICE_REQUEST_REVIEW_PENDING', 'invoice.review.pending'),
    ('SLH_RECONCILIATION_COMPLETED', 'slh.reconciliation.completed'),
    ('SHIPMENT_ARRIVED', 'shipment.arrived'),
    ('PURCHASE_REVIEW_APPROVED', 'purchase.review.approved'),
    ('PURCHASE_REVIEW_REJECTED', 'purchase.review.rejected'),
    ('PURCHASE_ORDER_CANCELLED', 'purchase.order.cancelled'),
    ('SALES_RECEIPT_REVIEW_PENDING', 'sales.receipt.pending'),
    ('SALES_RECEIPT_VOUCHER_SENT', 'sales.receipt.voucher-sent'),
    ('SALES_RECEIPT_APPROVED', 'sales.receipt.approved'),
    ('SALES_RECEIPT_REJECTED', 'sales.receipt.rejected'),
    ('STORAGE_CLAIM_REQUEST_PENDING', 'shipment.storage-claim.pending'),
    ('STORAGE_CLAIM_REQUEST_APPROVED', 'shipment.storage-claim.approved'),
    ('STORAGE_CLAIM_REQUEST_REJECTED', 'shipment.storage-claim.rejected'),
    ('SHIPMENT_RELEASED_TO_STORAGE', 'shipment.released-to-storage'),
    ('FUND_WITHDRAWAL_REVIEW_PENDING', 'fund.withdrawal.pending'),
    ('FUND_WITHDRAWAL_APPROVED', 'fund.withdrawal.approved'),
    ('FUND_WITHDRAWAL_REJECTED', 'fund.withdrawal.rejected'),
    ('PACKAGING_COST_PAYMENT_PENDING', 'packaging.payment.pending'),
    ('PACKAGING_COST_PAID', 'packaging.payment.paid'),
    ('PURCHASE_PAYABLE_PENDING', 'purchase.payable.pending'),
    ('INVOICE_REQUEST_RETURNED', 'invoice.returned'),
    ('INVOICE_REQUEST_NOTIFIED', 'invoice.notified'),
    ('INVOICE_REQUEST_ISSUED', 'invoice.issued'),
    ('INVOICE_REQUEST_SETTLED', 'invoice.settled'),
    ('INVOICE_REQUEST_CANCELLED', 'invoice.cancelled'),
    ('MACHINE_VIEWING_APPOINTMENT_CREATED', 'operations.machine-viewing.created'),
    ('MACHINE_VIEWING_APPOINTMENT_RESCHEDULED', 'operations.machine-viewing.rescheduled'),
    ('PROXY_NODE_EXPIRING', 'operations.proxy-node.expiring'),
    ('ADVERTISING_RECHARGE_PENDING', 'operations.advertising-recharge.pending'),
    ('ADVERTISING_RECHARGE_PAYMENT_CODE_REQUIRED', 'operations.advertising-recharge.payment-code'),
    ('ADVERTISING_RECHARGE_PAID', 'operations.advertising-recharge.paid'),
    ('ADVERTISING_RECHARGE_REJECTED', 'operations.advertising-recharge.rejected'),
    ('ADVERTISING_RECHARGE_VOIDED', 'operations.advertising-recharge.voided'),
    ('SALES_ORDER_SUBMITTED', 'sales.order.submitted'),
    ('SALES_ORDER_COMPLETED', 'sales.order.completed'),
    ('PURCHASE_ORDER_COMPLETED', 'purchase.order.completed'),
    ('SHIPMENT_SIGNED', 'shipment.signed'),
    ('SALES_ORDER_TERMINATED', 'sales.order.terminated'),
    ('FUND_ACCOUNT_ADJUSTED', 'fund.account.adjusted'),
    ('PROXY_NODE_EXPIRED', 'operations.proxy-node.expired'),
    ('FUND_ACCOUNT_REVERSED', 'fund.account.reversed'),
    ('AD_ACCOUNT_BALANCE_LOW', 'operations.ad-account.balance-low');

WITH resolved AS (
  SELECT
    policy.*,
    template.id AS template_id,
    template.enabled AS template_enabled,
    template.title_template,
    template.body_template,
    template.link_url_template,
    template.media_policy
  FROM "notification_channel_policies" AS policy
  JOIN "notification_event_legacy_mapping" AS mapping
    ON mapping.event_type = policy.event_type
  LEFT JOIN "notification_templates" AS template
    ON template.key = COALESCE(NULLIF(btrim(policy.template_key), ''), mapping.template_key)
   AND template.channel = policy.channel
),
inserted AS (
  INSERT INTO "notification_event_channels" (
    "id",
    "event_type",
    "channel",
    "send_method",
    "enabled",
    "target_mode",
    "target_config",
    "ttl_seconds",
    "quiet_hours",
    "allow_sensitive",
    "version",
    "updated_by_user_id",
    "created_at",
    "updated_at"
  )
  SELECT
    gen_random_uuid(),
    resolved.event_type,
    resolved.channel,
    CASE
      WHEN resolved.channel = 'WECOM' AND resolved.target_mode = 'GROUP'
        THEN 'ROBOT'::"notification_send_method"
      WHEN resolved.channel = 'WECOM'
        THEN 'APP'::"notification_send_method"
      ELSE 'IN_APP'::"notification_send_method"
    END,
    resolved.enabled AND COALESCE(resolved.template_enabled, false),
    resolved.target_mode,
    resolved.target_config,
    CASE WHEN resolved.channel = 'IN_APP' THEN NULL ELSE resolved.ttl_seconds END,
    CASE WHEN resolved.channel = 'IN_APP' THEN NULL ELSE resolved.quiet_hours END,
    CASE WHEN resolved.channel = 'IN_APP' THEN false ELSE resolved.allow_sensitive END,
    GREATEST(resolved.version, 1),
    resolved.updated_by_user_id,
    resolved.created_at,
    resolved.updated_at
  FROM resolved
  ON CONFLICT ("event_type", "channel") DO NOTHING
  RETURNING "id", "event_type", "channel"
),
message_specs AS (
  SELECT
    inserted.id AS channel_config_id,
    0 AS sort_order,
    'TEXT'::"notification_message_kind" AS kind,
    jsonb_build_object(
      'title', resolved.title_template,
      'content', resolved.body_template,
      'linkUrl', resolved.link_url_template
    ) AS payload,
    '{}'::jsonb AS media_policy
  FROM inserted
  JOIN resolved
    ON resolved.event_type = inserted.event_type
   AND resolved.channel = inserted.channel
  WHERE resolved.template_id IS NOT NULL
    AND length(btrim(resolved.body_template)) > 0

  UNION ALL

  SELECT
    inserted.id AS channel_config_id,
    1 AS sort_order,
    'IMAGE'::"notification_message_kind" AS kind,
    '{}'::jsonb AS payload,
    jsonb_build_object(
      'sourceKeys',
      CASE
        WHEN jsonb_typeof(resolved.media_policy -> 'sources') = 'array'
          THEN resolved.media_policy -> 'sources'
        ELSE '[]'::jsonb
      END,
      'maxCount', COALESCE((resolved.media_policy ->> 'maxCount')::int, 0)
    ) AS media_policy
  FROM inserted
  JOIN resolved
    ON resolved.event_type = inserted.event_type
   AND resolved.channel = inserted.channel
  WHERE resolved.template_id IS NOT NULL
    AND resolved.channel = 'WECOM'
    AND COALESCE((resolved.media_policy ->> 'enabled')::boolean, false)
    AND COALESCE((resolved.media_policy ->> 'maxCount')::int, 0) > 0
    AND (resolved.media_policy -> 'kinds') ? 'IMAGE'
)
INSERT INTO "notification_event_channel_messages" (
  "id",
  "channel_config_id",
  "sort_order",
  "kind",
  "payload",
  "media_policy",
  "content_hash",
  "enabled"
)
SELECT
  gen_random_uuid(),
  message_specs.channel_config_id,
  message_specs.sort_order,
  message_specs.kind,
  message_specs.payload,
  message_specs.media_policy,
  NULL,
  true
FROM message_specs;

-- 自校验：每个已登记事件的旧策略都必须有对应事件渠道；启用的渠道必须至少有一条消息内容。
DO $$
DECLARE
  missing_channels integer;
  missing_content integer;
BEGIN
  SELECT count(*)
  INTO missing_channels
  FROM "notification_channel_policies" AS policy
  JOIN "notification_event_legacy_mapping" AS mapping
    ON mapping.event_type = policy.event_type
  LEFT JOIN "notification_event_channels" AS channel
    ON channel.event_type = policy.event_type
   AND channel.channel = policy.channel
  WHERE channel.id IS NULL;

  IF missing_channels > 0 THEN
    RAISE EXCEPTION 'notification legacy content migration left % policies without event channel', missing_channels
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*)
  INTO missing_content
  FROM "notification_event_channels" AS channel
  WHERE channel.enabled
    AND NOT EXISTS (
      SELECT 1
      FROM "notification_event_channel_messages" AS message
      WHERE message.channel_config_id = channel.id
    );

  IF missing_content > 0 THEN
    RAISE EXCEPTION 'notification legacy content migration left % enabled channels without content', missing_content
      USING ERRCODE = '23514';
  END IF;
END;
$$;

COMMIT;
