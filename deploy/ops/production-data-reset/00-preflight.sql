-- 生产清理前只读预检（v0.8.3）
-- 仅执行 SELECT；不得在本文件中加入任何写操作。
\set ON_ERROR_STOP on
\pset pager off

\echo '=== 环境 ==='
SELECT current_database() AS database, current_user AS db_user, now() AS checked_at;

\echo '=== 迁移状态（应为 114 条已完成，最新 20261018131000_product_sort_order）==='
SELECT count(*) AS completed_migrations
  FROM _prisma_migrations
 WHERE finished_at IS NOT NULL;
SELECT migration_name, finished_at
  FROM _prisma_migrations
 ORDER BY finished_at DESC
 LIMIT 5;

\echo '=== 结构与外键（预期 68 张 public 表、193 个外键）==='
SELECT count(*) AS public_tables
  FROM pg_tables
 WHERE schemaname = 'public';
SELECT count(*) AS foreign_keys
  FROM pg_constraint
 WHERE contype = 'f'
   AND connamespace = 'public'::regnamespace;

\echo '=== 42 张待清空表必须全部存在（输出为空才通过）==='
WITH expected(name) AS (VALUES
  ('audit_events'), ('auth_rate_limits'), ('auth_sessions'),
  ('container_batches'), ('container_loading_item_changes'), ('container_loading_items'),
  ('fund_ledger_entries'), ('fund_posting_batches'), ('fund_withdrawal_requests'),
  ('invoice_request_lines'), ('invoice_request_status_history'), ('invoice_requests'),
  ('packaging_cost_requests'),
  ('payment_recipient_accounts'), ('payment_recipient_profiles'),
  ('product_categories'), ('product_heads'), ('product_media'), ('products'),
  ('purchase_order_amount_revisions'), ('purchase_order_documents'),
  ('purchase_order_image_drafts'), ('purchase_order_lines'),
  ('purchase_order_part_items'), ('purchase_order_parts'),
  ('purchase_order_payables'), ('purchase_order_payments'),
  ('purchase_order_status_history'), ('purchase_orders'),
  ('sales_order_amount_revisions'), ('sales_order_documents'),
  ('sales_order_lines'), ('sales_order_payments'),
  ('sales_order_status_history'), ('sales_orders'), ('sales_receipt_requests'),
  ('slh_bill_line_charges'), ('slh_bill_lines'), ('slh_bills'),
  ('slh_reconciliation_batch_lines'), ('slh_reconciliation_batches'),
  ('slh_reconciliation_settlements')
)
SELECT name AS missing_table
  FROM expected
 WHERE to_regclass('public.' || name) IS NULL
 ORDER BY name;

\echo '=== 4 个反向外键必须存在，且定义与清理脚本一致 ==='
SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conname IN (
   'media_assets_packaging_cost_upload_id_fkey',
   'media_assets_purchase_payable_upload_fkey',
   'payment_recipient_profiles_packaging_request_id_fkey',
   'payment_recipient_profiles_purchase_order_id_fkey'
 )
 ORDER BY conname;

\echo '=== 需要临时停用的触发器必须存在且启用（tgenabled = O）==='
SELECT tgname, tgenabled
  FROM pg_trigger
 WHERE tgname IN (
   'numbering_issuances_immutability_trigger',
   'payment_recipient_accounts_identity_trigger',
   'payment_recipient_profiles_identity_trigger'
 )
 ORDER BY tgname;

\echo '=== 全部表精确行数（保存为基线，清理后逐表比对）==='
SELECT schemaname, relname,
       (xpath('/row/c/text()',
              query_to_xml(
                format('SELECT count(*) AS c FROM %I.%I', schemaname, relname),
                false, true, ''
              )
       ))[1]::text::bigint AS row_count
  FROM pg_stat_user_tables
 WHERE schemaname = 'public'
 ORDER BY relname;

\echo '=== 媒体基线 ==='
SELECT media_type, storage_driver, status, count(*) AS assets, coalesce(sum(size_bytes), 0) AS bytes
  FROM media_assets
 GROUP BY media_type, storage_driver, status
 ORDER BY media_type, storage_driver, status;
SELECT count(*) AS media_assets_total,
       count(*) FILTER (WHERE object_key IS NOT NULL) AS with_object_key
  FROM media_assets;

\echo '=== 产品基线（确认全部为测试数据）==='
SELECT status, count(*) AS products
  FROM products
 GROUP BY status
 ORDER BY status;
SELECT count(*) AS product_categories FROM product_categories;
SELECT count(*) AS product_heads FROM product_heads;
SELECT count(*) AS product_media FROM product_media;
SELECT count(*) AS products_missing_scope
  FROM products
 WHERE category_id IS NULL OR product_head_id IS NULL;

\echo '=== 编号基线（PRODUCT 必须保留，其余将被重置）==='
SELECT r.rule_code, count(i.id) AS issuances, coalesce(sum(i.sequence_value), 0) AS sequence_sum
  FROM numbering_rules r
  LEFT JOIN numbering_issuances i ON i.rule_id = r.id
 GROUP BY r.rule_code
 ORDER BY r.rule_code;
SELECT r.rule_code, s.period_key, s.next_sequence_value, s.used_count
  FROM numbering_period_states s
  JOIN numbering_rules r ON r.id = s.rule_id
 ORDER BY r.rule_code, s.period_key;

\echo '=== 资金账户基线（清理后余额与序号归零）==='
SELECT count(*) AS accounts,
       coalesce(sum(balance), 0) AS balance_total,
       count(*) FILTER (WHERE balance <> 0) AS non_zero_balance
  FROM fund_accounts;
