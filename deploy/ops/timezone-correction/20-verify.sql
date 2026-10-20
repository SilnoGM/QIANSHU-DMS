-- 修正后的只读验证。请在执行 10-correct.sql 之后、切换时区之前运行。
\set ON_ERROR_STOP on

\echo '=== 0. 会话时区（切换前仍应为 Asia/Shanghai） ==='
SELECT current_setting('TimeZone') AS session_time_zone;

\echo '=== 1. 销售收款：提交/审核时间差应为分钟级 ==='
SELECT
  collection_no,
  submitted_at,
  reviewed_at,
  reviewed_at - submitted_at AS delta
FROM sales_receipt_requests
ORDER BY submitted_at DESC
LIMIT 10;

SELECT
  count(*) AS reviewed_rows,
  max(reviewed_at - submitted_at) AS max_delta
FROM sales_receipt_requests
WHERE reviewed_at IS NOT NULL;

\echo '=== 2. 审计事件：最新事件应接近当前时间（排除清理事件） ==='
SELECT
  max(occurred_at) AS newest_occurred_at,
  now() - max(occurred_at) AS newest_audit_age
FROM audit_events
WHERE event_type <> 'AUTH_RETENTION_PURGED';

SELECT
  max(occurred_at) AS newest_retention_event_at,
  now() - max(occurred_at) AS retention_event_age
FROM audit_events
WHERE event_type = 'AUTH_RETENTION_PURGED';

\echo '=== 3. 未来时间检查（全部应为 0） ==='
SELECT 'sales_receipt_requests.submitted_at' AS metric, count(*) AS rows
FROM sales_receipt_requests WHERE submitted_at > now() + interval '1 minute'
UNION ALL
SELECT 'sales_order_payments.created_at', count(*)
FROM sales_order_payments WHERE created_at > now() + interval '1 minute'
UNION ALL
SELECT 'audit_events.occurred_at', count(*)
FROM audit_events WHERE occurred_at > now() + interval '1 minute'
UNION ALL
SELECT 'fund_posting_batches.posted_at', count(*)
FROM fund_posting_batches WHERE posted_at > now() + interval '1 minute'
UNION ALL
SELECT 'purchase_order_parts.loaded_at', count(*)
FROM purchase_order_parts WHERE loaded_at > now() + interval '1 minute';

\echo '=== 4. 货件时间约束（全部应为 0） ==='
SELECT 'loaded_at > loaded_recorded_at' AS metric, count(*) AS rows
FROM purchase_order_parts
WHERE loaded_at IS NOT NULL AND loaded_at > loaded_recorded_at
UNION ALL
SELECT 'warehouse_received_at outside [shipped_at, warehouse_recorded_at]', count(*)
FROM purchase_order_parts
WHERE warehouse_received_at IS NOT NULL
  AND (warehouse_received_at < shipped_at OR warehouse_received_at > warehouse_recorded_at);

\echo '=== 5. 混合列剩余候选（应只剩“保持不动”的行） ==='
SELECT
  'warehouse_received_at differs from recorded' AS metric,
  count(*) AS rows
FROM purchase_order_parts
WHERE warehouse_received_at IS NOT NULL
  AND warehouse_received_at IS DISTINCT FROM warehouse_recorded_at
UNION ALL
SELECT
  'loaded_at without load audit',
  count(*)
FROM purchase_order_parts AS part
WHERE part.loaded_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM audit_events AS event
    WHERE event.event_type = 'PURCHASE_SHIPMENT_CONTAINER_LOADED'
      AND event.target_type = 'PURCHASE_ORDER_PART'
      AND event.target_id = part.id::text
  )
UNION ALL
SELECT
  'fund_posting_batches SALES_RECEIPT business_occurred_at',
  count(*)
FROM fund_posting_batches
WHERE business_source_code_snapshot = 'SALES_RECEIPT';

\echo '=== 6. 关键时间样本 ==='
SELECT
  'latest audit' AS sample,
  max(occurred_at) AS occurred_at
FROM audit_events
WHERE event_type <> 'AUTH_RETENTION_PURGED'
UNION ALL
SELECT
  'latest fund posting',
  max(posted_at)
FROM fund_posting_batches
UNION ALL
SELECT
  'latest sales receipt submission',
  max(submitted_at)
FROM sales_receipt_requests;

\echo '=== 7. 下一步 ==='
SELECT
  '验证通过后：把 db 服务改为 timezone=UTC / TZ=UTC，重启 db 与 server；启动守卫会拒绝非 UTC 会话。' AS next_step;
