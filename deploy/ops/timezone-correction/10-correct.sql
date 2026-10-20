-- 存量时间偏移修正：把 Prisma 直接写入的 timestamptz 列整体 +8 小时。
--
-- 前提：
--   1. 数据库会话时区仍为 Asia/Shanghai；
--   2. web/server 已停止，且没有其他写入连接；
--   3. 已完成 pg_dump -Fc 备份并验证可恢复；
--   4. 本文件只执行一次。
--
-- 原始 SQL / 数据库函数写入的列（reviewed_at、posted_at、paid_at、issued_at、
-- last_login_at 等）保持不动；混合列在文件末尾按行判断。
-- 所有语句在单事务内执行；任一条失败会整体回滚，触发器状态也随事务回滚。
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_setting('TimeZone') <> 'Asia/Shanghai' THEN
    RAISE EXCEPTION 'Expected Asia/Shanghai (broken session time zone), got %; refusing to correct twice', current_setting('TimeZone');
  END IF;
END
$$;

BEGIN;

SET LOCAL lock_timeout = '10s';
-- 存量修正是一次性维护操作；避免长表更新被默认 statement_timeout 截断。
SET LOCAL statement_timeout = '0';

\echo '=== 临时禁用相关表的用户触发器 ==='
ALTER TABLE auth_sessions DISABLE TRIGGER USER;
ALTER TABLE container_batches DISABLE TRIGGER USER;
ALTER TABLE container_loading_items DISABLE TRIGGER USER;
ALTER TABLE container_loading_item_changes DISABLE TRIGGER USER;
ALTER TABLE currencies DISABLE TRIGGER USER;
ALTER TABLE dictionary_items DISABLE TRIGGER USER;
ALTER TABLE dictionary_types DISABLE TRIGGER USER;
ALTER TABLE exchange_rates DISABLE TRIGGER USER;
ALTER TABLE fund_accounts DISABLE TRIGGER USER;
ALTER TABLE fund_business_sources DISABLE TRIGGER USER;
ALTER TABLE fund_business_source_posting_types DISABLE TRIGGER USER;
ALTER TABLE fund_posting_rule_legs DISABLE TRIGGER USER;
ALTER TABLE fund_posting_rule_versions DISABLE TRIGGER USER;
ALTER TABLE fund_posting_types DISABLE TRIGGER USER;
ALTER TABLE fund_withdrawal_requests DISABLE TRIGGER USER;
ALTER TABLE invoice_requests DISABLE TRIGGER USER;
ALTER TABLE invoice_request_lines DISABLE TRIGGER USER;
ALTER TABLE invoice_request_status_history DISABLE TRIGGER USER;
ALTER TABLE media_assets DISABLE TRIGGER USER;
ALTER TABLE numbering_rules DISABLE TRIGGER USER;
ALTER TABLE numbering_rule_segments DISABLE TRIGGER USER;
ALTER TABLE numbering_rule_versions DISABLE TRIGGER USER;
ALTER TABLE packaging_cost_requests DISABLE TRIGGER USER;
ALTER TABLE payment_recipient_accounts DISABLE TRIGGER USER;
ALTER TABLE payment_recipient_profiles DISABLE TRIGGER USER;
ALTER TABLE products DISABLE TRIGGER USER;
ALTER TABLE product_categories DISABLE TRIGGER USER;
ALTER TABLE product_heads DISABLE TRIGGER USER;
ALTER TABLE product_media DISABLE TRIGGER USER;
ALTER TABLE purchase_orders DISABLE TRIGGER USER;
ALTER TABLE purchase_order_amount_revisions DISABLE TRIGGER USER;
ALTER TABLE purchase_order_documents DISABLE TRIGGER USER;
ALTER TABLE purchase_order_image_drafts DISABLE TRIGGER USER;
ALTER TABLE purchase_order_lines DISABLE TRIGGER USER;
ALTER TABLE purchase_order_parts DISABLE TRIGGER USER;
ALTER TABLE purchase_order_payables DISABLE TRIGGER USER;
ALTER TABLE purchase_order_payments DISABLE TRIGGER USER;
ALTER TABLE purchase_order_status_history DISABLE TRIGGER USER;
ALTER TABLE regions DISABLE TRIGGER USER;
ALTER TABLE sales_orders DISABLE TRIGGER USER;
ALTER TABLE sales_order_amount_revisions DISABLE TRIGGER USER;
ALTER TABLE sales_order_documents DISABLE TRIGGER USER;
ALTER TABLE sales_order_lines DISABLE TRIGGER USER;
ALTER TABLE sales_order_payments DISABLE TRIGGER USER;
ALTER TABLE sales_order_status_history DISABLE TRIGGER USER;
ALTER TABLE sales_receipt_requests DISABLE TRIGGER USER;
ALTER TABLE slh_bills DISABLE TRIGGER USER;
ALTER TABLE slh_bill_lines DISABLE TRIGGER USER;
ALTER TABLE slh_bill_line_charges DISABLE TRIGGER USER;
ALTER TABLE slh_reconciliation_batches DISABLE TRIGGER USER;
ALTER TABLE slh_reconciliation_batch_lines DISABLE TRIGGER USER;
ALTER TABLE slh_reconciliation_settlements DISABLE TRIGGER USER;
ALTER TABLE supplier_shipping_mark_rule_bindings DISABLE TRIGGER USER;
ALTER TABLE users DISABLE TRIGGER USER;
ALTER TABLE user_profiles DISABLE TRIGGER USER;
ALTER TABLE audit_events DISABLE TRIGGER USER;
ALTER TABLE fund_posting_batches DISABLE TRIGGER USER;

