# 销售订单采购覆盖进度联动实施计划

## 1. 文档状态

- 状态：已完成
- 编写日期：2026-09-01
- 需求规格：[requirements.md](./requirements.md)
- 技术设计：[design.md](./design.md)

## 2. 执行原则

- 严格采用 TDD：先建立失败测试并确认失败原因，再实现最小代码。
- 每完成一个任务立即更新本文件的勾选状态。
- 不修改公共 API、DTO、OpenAPI、Prisma Schema、migration 或 Web 代码。
- 不执行会创建真实业务订单的浏览器测试；运行态真相源为隔离 PostgreSQL E2E。
- 命令失败必须停止并如实报告，不跳过失败检查。
- 使用小步本地 Git 提交，不推送远端。

## 3. 实施任务

- [x] 1. 固化已确认规格并建立干净实施起点
  - 将 `requirements.md`、`design.md`、`tasks.md` 状态更新为已确认。
  - 运行 `git diff --check`，确认规格文件没有格式问题。
  - 检查暂存范围，只提交本需求的三个规格文件。
  - 创建本地提交：`docs: 定义销售采购覆盖联动规则`。
  - _Requirements: R1, R2, R3, R4_

- [x] 2. 为覆盖算法和联动服务建立失败测试
  - 新增 `sales-order-purchase-coverage.service.spec.ts`。
  - 覆盖空销售明细、部分覆盖、累计全部覆盖、缺失采购汇总、相同产品多销售行和 `CUSTOM` 行。
  - 覆盖 `PENDING -> PREPARING` 时的订单更新、版本递增、状态历史和审计写入。
  - 覆盖未全部采购、已处于后续履约状态和无效销售订单时不得产生部分写入。
  - 断言销售订单主行锁先于覆盖查询执行。
  - 运行定向测试并确认因实现缺失或行为缺失而失败，不接受测试装配错误作为有效 RED。
  - _Requirements: R1.1-R1.5, R2.1-R2.5, R3.1-R3.5, R4.1-R4.3_

- [x] 3. 实现销售订单采购覆盖联动服务
  - 新增 `SalesOrderPurchaseCoverageService` 和纯函数 `isSalesOrderPurchaseFullyCovered()`。
  - 使用参数化 `SELECT ... FOR UPDATE` 锁定销售订单主行。
  - 查询销售订单全部销售明细，并按 `sourceSalesOrderLineId` 汇总非取消销售关联采购数量。
  - 空销售明细返回未覆盖；缺失汇总按数量 `0` 处理。
  - 复用 `assertSalesOrderFulfillmentTransition()` 校验 `PENDING -> PREPARING`。
  - 原子写入销售履约状态、版本、履约历史及销售履约审计。
  - 对锁顺序、并发目的和 no-op 条件补充必要中文代码注释。
  - 运行任务 2 的定向测试并确认转绿。
  - _Requirements: R1, R2, R3, R4.1-R4.3_

- [x] 4. 将联动服务接入采购创建事务
  - 在 `PurchaseOrdersModule` 注册 `SalesOrderPurchaseCoverageService`。
  - 在 `PurchaseOrderCommandService` 注入服务。
  - 更新 `purchase-order-command.service.spec.ts` 的测试夹具和失败断言。
  - 只在 `SALES_LINKED` 创建路径、采购明细成功写入后调用联动服务。
  - 验证备货采购不调用、幂等命中不调用、调用失败时采购创建事务不返回成功。
  - 保持现有采购创建审计、发号、指纹和错误映射不变。
  - _Requirements: R1.1, R2.1-R2.5, R3.5, R4.1, R4.4-R4.5_

- [x] 5. 增加隔离 PostgreSQL 端到端测试
  - 扩展 `purchase-order-service.e2e-spec.ts` 的销售订单和产品明细测试夹具。
  - 验证单张部分采购保持 `PENDING`。
  - 验证后续采购累计补齐后进入 `PREPARING`。
  - 验证数据库产品与 `CUSTOM` 混合明细按销售明细 ID 独立累计。
  - 验证同一销售订单不同销售明细并发提交后最终进入 `PREPARING`。
  - 验证只生成一条履约状态历史和一条销售履约审计。
  - 验证幂等重放不增加历史、审计或销售订单版本。
  - 验证备货采购不修改销售订单。
  - _Requirements: R1.2-R1.5, R2, R3, R4_

- [x] 6. 完成服务端与仓库级验证
  - 运行定向单元测试：
    `pnpm -C server test -- sales-order-purchase-coverage.service.spec.ts purchase-order-command.service.spec.ts --runInBand`。
  - 运行服务端类型检查：`pnpm -C server typecheck`。
  - 运行服务端代码规范检查：`pnpm -C server lint`。
  - 运行隔离数据库 E2E：
    `node scripts/ci-postgres.mjs -- zsh -lc 'pnpm -C server db:migrate:deploy && pnpm -C server test:e2e -- purchase-order-service.e2e-spec.ts'`。
  - 运行仓库总检查：`node --run check`。
  - 运行 `git diff --check`，并确认没有 API、Schema、migration、OpenAPI 或 Web 变更。
  - _Requirements: R1, R2, R3, R4_

- [x] 7. 更新任务状态并创建业务实现提交
  - 将已完成任务逐项勾选，并把本文件状态更新为已完成。
  - 检查 Git 暂存范围，不包含 `.env`、日志、生成目录或无关用户改动。
  - 创建本地提交：`feat: 联动销售订单采购进度`。
  - 记录提交 SHA、测试结果、工作区状态和未推送说明。
  - _Requirements: R1, R2, R3, R4_

## 4. 完成定义

只有同时满足以下条件才可声明实施完成：

1. 所有任务均已勾选；
2. 定向单元测试、隔离 PostgreSQL E2E、类型检查、Lint 和仓库总检查全部通过；
3. 销售关联采购的部分覆盖、累计补齐、`CUSTOM`、并发和幂等场景均有自动化证据；
4. 采购创建与销售进度联动在同一事务内提交或回滚；
5. Git 工作区干净；
6. 本地提交完成且未推送远端。
