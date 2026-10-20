# 存量时间偏移修正（PostgreSQL 会话时区 / Prisma）

适用版本：v0.8.4 及之前使用 `deploy/docker/docker-compose.yml` 的测试机与生产库。

本目录只包含操作文件，不会被应用自动执行。执行前必须阅读本 README 与《腾讯云 Docker 部署手册》的备份章节。

## 背景

`@prisma/adapter-pg@7.8.0` 在读写 `timestamptz` 时按 UTC 解释数据库会话时区：

- 读：把 PostgreSQL 返回的 `+08` 后缀直接改写成 `+00:00`；
- 写：把 `Date` 的 UTC 墙钟格式化成不带时区的字符串，由 PostgreSQL 按会话时区解释。

当数据库会话时区为 `Asia/Shanghai` 时：

| 写入方式 | 数据库实际存储 | 页面显示 |
|---|---|---|
| Prisma `create/update`（`new Date()`、`@default(now())`、`@updatedAt`、客户端 ISO） | 早 8 小时 | 正确（写 -8、读 +8 抵消） |
| 原始 SQL / 数据库函数（`clock_timestamp()`、`CURRENT_TIMESTAMP`） | 正确 | 多 8 小时 |
| 数据库时间读回 JS 后再经 Prisma 写入 | 正确 | 多 8 小时 |

本脚本只修正第一类（**存储早 8 小时**）的列；第二类保持不动；混合列按规则逐行判断。执行完成后再把数据库会话切到 UTC，页面与数据库都会回到同一绝对时间。

## 文件

| 文件 | 用途 |
|---|---|
| `00-preflight.sql` | 只读预检：会话时区、8 小时偏移样本、混合列候选计数、备份提醒 |
| `10-correct.sql` | 单事务修正：临时禁用相关表的用户触发器，按列 +8 小时，再恢复触发器 |
| `20-verify.sql` | 修正后验证：时间差、未来时间、入仓/装柜约束、混合列计数 |

## 前置条件

1. 已停止 `web`、`server` 与媒体定时清理，`db` 保持运行，且没有其他写入连接。
2. 已完成 `pg_dump -Fc` 数据库备份，并验证 `pg_restore --list` 可读。
3. 已记录维护窗口、操作人与复核人。
4. 确认数据库会话时区仍为 `Asia/Shanghai`：
   ```sql
   SHOW TimeZone; -- 期望 Asia/Shanghai
   ```
   如果已经是 `UTC`/`Etc/UTC`，**不要执行本脚本**；先确认数据是否已经修正过。
5. 本脚本**只执行一次**。执行记录写入发布/变更单，不要重复运行。

## 执行顺序

### A. 预检（只读）

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml exec -T db \
  psql -U <DB_USER> -d <DB_NAME> -v ON_ERROR_STOP=1 \
  -f - < 00-preflight.sql | tee timezone-preflight.log
```

重点核对：

- `session_time_zone` 为 `Asia/Shanghai`；
- `sales_receipt_requests` 的 `reviewed_at - submitted_at` 最大值在 8 小时附近；
- `newest_audit_age` 在 8 小时附近（说明审计时间也是 Prisma 写入）；
- `loaded_backfill_candidates`、`warehouse_received_mixed`、`sales_receipt_business_occurred` 的计数与业务规模相符。

任一项明显不符，停止执行并人工核对。

### B. 修正（单事务）

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml exec -T db \
  psql -U <DB_USER> -d <DB_NAME> -v ON_ERROR_STOP=1 \
  -f - < 10-correct.sql | tee timezone-correct.log
```

要求：

- 脚本自带会话时区守卫；不是 `Asia/Shanghai` 会直接报错退出；
- 所有 `UPDATE` 都在同一事务内，任一条失败（包括 CHECK 约束）会整体回滚；
- 脚本会临时 `DISABLE TRIGGER USER`，事务结束自动恢复；
- 输出中每个 `UPDATE <n>` 都应大于 0；若个别表为 0，先确认该表是否有数据。