\echo '=== Prisma 直接写入列 +8 小时 ==='
UPDATE auth_sessions
SET created_at = created_at + interval '8 hours';

UPDATE container_batches
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE container_loading_items
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE container_loading_item_changes
SET created_at = created_at + interval '8 hours';

UPDATE currencies
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE dictionary_items
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE dictionary_types
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE exchange_rates
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE fund_accounts
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours',
    share_rate_updated_at = share_rate_updated_at + interval '8 hours';

UPDATE fund_business_sources
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE fund_business_source_posting_types
SET created_at = created_at + interval '8 hours';

UPDATE fund_posting_rule_legs
SET created_at = created_at + interval '8 hours';

UPDATE fund_posting_rule_versions
SET created_at = created_at + interval '8 hours',
    published_at = published_at + interval '8 hours';

UPDATE fund_posting_types
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE fund_withdrawal_requests
SET created_at = created_at + interval '8 hours',
    submitted_at = submitted_at + interval '8 hours',
    reviewed_at = reviewed_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE invoice_requests
SET cancelled_at = cancelled_at + interval '8 hours',
    created_at = created_at + interval '8 hours',
    document_uploaded_at = document_uploaded_at + interval '8 hours',
    last_submitted_at = last_submitted_at + interval '8 hours',
    notified_at = notified_at + interval '8 hours',
    rate_captured_at = rate_captured_at + interval '8 hours',
    returned_at = returned_at + interval '8 hours',
    settled_at = settled_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE invoice_request_lines
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE invoice_request_status_history
SET occurred_at = occurred_at + interval '8 hours';

UPDATE media_assets
SET created_at = created_at + interval '8 hours',
    deleted_at = deleted_at + interval '8 hours',
    retention_until = retention_until + interval '8 hours',
    updated_at = updated_at + interval '8 hours',
    upload_expires_at = upload_expires_at + interval '8 hours';

UPDATE numbering_rules
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE numbering_rule_segments
SET created_at = created_at + interval '8 hours';

-- numbering_rule_versions.published_at 来自数据库事务时间，保持不动。
UPDATE numbering_rule_versions
SET created_at = created_at + interval '8 hours';

UPDATE packaging_cost_requests
SET submitted_at = submitted_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE payment_recipient_accounts
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE payment_recipient_profiles
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE products
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE product_categories
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE product_heads
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE product_media
SET created_at = created_at + interval '8 hours',
    detached_at = detached_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE purchase_orders
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE purchase_order_amount_revisions
SET changed_at = changed_at + interval '8 hours';

UPDATE purchase_order_documents
SET created_at = created_at + interval '8 hours',
    detached_at = detached_at + interval '8 hours';

UPDATE purchase_order_image_drafts
SET archived_at = archived_at + interval '8 hours',
    created_at = created_at + interval '8 hours',
    invalidated_at = invalidated_at + interval '8 hours';

UPDATE purchase_order_lines
SET created_at = created_at + interval '8 hours';

-- purchase_order_parts 的 warehouse_received_at 必须先于 shipped_at 修正，
-- 否则语句边界会出现 warehouse_received_at < shipped_at，触发 CHECK。
-- 具体更新放在文件末尾的混合列区。

