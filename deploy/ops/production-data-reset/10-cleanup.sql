-- 生产业务数据清理（v0.8.3）
--
-- 危险：本文件执行不可逆的 TRUNCATE / DELETE。
-- 执行前必须完成 00-preflight.sql、数据库与媒体备份，并停止 web/server 与媒体定时清理。
-- 执行方式（必须在单事务中运行）：
--   psql -U <DB_USER> -d <DB_NAME> -v ON_ERROR_STOP=1 --single-transaction \
--     -f 10-cleanup.sql
--
-- 结果：
--   - 42 张业务/收款主档/产品表清空；
--   - 生产媒体记录全部删除（文件由独立步骤清理）；
--   - 非 PRODUCT 编号流水与计数器删除，下一次从 1 开始；
--   - PRODUCT 编号流水与计数器保留；
--   - fund_accounts 余额归零、next_sequence = 1；
--   - 4 个反向外键事务内临时移除并原样恢复。

\set ON_ERROR_STOP on
\pset pager off

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = 0;

\echo '=== 1. 结构断言 ==='
DO $$
DECLARE
  table_count int;
  fk_count int;
  reverse_fk_count int;
BEGIN
  SELECT count(*) INTO table_count
    FROM pg_tables
   WHERE schemaname = 'public';
  IF table_count <> 68 THEN
    RAISE EXCEPTION 'unexpected public table count: %', table_count;
  END IF;

  SELECT count(*) INTO fk_count
    FROM pg_constraint
   WHERE contype = 'f'
     AND connamespace = 'public'::regnamespace;
  IF fk_count <> 193 THEN
    RAISE EXCEPTION 'unexpected foreign key count: %', fk_count;
  END IF;

  SELECT count(*) INTO reverse_fk_count
    FROM pg_constraint
   WHERE contype = 'f'
     AND conname IN (
       'media_assets_packaging_cost_upload_id_fkey',
       'media_assets_purchase_payable_upload_fkey',
       'payment_recipient_profiles_packaging_request_id_fkey',
       'payment_recipient_profiles_purchase_order_id_fkey'
     );
  IF reverse_fk_count <> 4 THEN
    RAISE EXCEPTION 'expected 4 reverse foreign keys, found %', reverse_fk_count;
  END IF;
END $$;

\echo '=== 2. 临时移除 4 个反向外键 ==='
ALTER TABLE media_assets
  DROP CONSTRAINT media_assets_packaging_cost_upload_id_fkey;
ALTER TABLE media_assets
  DROP CONSTRAINT media_assets_purchase_payable_upload_fkey;
ALTER TABLE payment_recipient_profiles
  DROP CONSTRAINT payment_recipient_profiles_packaging_request_id_fkey;
ALTER TABLE payment_recipient_profiles
  DROP CONSTRAINT payment_recipient_profiles_purchase_order_id_fkey;

\echo '=== 3. 清空 42 张表 ==='
TRUNCATE TABLE
  audit_events,
  auth_rate_limits,
  auth_sessions,
  container_batches,
  container_loading_item_changes,
  container_loading_items,
  fund_ledger_entries,
  fund_posting_batches,
  fund_withdrawal_requests,
  invoice_request_lines,
  invoice_request_status_history,
  invoice_requests,
  packaging_cost_requests,
  payment_recipient_accounts,
  payment_recipient_profiles,
  product_categories,
  product_heads,
  product_media,
  products,
  purchase_order_amount_revisions,
  purchase_order_documents,
  purchase_order_image_drafts,
  purchase_order_lines,
  purchase_order_part_items,
  purchase_order_parts,
  purchase_order_payables,
  purchase_order_payments,
  purchase_order_status_history,
  purchase_orders,
  sales_order_amount_revisions,
  sales_order_documents,
  sales_order_lines,
  sales_order_payments,
  sales_order_status_history,
  sales_orders,
  sales_receipt_requests,
  slh_bill_line_charges,
  slh_bill_lines,
  slh_bills,
  slh_reconciliation_batch_lines,
  slh_reconciliation_batches,
  slh_reconciliation_settlements;

\echo '=== 4. 删除全部媒体记录（文件在独立步骤清理）==='
DELETE FROM media_assets;

\echo '=== 5. 重置非 PRODUCT 编号；PRODUCT 流水与计数器保留 ==='
ALTER TABLE numbering_issuances
  DISABLE TRIGGER numbering_issuances_immutability_trigger;

DELETE FROM numbering_issuances i
 USING numbering_rules r
 WHERE i.rule_id = r.id
   AND r.rule_code <> 'PRODUCT';

DELETE FROM numbering_period_states s
 USING numbering_rules r
 WHERE s.rule_id = r.id
   AND r.rule_code <> 'PRODUCT';

