-- 只读预检：执行 10-correct.sql 之前运行。
-- 任何一项与预期不符，停止并人工核对；本文件不修改任何数据。
\set ON_ERROR_STOP on

\echo '=== 0. 会话时区（必须是 Asia/Shanghai） ==='
SELECT current_setting('TimeZone') AS session_time_zone;

DO $$
BEGIN
  IF current_setting('TimeZone') <> 'Asia/Shanghai' THEN
    RAISE EXCEPTION 'Expected Asia/Shanghai (broken session time zone), got %', current_setting('TimeZone');
  END IF;
END
$$;

\echo '=== 1. 销售收款：提交/审核时间差（偏移时最大值应在 8 小时附近） ==='
SELECT
  count(*) AS total_rows,
  count(*) FILTER (WHERE reviewed_at IS NOT NULL) AS reviewed_rows,
  min(reviewed_at - submitted_at) AS min_delta,
  max(reviewed_at - submitted_at) AS max_delta
FROM sales_receipt_requests;

SELECT
  collection_no,
  submitted_at,
  reviewed_at,
  reviewed_at - submitted_at AS delta
FROM sales_receipt_requests
ORDER BY submitted_at DESC
LIMIT 10;

\echo '=== 2. 审计事件：最新事件距今（偏移时应约 8 小时） ==='
SELECT
  count(*) AS total_rows,
  max(occurred_at) AS newest_occurred_at,
  now() - max(occurred_at) AS newest_audit_age
FROM audit_events;

SELECT event_type, count(*) AS rows
FROM audit_events
WHERE event_type = 'AUTH_RETENTION_PURGED'
GROUP BY event_type;

\echo '=== 3. 混合列候选计数 ==='
SELECT
  'purchase_order_parts.warehouse_received_at' AS metric,
  count(*) AS rows
FROM purchase_order_parts
WHERE warehouse_received_at IS NOT NULL
  AND warehouse_received_at IS DISTINCT FROM warehouse_recorded_at
UNION ALL
SELECT
  'purchase_order_parts.loaded_at (no load audit)',
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
  'fund_posting_batches.business_occurred_at (SALES_RECEIPT)',
  count(*)
FROM fund_posting_batches
WHERE business_source_code_snapshot = 'SALES_RECEIPT';

\echo '=== 4. 关键表规模（用于核对修正日志的 UPDATE 行数） ==='
SELECT 'users' AS table_name, count(*) AS rows FROM users
UNION ALL SELECT 'sales_orders', count(*) FROM sales_orders
UNION ALL SELECT 'sales_order_payments', count(*) FROM sales_order_payments
UNION ALL SELECT 'purchase_orders', count(*) FROM purchase_orders
UNION ALL SELECT 'purchase_order_parts', count(*) FROM purchase_order_parts
UNION ALL SELECT 'purchase_order_payments', count(*) FROM purchase_order_payments
UNION ALL SELECT 'fund_posting_batches', count(*) FROM fund_posting_batches
UNION ALL SELECT 'fund_ledger_entries', count(*) FROM fund_ledger_entries
UNION ALL SELECT 'audit_events', count(*) FROM audit_events
UNION ALL SELECT 'numbering_issuances', count(*) FROM numbering_issuances;

\echo '=== 5. 提醒 ==='
SELECT
  '执行前必须完成 pg_dump -Fc 备份并验证可恢复；10-correct.sql 只执行一次。' AS reminder;