UPDATE purchase_order_payables
SET closed_at = closed_at + interval '8 hours',
    created_at = created_at + interval '8 hours';

UPDATE purchase_order_payments
SET created_at = created_at + interval '8 hours',
    paid_at = paid_at + interval '8 hours',
    voided_at = voided_at + interval '8 hours';

UPDATE purchase_order_status_history
SET changed_at = changed_at + interval '8 hours';

UPDATE regions
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE sales_orders
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE sales_order_amount_revisions
SET changed_at = changed_at + interval '8 hours';

UPDATE sales_order_documents
SET created_at = created_at + interval '8 hours',
    detached_at = detached_at + interval '8 hours';

UPDATE sales_order_lines
SET created_at = created_at + interval '8 hours',
    removed_at = removed_at + interval '8 hours';

-- voided_at / exchange_rate_captured_at 是数据库时间读回后写入的，存储正确，保持不动。
UPDATE sales_order_payments
SET created_at = created_at + interval '8 hours',
    received_at = received_at + interval '8 hours';

UPDATE sales_order_status_history
SET changed_at = changed_at + interval '8 hours';

-- reviewed_at 是数据库时间读回后写入的，存储正确，保持不动。
UPDATE sales_receipt_requests
SET received_at = received_at + interval '8 hours',
    submitted_at = submitted_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE slh_bills
SET created_at = created_at + interval '8 hours',
    rate_captured_at = rate_captured_at + interval '8 hours',
    superseded_at = superseded_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE slh_bill_lines
SET created_at = created_at + interval '8 hours',
    reconciled_at = reconciled_at + interval '8 hours';

UPDATE slh_bill_line_charges
SET created_at = created_at + interval '8 hours';

UPDATE slh_reconciliation_batches
SET completed_at = completed_at + interval '8 hours',
    created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE slh_reconciliation_batch_lines
SET created_at = created_at + interval '8 hours',
    reconciled_at = reconciled_at + interval '8 hours';

UPDATE slh_reconciliation_settlements
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE supplier_shipping_mark_rule_bindings
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

-- last_login_at / password_changed_at / disabled_at 是数据库时间读回后写入的，保持不动。
UPDATE users
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

UPDATE user_profiles
SET created_at = created_at + interval '8 hours',
    updated_at = updated_at + interval '8 hours';

-- auth-cleanup 的原始 INSERT 走数据库默认值，时间已正确，排除。
UPDATE audit_events
SET occurred_at = occurred_at + interval '8 hours'
WHERE event_type <> 'AUTH_RETENTION_PURGED';

\echo '=== 混合列按行判断 ==='
-- 客户端传入 warehouse_received_at 时由 Prisma 写入（早 8 小时）；
-- 未传时使用 warehouse_recorded_at 的数据库时间（已正确），两列相等。
UPDATE purchase_order_parts
SET warehouse_received_at = warehouse_received_at + interval '8 hours'
WHERE warehouse_received_at IS NOT NULL
  AND warehouse_received_at IS DISTINCT FROM warehouse_recorded_at;

-- 迁移回填的 loaded_at 复制了 container_loading_items.created_at（早 8 小时），
-- 且没有对应的装柜审计事件；新写入的 loaded_at 使用数据库时间且有审计事件。
UPDATE purchase_order_parts AS part
SET loaded_at = part.loaded_at + interval '8 hours'
WHERE part.loaded_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM audit_events AS event
    WHERE event.event_type = 'PURCHASE_SHIPMENT_CONTAINER_LOADED'
      AND event.target_type = 'PURCHASE_ORDER_PART'
      AND event.target_id = part.id::text
  );

-- 混合列处理完后再提升 shipped_at；此时 warehouse_received_at 已经是修正后的值，
-- warehouse_receipt_facts_check 在语句边界仍然成立。
UPDATE purchase_order_parts
SET created_at = created_at + interval '8 hours',
    shipment_recorded_at = shipment_recorded_at + interval '8 hours',
    shipped_at = shipped_at + interval '8 hours';

-- 销售收款的 business_occurred_at 使用收款时间（Prisma 写入，早 8 小时）；
-- 其他来源使用数据库事务时间（已正确）。
UPDATE fund_posting_batches
SET business_occurred_at = business_occurred_at + interval '8 hours'
WHERE business_source_code_snapshot = 'SALES_RECEIPT';

