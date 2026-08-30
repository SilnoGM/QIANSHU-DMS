# 销售订单对账与完成状态实施计划

## 1. 文档状态

- 状态：已完成
- 计划日期：2026-08-30
- 需求规格：[requirements.md](./requirements.md)
- 技术设计：[design.md](./design.md)

## 2. 实施任务

- [x] 1. 建立失败测试基线
  - 新增订单状态 Schema 测试，期望五值 Enum、追加 migration 和已完成数据库约束。
  - 扩展状态机测试，覆盖两条新增合法流转、非法跳转和两类前置条件错误。
  - 扩展 Mutation 测试，覆盖锁内校验、历史、审计和已完成收款冻结。
  - 调整 Web 列表逻辑测试，先期望待对账、已完成真实查询目标。
  - 运行聚焦测试并保留预期失败证据。
  - _Requirements: R1, R2, R3, R4, R5_

- [x] 2. 扩展 Prisma 订单状态枚举
  - 将 `SalesOrderStatus` 扩展为 `DRAFT`、`CONFIRMED`、`PENDING_RECONCILIATION`、`COMPLETED`、`CANCELLED`。
  - 保持 `DRAFT` Schema 默认值和当前正式创建直接写入 `CONFIRMED` 的行为不变。
  - 运行 Prisma format、validate 和 generate。
  - _Requirements: R1_

- [x] 3. 追加并验证数据库 migration
  - 新增 `20260830120000_expand_sales_order_status_reconciliation` migration，不修改既有 migration。
  - 在单一事务内原子替换 PostgreSQL Enum 并恢复默认值。
  - 增加 `COMPLETED` 必须满足 `SIGNED + PAID` 的 Check Constraint。
  - 增加迁移内 Enum、当前状态和完成状态约束断言。
  - 新增隔离 PostgreSQL migration E2E，证明旧状态无损、合法完成可写、非法完成被拒绝。
  - _Requirements: R1, R2, R3_

- [x] 4. 实现 Server 状态机与完成冻结
  - 扩展 `ORDER_TRANSITIONS` 和运行时订单状态集合。
  - 在订单行锁后校验进入待对账和已完成的 `SIGNED + PAID` 条件。
  - 新增两个条件错误和 `SALES_ORDER_COMPLETED` 错误。
  - 保持状态历史、审计和版本更新的既有原子边界。
  - 禁止已完成订单增加或作废实际收款；待对账继续允许收款纠错。
  - _Requirements: R2, R3, R4_

- [x] 5. 同步公共 API 契约
  - 更新 order-status endpoint 的 422 错误契约以及收款相关 endpoint 的已完成错误契约。
  - 通过 `contract:sync` 更新 Server/Web OpenAPI 快照和 Web 生成类型。
  - 运行 `contract:check`，确认五值枚举和错误码完全同步。
  - _Requirements: R1, R2, R3_

- [x] 6. 接入 Web 可信状态筛选和展示
  - 将“全部订单”查询目标扩展为四类正式状态并继续排除 `DRAFT`。
  - 将“待对账”和“已完成”映射到真实 `orderStatus` 查询。
  - 更新桌面、窄屏和变更记录的中文标签及语义颜色。
  - 删除“尚未进入当前数据契约”的特殊空状态。
  - 保持待办页面和采购来源查询固定为 `CONFIRMED`。
  - _Requirements: R5_

- [x] 7. 完成聚焦与全量验证
  - 运行 Prisma schema、migration、状态机、Mutation、Query、DTO 和 OpenAPI 聚焦测试。
  - 运行 Web API、列表逻辑、页面静态契约、类型检查与 lint。
  - 在隔离 PostgreSQL 16 完整部署全部 migration 两次并核对状态。
  - 运行根级 `node --run check` 和 `git diff --check`。
  - 任一失败必须如实记录、修复并重跑。
  - _Requirements: R1, R2, R3, R4, R5_

- [x] 8. 应用 migration 到当前开发数据库
  - 在不输出凭据的前提下确认目标数据库身份不含生产标识。
  - 执行 `pnpm -C server db:migrate:deploy`。
  - 执行 `prisma migrate status` 并使用只读 SQL 核对五值 Enum、Check Constraint 和 migration 记录。
  - 不使用 `db push`、`migrate resolve` 或任何破坏性重置命令。
  - _Requirements: R1, R2, R3_

- [x] 9. 更新数据库迁移文档并最终提交
  - 更新数据库迁移规范中的追加历史、当前数量和本次 migration 说明。
  - 检查 Git 暂存范围，不提交 `.env`、生成 Prisma Client、日志、构建产物或无关文件。
  - 创建提交 `feat: 增加销售订单待对账与已完成状态`。
  - 不自动 push、合并、发布或部署生产环境。
  - _Requirements: R1, R2, R3, R4, R5_

## 3. 完成定义

- 数据库、Prisma、Server、OpenAPI 和 Web 对 `SalesOrderStatus` 使用完全一致的五值枚举。
- 待对账和已完成只允许按已确认顺序显式流转，两次都在行锁事务内校验 `SIGNED + PAID`。
- 已完成状态同时受到服务端冻结和数据库 Check Constraint 保护。
- 全部订单页面的待对账、已完成筛选返回真实服务端数据，不再是占位入口。
- 新 migration 在隔离库和当前开发数据库均成功应用并通过只读复核。
- 所有必要验证通过，变更形成一个规范 Git 提交且未推送。
