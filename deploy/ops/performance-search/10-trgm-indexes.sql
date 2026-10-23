-- 生产/测试环境可选运维步骤：pg_trgm 关键词搜索索引。
-- 不要在 Prisma migration 内执行；CI 隔离数据库角色通常没有 CREATE EXTENSION 权限。
-- 使用 psql -f 直接执行，不要加 -1（CONCURRENTLY 不能在事务块内运行）。

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "sales_orders_order_no_trgm_idx"
  ON "sales_orders" USING GIN ("order_no" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sales_orders_customer_name_trgm_idx"
  ON "sales_orders" USING GIN ("customer_name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sales_orders_customer_phone_trgm_idx"
  ON "sales_orders" USING GIN ("customer_phone" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "purchase_orders_order_no_trgm_idx"
  ON "purchase_orders" USING GIN ("order_no" gin_trgm_ops);
-- 采购单自定义供应商名称列不建 trigram 索引：该条件只在自定义来源的关键词
-- 搜索中命中，选择率低，保留顺序扫描可避免为低频路径增加写放大。

CREATE INDEX CONCURRENTLY IF NOT EXISTS "purchase_order_parts_shipping_mark_text_trgm_idx"
  ON "purchase_order_parts" USING GIN ("shipping_mark_text" gin_trgm_ops);
