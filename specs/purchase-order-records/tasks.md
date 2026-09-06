# 实施任务

- [x] 确认需求、schema/API 变更及只生成 migration 的边界。
- [x] 补 schema 与独立凭证归档失败测试。
- [x] 实现数据模型、迁移约束、凭证事务与接口。
- [x] 补齐付款及自动状态变更原因与详情金额历史。
- [x] 同步 OpenAPI、实现前端凭证归档与合并变更记录。
- [x] 运行测试、类型、lint、契约及隔离数据库验证（最终全量集成通过，首轮失败与处理见验收记录）。
- [x] 检查提交范围并进行本地标准提交（不推送）。

## 后续：业务库迁移与列表新增列

- [x] 核对业务库、已应用迁移校验值及唯一待应用目标。
- [x] 创建受限权限备份，应用 migration，复核 schema、原有采购数据及健康检查。
- [x] 核对采购列表与销售列表现有实现，列出新增摘要字段方案。
- [x] 获得 `list-extension-design.md` 中公开 API 响应扩展确认。
- [x] 按 TDD 扩展列表摘要并同步 OpenAPI。
- [x] 接入共用采购表格三列，完成自动及页面验证后本地提交。

## 后续：付款凭证按采购订单号与付款类型命名

- [x] 确认 `DEPOSIT / BALANCE / OTHER` 分别使用“定金凭证 / 尾款凭证 / 其他付款凭证”，只影响新凭证，不改变原始文件名及历史标题。
- [x] 先补命名失败测试（3 项），再在记录付款事务中根据真实 `orderNo` 生成标题；补客户端覆盖拒绝与历史读取回归。
- [x] 隔离 PostgreSQL 验证三类标题落库、原始文件名保留、已激活附件不可重复使用、付款累计不变；不写入业务库。
- [x] 验证命令及结果：
  - `pnpm -C server exec jest --runInBand`：256 个套件、2625 项通过。
  - `pnpm -C server exec tsc --noEmit`：通过。
  - `pnpm -C server exec eslint src/modules/purchase-orders/purchase-order-mutation.service.ts src/modules/purchase-orders/purchase-order-mutation.service.spec.ts src/modules/purchase-orders/purchase-order-query.service.spec.ts test/purchase-order-service.e2e-spec.ts`：通过。
  - `node ./scripts/ci-postgres.mjs -- /bin/sh -c 'pnpm -C server db:migrate:deploy && pnpm -C server exec jest --config test/jest-e2e.json --runInBand --runTestsByPath test/purchase-order-service.e2e-spec.ts'`：10 项通过；仅在临时数据库部署已有迁移。输出一条 `pg` 并发查询弃用警告，未导致失败。
  - `pnpm -C web test:api`：1123 项通过；`pnpm -C web typecheck`：通过。
  - `git diff --check`：通过。
- 前端沿用服务端保存标题；本次无 UI 变动，未向业务库提交测试付款。首轮新增覆盖拒绝测试误用了错误码，已按现有 `VALIDATION_FAILED` 修正，再验证三条命名用例确实失败后实施修复。
