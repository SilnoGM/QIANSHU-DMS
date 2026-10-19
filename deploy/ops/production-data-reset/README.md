# 生产业务数据清理与产品目录重建执行清单

适用版本：v0.8.3（生产已确认）。
本目录只包含操作文件，不会被应用自动执行。

## 文件

| 文件 | 用途 |
|---|---|
| `00-preflight.sql` | 只读预检：结构、外键、触发器、基线行数、媒体、编号、资金 |
| `10-cleanup.sql` | 单事务清理：42 表 TRUNCATE、媒体记录删除、编号重置、资金归零、外键恢复 |
| `20-verify.sql` | 清理后与产品导入后的验证查询 |

## 重要结论

- 清理会删除生产全部业务数据、收款主档、现有产品目录与全部媒体记录/文件。
- `PRODUCT` 编号流水与计数器保留；导入产品重新发号，不沿用测试机编号。
- 其他编号规则下一次从 1 开始。
- 测试机产品媒体不同步；生产 `product_media` 与 `media_assets` 最终为 0。
- 生产现有产品全部视为测试数据，清空后从测试机导入分类、产品头、产品、排序、状态、属性、备注与价格。
- 10 条清理是**不可逆操作**，只能通过清理前备份恢复。

## 前置条件

1. 生产版本为 v0.8.3，且发布件包含 `dist/commands/product-export.js` 与新版 `product-import.js`。
2. 已完成数据库、媒体、对象键清单备份，并验证可恢复。
3. 已停止 `web`、`server` 与媒体定时清理。
4. 已确定维护窗口、操作人与复核人。
5. 测试机已完成只读导出，导出文件与 SHA-256 已归档。

## 阶段 A：生产清理

### A1. 停止写入

```bash
sudo systemctl stop qianshu-dms-media-cleanup.timer
sudo systemctl stop qianshu-dms-media-cleanup.service
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml stop web server
```

确认 `db` 仍在运行，且没有其他应用连接写入。

### A2. 备份并验证

按《腾讯云 Docker 部署手册》第 13.2 节执行，至少包含：

- `pg_dump -Fc` 数据库备份；
- 本地 `assets/`、`trash/` 打包；
- COS 媒体复制到独立备份桶/前缀，或记录版本控制恢复点；
- 生产 `media_assets.object_key` 全量清单；
- 恢复点文件（UTC、tag、数据库 SHA-256、媒体 SHA-256、文件数/字节数）。

验证：

```bash
pg_restore --list database.dump
tar -tzf media.tar.gz | wc -l
sha256sum database.dump media.tar.gz
```

建议在测试机恢复生产备份并执行一次只读 `recovery-dry-run`，确认可用后再继续。

### A3. 只读预检

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml exec -T db \
  psql -U <DB_USER> -d <DB_NAME> -v ON_ERROR_STOP=1 \
  -f - < 00-preflight.sql | tee preflight.log
```

必须确认：

- 68 张 public 表、193 个外键；
- 42 张待清空表全部存在；
- 4 个反向外键存在；
- 3 个相关触发器存在且启用；
- 迁移最新为 `20261018131000_product_sort_order`；
- 产品、媒体、编号、资金基线已记录。

任一项不符合，停止执行并人工核对。

### A4. 执行清理

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml exec -T db \
  psql -U <DB_USER> -d <DB_NAME> -v ON_ERROR_STOP=1 \
  -f - < 10-cleanup.sql | tee cleanup.log
```

脚本在单事务内执行；任一断言失败会整体回滚。
看到 `清理完成，提交事务` 后才表示数据库已变更。

### A5. 清理媒体文件

本地：

```bash
sudo find /srv/qianshu-dms/media/staging -mindepth 1 -delete
sudo find /srv/qianshu-dms/media/assets  -mindepth 1 -delete
sudo find /srv/qianshu-dms/media/trash   -mindepth 1 -delete
```

COS（与测试环境共桶）：

- 删除 `assets/prod/`、`trash/prod/` 下全部对象；
- legacy `assets/YYYY/MM/`、`trash/YYYY/MM/` 只删除生产对象键清单命中项，不得整目录删除；
- 不删除 `assets/test/`、`trash/test/`、`_ops/`、`_ops/prod/`；
- 未开启版本控制时，删除前必须已有独立备份副本。

### A6. 阶段 A 验证

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml exec -T db \
  psql -U <DB_USER> -d <DB_NAME> -v ON_ERROR_STOP=1 \
  -f - < 20-verify.sql | tee verify-after-cleanup.log
```

必须确认：

- 42 张表行数全为 0；
- `media_assets`、`payment_recipient_*` 为 0；
- 编号只剩 `PRODUCT`；
- `fund_accounts` 余额 0、序号 1；
- 193 个外键、4 个约束 `convalidated=true`；
- 3 个触发器 `tgenabled='O'`；
- 本地与 COS 生产媒体为空。

阶段 A 结束后生产没有产品，不能对外开放。

## 阶段 B：测试机产品目录导入

### B1. 测试机只读导出

在测试机执行（compose 文件路径按测试环境替换）：

```bash
sudo docker compose -f <测试环境 compose 文件> run --rm \
  -v /tmp:/tmp \
  server node dist/commands/product-export.js \
  --file /tmp/product-catalog.json \
  --source-env test \
  --release v0.8.3