### C. 验证（只读）

在**切换时区之前**执行：

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml exec -T db \
  psql -U <DB_USER> -d <DB_NAME> -v ON_ERROR_STOP=1 \
  -f - < 20-verify.sql | tee timezone-verify.log
```

期望：

- `sales_receipt_requests` 的 `delta` 为分钟级；
- `newest_audit_age` 为秒/分钟级；
- 未来时间计数为 0；
- `loaded_at <= loaded_recorded_at`、`warehouse_received_at` 约束违规计数为 0；
- 混合列候选计数与预检相比只剩“保持不动”的行。

### D. 切换数据库会话为 UTC

修改服务器上的 `/srv/qianshu-dms/docker-compose.yml`（与仓库模板一致）：

```yaml
  db:
    environment:
      TZ: UTC
    command:
      - postgres
      - -c
      - timezone=UTC
      ...
```

然后：

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml up -d db
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml exec -T db \
  psql -U <DB_USER> -d <DB_NAME> -c 'SHOW TimeZone;'   # 期望 UTC
```

### E. 部署新版本并启动

新版本的服务端启动守卫会检查 `current_setting('TimeZone')`，非 `UTC`/`Etc/UTC` 会拒绝启动。先启动 `server`，确认健康检查通过，再启动 `web`。

### F. 页面验收

- 销售收款：新提交并审核一笔，确认「提交人 / 时间」与「审核人 / 时间」相差分钟级；
- 资金流水/批次详情：确认「入账时间」「实际入账时间」与操作时间一致；
- 打木架付款、货件入仓、货件装柜、编号发号时间抽查；
- 用户列表「最近登录」抽查；
- 编号：16:00 之后创建一笔业务，确认编号日期段为当天。

## 修正范围

### +8 小时（Prisma 直接写入）

按表列出，完整清单在 `10-correct.sql`：

- `auth_sessions.created_at`
- `container_batches.created_at/updated_at`
- `container_loading_items.created_at/updated_at`
- `container_loading_item_changes.created_at`
- `currencies/dictionary_items/dictionary_types/exchange_rates/regions.created_at/updated_at`
- `fund_accounts.created_at/updated_at/share_rate_updated_at`
- `fund_business_sources.created_at/updated_at`、`fund_business_source_posting_types.created_at`
- `fund_posting_rule_legs.created_at`、`fund_posting_rule_versions.created_at/published_at`、`fund_posting_types.created_at/updated_at`
- `fund_withdrawal_requests.created_at/submitted_at/reviewed_at/updated_at`
- `invoice_requests.*`（`cancelled_at`、`document_uploaded_at`、`last_submitted_at`、`notified_at`、`rate_captured_at`、`returned_at`、`settled_at` 等）
- `invoice_request_lines.created_at/updated_at`、`invoice_request_status_history.occurred_at`
- `media_assets.created_at/deleted_at/retention_until/updated_at/upload_expires_at`
- `numbering_rules.created_at/updated_at`、`numbering_rule_segments.created_at`、`numbering_rule_versions.created_at`（**不修正** `published_at`，它是数据库时间）
- `packaging_cost_requests.submitted_at/updated_at`（**不修正** `paid_at`）
- `payment_recipient_accounts/profiles.created_at/updated_at`
- `products/product_categories/product_heads.created_at/updated_at`
- `product_media.created_at/detached_at/updated_at`
- `purchase_orders.created_at/updated_at`
- `purchase_order_amount_revisions.changed_at`
- `purchase_order_documents.created_at/detached_at`
- `purchase_order_image_drafts.archived_at/created_at/invalidated_at`
- `purchase_order_lines.created_at`
- `purchase_order_parts.created_at/shipment_recorded_at/shipped_at`
- `purchase_order_payables.closed_at/created_at`
- `purchase_order_payments.created_at/paid_at/voided_at`
- `purchase_order_status_history.changed_at`
- `sales_orders.created_at/updated_at`
- `sales_order_amount_revisions.changed_at`
- `sales_order_documents.created_at/detached_at`
- `sales_order_lines.created_at/removed_at`
- `sales_order_payments.created_at/received_at`（**不修正** `voided_at`、`exchange_rate_captured_at`）
- `sales_order_status_history.changed_at`
- `sales_receipt_requests.received_at/submitted_at/updated_at`（**不修正** `reviewed_at`）
- `slh_bills.created_at/rate_captured_at/superseded_at/updated_at`
- `slh_bill_lines.created_at/reconciled_at`、`slh_bill_line_charges.created_at`
- `slh_reconciliation_batches.completed_at/created_at/updated_at`
- `slh_reconciliation_batch_lines.created_at/reconciled_at`
- `slh_reconciliation_settlements.created_at/updated_at`
- `supplier_shipping_mark_rule_bindings.created_at/updated_at`
- `users.created_at/updated_at`（**不修正** `last_login_at`、`password_changed_at`、`disabled_at`）
- `user_profiles.created_at/updated_at`
- `audit_events.occurred_at`，但排除 `AUTH_RETENTION_PURGED`（该事件由原始 INSERT 走数据库默认值）

