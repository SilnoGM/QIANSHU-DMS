BEGIN;

-- 通知优先级收敛：HIGH 只保留真正需要插队的紧急事件。
-- 审核、驳回、待付款等日常事件回到 NORMAL，避免高优先级队列长期压制普通消息。
UPDATE "notification_channel_policies"
SET
  "priority" = 'NORMAL',
  "version" = "version" + 1,
  "updated_at" = clock_timestamp()
WHERE "priority" = 'HIGH'
  AND "event_type" NOT IN (
    'ASSISTANT_ACCOUNT_OFFLINE',
    'FUND_ACCOUNT_REVERSED',
    'PROXY_NODE_EXPIRED',
    'ADVERTISING_RECHARGE_VOIDED',
    'SALES_ORDER_TERMINATED',
    'PURCHASE_ORDER_CANCELLED'
  );

-- 紧急事件统一提升为 HIGH；资金冲账此前使用 NORMAL。
UPDATE "notification_channel_policies"
SET
  "priority" = 'HIGH',
  "version" = "version" + 1,
  "updated_at" = clock_timestamp()
WHERE "priority" = 'NORMAL'
  AND "event_type" IN (
    'ASSISTANT_ACCOUNT_OFFLINE',
    'FUND_ACCOUNT_REVERSED',
    'PROXY_NODE_EXPIRED',
    'ADVERTISING_RECHARGE_VOIDED',
    'SALES_ORDER_TERMINATED',
    'PURCHASE_ORDER_CANCELLED'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "notification_channel_policies"
    WHERE "priority" = 'HIGH'
      AND "event_type" NOT IN (
        'ASSISTANT_ACCOUNT_OFFLINE',
        'FUND_ACCOUNT_REVERSED',
        'PROXY_NODE_EXPIRED',
        'ADVERTISING_RECHARGE_VOIDED',
        'SALES_ORDER_TERMINATED',
        'PURCHASE_ORDER_CANCELLED'
      )
  ) THEN
    RAISE EXCEPTION 'notification policy priority is not normalized'
      USING ERRCODE = '23514', CONSTRAINT = 'notification_policy_priority_normalized';
  END IF;
END $$;

COMMIT;