\echo '=== 恢复用户触发器 ==='
ALTER TABLE auth_sessions ENABLE TRIGGER USER;
ALTER TABLE container_batches ENABLE TRIGGER USER;
ALTER TABLE container_loading_items ENABLE TRIGGER USER;
ALTER TABLE container_loading_item_changes ENABLE TRIGGER USER;
ALTER TABLE currencies ENABLE TRIGGER USER;
ALTER TABLE dictionary_items ENABLE TRIGGER USER;
ALTER TABLE dictionary_types ENABLE TRIGGER USER;
ALTER TABLE exchange_rates ENABLE TRIGGER USER;
ALTER TABLE fund_accounts ENABLE TRIGGER USER;
ALTER TABLE fund_business_sources ENABLE TRIGGER USER;
ALTER TABLE fund_business_source_posting_types ENABLE TRIGGER USER;
ALTER TABLE fund_posting_rule_legs ENABLE TRIGGER USER;
ALTER TABLE fund_posting_rule_versions ENABLE TRIGGER USER;
ALTER TABLE fund_posting_types ENABLE TRIGGER USER;
ALTER TABLE fund_withdrawal_requests ENABLE TRIGGER USER;
ALTER TABLE invoice_requests ENABLE TRIGGER USER;
ALTER TABLE invoice_request_lines ENABLE TRIGGER USER;
ALTER TABLE invoice_request_status_history ENABLE TRIGGER USER;
ALTER TABLE media_assets ENABLE TRIGGER USER;
ALTER TABLE numbering_rules ENABLE TRIGGER USER;
ALTER TABLE numbering_rule_segments ENABLE TRIGGER USER;
ALTER TABLE numbering_rule_versions ENABLE TRIGGER USER;
ALTER TABLE packaging_cost_requests ENABLE TRIGGER USER;
ALTER TABLE payment_recipient_accounts ENABLE TRIGGER USER;
ALTER TABLE payment_recipient_profiles ENABLE TRIGGER USER;
ALTER TABLE products ENABLE TRIGGER USER;
ALTER TABLE product_categories ENABLE TRIGGER USER;
ALTER TABLE product_heads ENABLE TRIGGER USER;
ALTER TABLE product_media ENABLE TRIGGER USER;
ALTER TABLE purchase_orders ENABLE TRIGGER USER;
ALTER TABLE purchase_order_amount_revisions ENABLE TRIGGER USER;
ALTER TABLE purchase_order_documents ENABLE TRIGGER USER;
ALTER TABLE purchase_order_image_drafts ENABLE TRIGGER USER;
ALTER TABLE purchase_order_lines ENABLE TRIGGER USER;
ALTER TABLE purchase_order_parts ENABLE TRIGGER USER;
ALTER TABLE purchase_order_payables ENABLE TRIGGER USER;
ALTER TABLE purchase_order_payments ENABLE TRIGGER USER;
ALTER TABLE purchase_order_status_history ENABLE TRIGGER USER;
ALTER TABLE regions ENABLE TRIGGER USER;
ALTER TABLE sales_orders ENABLE TRIGGER USER;
ALTER TABLE sales_order_amount_revisions ENABLE TRIGGER USER;
ALTER TABLE sales_order_documents ENABLE TRIGGER USER;
ALTER TABLE sales_order_lines ENABLE TRIGGER USER;
ALTER TABLE sales_order_payments ENABLE TRIGGER USER;
ALTER TABLE sales_order_status_history ENABLE TRIGGER USER;
ALTER TABLE sales_receipt_requests ENABLE TRIGGER USER;
ALTER TABLE slh_bills ENABLE TRIGGER USER;
ALTER TABLE slh_bill_lines ENABLE TRIGGER USER;
ALTER TABLE slh_bill_line_charges ENABLE TRIGGER USER;
ALTER TABLE slh_reconciliation_batches ENABLE TRIGGER USER;
ALTER TABLE slh_reconciliation_batch_lines ENABLE TRIGGER USER;
ALTER TABLE slh_reconciliation_settlements ENABLE TRIGGER USER;
ALTER TABLE supplier_shipping_mark_rule_bindings ENABLE TRIGGER USER;
ALTER TABLE users ENABLE TRIGGER USER;
ALTER TABLE user_profiles ENABLE TRIGGER USER;
ALTER TABLE audit_events ENABLE TRIGGER USER;
ALTER TABLE fund_posting_batches ENABLE TRIGGER USER;

COMMIT;

\echo '=== 修正完成：继续执行 20-verify.sql，再切换数据库会话时区为 UTC ==='
