-- 回滚关键词搜索索引；扩展保留，不影响业务正确性。
DROP INDEX CONCURRENTLY IF EXISTS "sales_orders_order_no_trgm_idx";
DROP INDEX CONCURRENTLY IF EXISTS "sales_orders_customer_name_trgm_idx";
DROP INDEX CONCURRENTLY IF EXISTS "sales_orders_customer_phone_trgm_idx";
DROP INDEX CONCURRENTLY IF EXISTS "purchase_orders_order_no_trgm_idx";
DROP INDEX CONCURRENTLY IF EXISTS "purchase_order_parts_shipping_mark_text_trgm_idx";
