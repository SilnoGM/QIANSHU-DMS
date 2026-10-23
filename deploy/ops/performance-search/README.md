# 关键词搜索 trigram 索引（可选运维步骤）

## 适用场景

销售、采购与货件列表的关键词搜索使用 `ILIKE '%x%'`，普通 B-tree 无法命中。
当数据量增长到搜索接口出现明显慢查询时，可按本步骤创建 `pg_trgm` GIN 索引。

**本步骤不在 Prisma migration 内**：`CREATE EXTENSION` 需要数据库 owner 或超级用户权限，
而 CI/E2E 的隔离数据库角色不满足该条件；放进 migration 会让所有重放测试失败。
因此把它作为生产/测试环境的一次性运维步骤，由有权限的账号执行。

## 前置检查

1. 确认数据库账号具备 `CREATE` 权限，或由 owner 执行。
2. 确认 PostgreSQL 已安装 contrib（官方 `postgres:16` 镜像自带 `pg_trgm`）。
3. 在维护窗口执行；`CONCURRENTLY` 不能在事务块中运行，使用 `psql -f` 且不要加 `-1`。

## 执行

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 10-trgm-indexes.sql
```

## 验证

对 3 个字符以上的关键词执行 `EXPLAIN (ANALYZE, BUFFERS)`，确认出现
`Bitmap Index Scan on ..._trgm_idx`：

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM sales_orders WHERE customer_name ILIKE '%测试客户%';
```

1–2 个字符的关键词仍会走顺序扫描，这是 trigram 的固有限制。

## 回滚

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 90-rollback.sql
```

扩展本身可保留；删除索引不会影响业务正确性，只会回到原有查询计划。

## 当前状态

- 2026-10-23：已在**本地 dev 库**执行并验证 5 个 trigram 索引存在；
  测试机与生产**尚未执行**，需在维护窗口由有权限账号运行。
- 仓库的 Prisma schema 只包含 `purchase_order_parts` 的两个 B-tree 索引；
  trigram 索引不进入 schema/drift gate，避免 CI 重放失败。
