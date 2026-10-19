-- 生产清理后验证（v0.8.3）
-- 阶段 A：清理完成后立即执行；阶段 B：产品目录导入后再次执行第 6 节。
\set ON_ERROR_STOP on
\pset pager off

\echo '=== 1. 42 张表必须为空 ==='
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
SELECT e.name AS table_name,
       (xpath('/row/c/text()',
              query_to_xml(
                format('SELECT count(*) AS c FROM public.%I', e.name),
                false, true, ''
              )
       ))[1]::text::bigint AS row_count
  FROM expected e
 ORDER BY e.name;

\echo '=== 2. 媒体与收款主档 ==='
SELECT count(*) AS media_assets FROM media_assets;
SELECT count(*) AS media_object_key_migrations FROM media_object_key_migrations;
SELECT count(*) AS payment_recipient_profiles FROM payment_recipient_profiles;
SELECT count(*) AS payment_recipient_accounts FROM payment_recipient_accounts;

\echo '=== 3. 编号：只允许 PRODUCT 保留 ==='
SELECT r.rule_code, count(i.id) AS issuances
  FROM numbering_rules r
  LEFT JOIN numbering_issuances i ON i.rule_id = r.id
 GROUP BY r.rule_code
 ORDER BY r.rule_code;
SELECT r.rule_code, s.period_key, s.next_sequence_value, s.used_count
  FROM numbering_period_states s
  JOIN numbering_rules r ON r.id = s.rule_id
 ORDER BY r.rule_code, s.period_key;

\echo '=== 4. 资金账户与结构 ==='
SELECT count(*) AS accounts,
       count(*) FILTER (WHERE balance <> 0) AS non_zero_balance,
       count(*) FILTER (WHERE next_sequence <> 1) AS non_one_sequence
  FROM fund_accounts;
SELECT count(*) AS foreign_keys
  FROM pg_constraint
 WHERE contype = 'f'
   AND connamespace = 'public'::regnamespace;
SELECT conname, convalidated
  FROM pg_constraint
 WHERE conname IN (
   'media_assets_packaging_cost_upload_id_fkey',
   'media_assets_purchase_payable_upload_fkey',
   'payment_recipient_profiles_packaging_request_id_fkey',
   'payment_recipient_profiles_purchase_order_id_fkey'
 )
 ORDER BY conname;
SELECT tgname, tgenabled
  FROM pg_trigger
 WHERE tgname IN (
   'numbering_issuances_immutability_trigger',
   'payment_recipient_accounts_identity_trigger',
   'payment_recipient_profiles_identity_trigger'
 )
 ORDER BY tgname;

\echo '=== 5. 保留基础数据计数（与 00-preflight 基线逐项比对）==='
SELECT 'users' AS item, count(*) AS value FROM users
UNION ALL SELECT 'user_profiles', count(*) FROM user_profiles
UNION ALL SELECT 'roles', count(*) FROM roles
UNION ALL SELECT 'permissions', count(*) FROM permissions
UNION ALL SELECT 'user_roles', count(*) FROM user_roles
UNION ALL SELECT 'role_permissions', count(*) FROM role_permissions
UNION ALL SELECT 'regions', count(*) FROM regions
UNION ALL SELECT 'currencies', count(*) FROM currencies
UNION ALL SELECT 'exchange_rates', count(*) FROM exchange_rates
UNION ALL SELECT 'dictionary_types', count(*) FROM dictionary_types
UNION ALL SELECT 'dictionary_items', count(*) FROM dictionary_items
UNION ALL SELECT 'numbering_rules', count(*) FROM numbering_rules
UNION ALL SELECT 'numbering_rule_versions', count(*) FROM numbering_rule_versions
UNION ALL SELECT 'numbering_rule_segments', count(*) FROM numbering_rule_segments
UNION ALL SELECT 'supplier_shipping_mark_rule_bindings', count(*) FROM supplier_shipping_mark_rule_bindings
UNION ALL SELECT 'fund_business_sources', count(*) FROM fund_business_sources
UNION ALL SELECT 'fund_posting_types', count(*) FROM fund_posting_types
UNION ALL SELECT 'fund_posting_rule_versions', count(*) FROM fund_posting_rule_versions
UNION ALL SELECT 'fund_posting_rule_legs', count(*) FROM fund_posting_rule_legs
UNION ALL SELECT 'fund_business_source_posting_types', count(*) FROM fund_business_source_posting_types
ORDER BY item;

\echo '=== 6. 阶段 B 产品导入后验证 ==='
SELECT count(*) AS product_categories FROM product_categories;
SELECT count(*) AS product_heads FROM product_heads;
SELECT count(*) AS products FROM products;
SELECT status, count(*) AS products
  FROM products
 GROUP BY status
 ORDER BY status;
SELECT count(*) AS products_missing_scope
  FROM products
 WHERE category_id IS NULL OR product_head_id IS NULL;
SELECT count(*) AS category_supplier_mismatch
  FROM products p
  JOIN product_categories c ON c.id = p.category_id
 WHERE c.supplier_value <> p.supplier_value;
SELECT count(*) AS products_total,
       count(DISTINCT product_no) AS distinct_product_no
  FROM products;
SELECT count(*) AS product_media FROM product_media;
SELECT count(*) AS media_assets FROM media_assets;
SELECT p.supplier_value, count(*) AS products,
       min(p.sort_order) AS min_sort, max(p.sort_order) AS max_sort
  FROM products p
 GROUP BY p.supplier_value
 ORDER BY p.supplier_value;
SELECT count(*) AS audit_events FROM audit_events;