### 保持不动（原始 SQL / 数据库函数 / 数据库时间读回）

- `sales_receipt_requests.reviewed_at`
- `sales_order_payments.voided_at`、`exchange_rate_captured_at`
- `purchase_order_parts.warehouse_recorded_at`、`loaded_recorded_at`
- `packaging_cost_requests.paid_at`
- `numbering_issuances.issued_at`
- `numbering_rule_versions.published_at`
- `users.last_login_at`、`password_changed_at`、`disabled_at`
- `auth_sessions.last_activity_at`、`idle_expires_at`、`absolute_expires_at`、`revoked_at`
- `auth_rate_limits.*`
- `fund_posting_batches.posted_at`、`fund_ledger_entries.posted_at`
- `media_object_key_migrations.planned_at/applied_at`
- `numbering_period_states.*`（内部状态，未展示；首次创建走数据库默认，后续 Prisma 更新为早 8 小时，属于混合列，暂不修正）

### 混合列规则

| 列 | 规则 |
|---|---|
| `purchase_order_parts.warehouse_received_at` | 非空且与 `warehouse_recorded_at` 不同时 +8（客户端传入路径）；相等时保持（默认使用记录时间，已正确） |
| `purchase_order_parts.loaded_at` | 仅对**没有** `PURCHASE_SHIPMENT_CONTAINER_LOADED` 审计事件的货件 +8（迁移回填复制了早 8 小时的 `container_loading_items.created_at`；新写入有审计且使用 `clock_timestamp()`） |
| `fund_posting_batches.business_occurred_at` | 仅 `business_source_code_snapshot = 'SALES_RECEIPT'` 时 +8（销售收款传入了收款时间；其余来源使用数据库事务时间，已正确） |

## 回滚

- 修正失败：事务自动回滚，无需额外操作。
- 修正成功但验收不通过：恢复执行前的 `pg_dump` 备份。**不要**直接对同一批列执行 `-8`，否则会二次偏移。
- 如果已经切换到 UTC 再恢复旧备份：恢复后的会话时区仍是 UTC，旧备份中的数据仍是偏移状态；需要重新按本流程执行一次（先确认会话时区为 `Asia/Shanghai`，或临时 `SET timezone='Asia/Shanghai'`）。

## 明确不做

- 不修改已发出的编号，也不回填编号日期段的历史异常（业务已确认只保证后续正确）。
- 不修改 `@db.Date` 日期列（`order_date`、`loading_date`、`period_start/end`）。
- 不修改媒体文件、对象键或资金余额。