```

输出包含：

- `suppliers`、`categories`、`heads`、`products` 数量；
- `incompleteProducts`；
- `dataChecksum`。

`incompleteProducts` 必须为 0；若大于 0，先在测试机补齐缺失分类/产品头的产品，再重新导出。
计算并归档文件 SHA-256：

```bash
sha256sum /tmp/product-catalog.json
```

### B2. 传输到生产

```bash
scp /tmp/product-catalog.json <生产服务器>:/tmp/product-catalog.json
```

### B3. 生产预览

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm \
  -v /tmp/product-catalog.json:/tmp/product-catalog.json:ro \
  server node dist/commands/product-import.js \
  --file /tmp/product-catalog.json --dry-run
```

预期：

- `created` 等于测试机产品数；
- 空目录预览时 `categoriesCreated`、`headsCreated` 与导出数一致；
- `conflicts`、`failures`、`incompleteProducts` 均为 0；
- 预览阶段 `sortOrderUpdated` 只统计已存在行的排序差异，可能为 0；实际写入条数以 `--apply` 输出为准。

### B4. 生产写入

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm \
  -v /tmp/product-catalog.json:/tmp/product-catalog.json:ro \
  server node dist/commands/product-import.js \
  --file /tmp/product-catalog.json --apply
```

导入行为：

- 缺失供应商创建并启用；
- 停用供应商启用；
- 同 value 不同 label 以测试机 label 更新；
- 分类、产品头、产品按业务键创建（产品创建会顺带解析/创建所属分类与产品头，因此 `--apply` 的 `categoriesCreated`/`headsCreated` 可能小于导出数）；
- 产品编号由生产 `PRODUCT` 计数器重新生成；
- 排序、状态、属性、备注、价格按导出值写入；
- 不创建任何产品媒体。

### B5. 生产复核导出

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm \
  -v /tmp:/tmp \
  server node dist/commands/product-export.js \
  --file /tmp/product-catalog-production.json \
  --source-env prod \
  --release v0.8.3

sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm \
  -v /tmp:/tmp \
  server node -e "const a=require('/tmp/product-catalog.json'),b=require('/tmp/product-catalog-production.json'); console.log(a.dataChecksum===b.dataChecksum)"
```

必须输出 `true`。校验和不包含产品编号、时间与来源元数据，因此可直接比对目录内容。

### B6. 阶段 B 验证

再次执行 `20-verify.sql` 第 6 节，确认：

- 分类、产品头、产品数量与测试机一致；
- 产品全部有分类和产品头；
- 产品编号唯一；
- `product_media = 0`、`media_assets = 0`；
- 按供应商分组数量与排序范围合理；
- 审计事件只剩本次导入产生的新记录，这是预期结果。

## 阶段 C：恢复服务

```bash
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml start server web
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml exec -T server \
  curl -fsS http://127.0.0.1:3000/api/health
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm server \
  node dist/commands/media-operations.js health
sudo docker compose -f /srv/qianshu-dms/docker-compose.yml run --rm server \
  node dist/commands/media-operations.js recovery-dry-run
sudo systemctl start qianshu-dms-media-cleanup.timer
```

浏览器验收：

- 管理员登录；
- 产品列表、产品分类、产品详情正常；
- 产品排序与测试机一致；
- 产品无图片时显示空态，不报 500；
- 字典、货币、汇率、编号、用户、角色、权限页面正常；
- 各工作台业务列表为空；
- 个人资金账户余额为 0。

## 回滚

### 阶段 A 事务失败

脚本自动回滚，数据库未变；文件尚未删除。修正后重跑。

### 阶段 A 已提交、阶段 B 前失败

从阶段 A 备份恢复数据库与媒体；恢复后执行：

```sql
TRUNCATE auth_sessions;
```

### 阶段 B 导入失败

优先从“阶段 A 完成后、导入前”的数据库备份恢复空目录状态，修正导入后重试。
若必须整体回退，恢复阶段 A 前的数据库与媒体备份，旧业务数据与旧产品目录都会回来。

### 恢复顺序

1. 停止 `web`、`server`；
2. 恢复数据库（同一恢复点）；
3. 恢复媒体 `assets/`、`trash/`；
4. `TRUNCATE auth_sessions;`
5. 启动 `server`、`web`；
6. 执行 `recovery-dry-run` 与健康检查；
7. 核对保留表行数与预检基线。

## 记录

执行完成后归档：

- preflight.log；
- cleanup.log；
- verify-after-cleanup.log；
- 测试机导出文件与 SHA-256；
- 生产复核导出文件与 checksum；
- 备份恢复点；
- 操作人、复核人、开始/结束时间、结果。