ALTER TABLE numbering_issuances
  ENABLE TRIGGER numbering_issuances_immutability_trigger;

\echo '=== 6. 资金账户归零，保留分成比例 ==='
UPDATE fund_accounts
   SET balance = 0,
       next_sequence = 1,
       version = version + 1,
       updated_at = now();

\echo '=== 7. 原样恢复 4 个反向外键 ==='
ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_packaging_cost_upload_id_fkey
  FOREIGN KEY (packaging_cost_upload_id) REFERENCES packaging_cost_requests(id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_purchase_payable_upload_fkey
  FOREIGN KEY (purchase_payable_upload_id) REFERENCES purchase_order_payables(id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE payment_recipient_profiles
  ADD CONSTRAINT payment_recipient_profiles_packaging_request_id_fkey
  FOREIGN KEY (packaging_request_id) REFERENCES packaging_cost_requests(id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE payment_recipient_profiles
  ADD CONSTRAINT payment_recipient_profiles_purchase_order_id_fkey
  FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
  ON UPDATE RESTRICT ON DELETE RESTRICT;

\echo '=== 8. 事务内终检 ==='
DO $$
DECLARE
  table_name text;
  row_count bigint;
  tables text[] := ARRAY[
    'audit_events', 'auth_rate_limits', 'auth_sessions',
    'container_batches', 'container_loading_item_changes', 'container_loading_items',
    'fund_ledger_entries', 'fund_posting_batches', 'fund_withdrawal_requests',
    'invoice_request_lines', 'invoice_request_status_history', 'invoice_requests',
    'packaging_cost_requests',
    'payment_recipient_accounts', 'payment_recipient_profiles',
    'product_categories', 'product_heads', 'product_media', 'products',
    'purchase_order_amount_revisions', 'purchase_order_documents',
    'purchase_order_image_drafts', 'purchase_order_lines',
    'purchase_order_part_items', 'purchase_order_parts',
    'purchase_order_payables', 'purchase_order_payments',
    'purchase_order_status_history', 'purchase_orders',
    'sales_order_amount_revisions', 'sales_order_documents',
    'sales_order_lines', 'sales_order_payments',
    'sales_order_status_history', 'sales_orders', 'sales_receipt_requests',
    'slh_bill_line_charges', 'slh_bill_lines', 'slh_bills',
    'slh_reconciliation_batch_lines', 'slh_reconciliation_batches',
    'slh_reconciliation_settlements'
  ];
  fk_count int;
BEGIN
  FOREACH table_name IN ARRAY tables LOOP
    EXECUTE format('SELECT count(*) FROM %I', table_name) INTO row_count;
    IF row_count <> 0 THEN
      RAISE EXCEPTION 'table not empty: % rows=%', table_name, row_count;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM media_assets) <> 0 THEN
    RAISE EXCEPTION 'media_assets is not empty';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM numbering_issuances i
      JOIN numbering_rules r ON r.id = i.rule_id
     WHERE r.rule_code <> 'PRODUCT'
  ) THEN
    RAISE EXCEPTION 'non-product numbering issuances remain';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM numbering_period_states s
      JOIN numbering_rules r ON r.id = s.rule_id
     WHERE r.rule_code <> 'PRODUCT'
  ) THEN
    RAISE EXCEPTION 'non-product numbering period states remain';
  END IF;

  IF EXISTS (
    SELECT 1 FROM fund_accounts
     WHERE balance <> 0 OR next_sequence <> 1
  ) THEN
    RAISE EXCEPTION 'fund accounts were not reset';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM numbering_issuances i
      JOIN numbering_rules r ON r.id = i.rule_id
     WHERE r.rule_code = 'PRODUCT'
  ) THEN
    RAISE EXCEPTION 'PRODUCT numbering issuances were removed';
  END IF;

  SELECT count(*) INTO fk_count
    FROM pg_constraint
   WHERE contype = 'f'
     AND connamespace = 'public'::regnamespace;
  IF fk_count <> 193 THEN
    RAISE EXCEPTION 'foreign key count after cleanup: %', fk_count;
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conname IN (
         'media_assets_packaging_cost_upload_id_fkey',
         'media_assets_purchase_payable_upload_fkey',
         'payment_recipient_profiles_packaging_request_id_fkey',
         'payment_recipient_profiles_purchase_order_id_fkey'
       )
         AND convalidated) <> 4 THEN
    RAISE EXCEPTION 'restored foreign keys are not validated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname IN (
       'numbering_issuances_immutability_trigger',
       'payment_recipient_accounts_identity_trigger',
       'payment_recipient_profiles_identity_trigger'
     )
       AND tgenabled <> 'O'
  ) THEN
    RAISE EXCEPTION 'one or more triggers were not re-enabled';
  END IF;
END $$;

\echo '=== 清理完成，提交事务 ==='
COMMIT;
