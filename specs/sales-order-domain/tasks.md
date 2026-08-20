# 销售订单域实施计划

- [x] 1. 固化已确认需求、技术方案与执行边界
  - [x] 1.1 使用 EARS 记录需求和验收标准。
  - [x] 1.2 固定数据库、API、编号、媒体、地址、状态和 UI 设计。
  - [x] 1.3 获得 Prisma Schema、迁移、公共 API 和正式实施授权。
  - _Requirements: R1-R10_

- [x] 2. 以 TDD 建立销售订单数据库 Schema
  - [x] 2.1 先建立 Schema RED，覆盖表、枚举、命名约束、索引、权限和媒体引用。
  - [x] 2.2 扩展 Prisma relations 和审计事件枚举。
  - [x] 2.3 新增 append-only migration，包含金额、状态、产品行、历史和媒体触发器约束。
  - [x] 2.4 使用隔离 PostgreSQL 应用迁移并验证失败/成功边界。
  - [x] 2.5 运行 Prisma validate、drift gate 和聚焦 Schema E2E。
  - [x] 2.6 更新任务证据并创建 Schema 小步提交。
  - _Evidence: `pnpm -C server check`（211 suites / 2142 tests）；`node --run ci:server-e2e`（34 suites / 199 tests，另含 4 组产品媒体专项 E2E）_
  - _Requirements: R2-R10_

- [x] 3. 以 TDD 实现订单规范化和纯领域规则
  - [x] 3.1 为地址去空白、地区前缀硬拦截建立失败测试。
  - [x] 3.2 为十进制金额、正整数数量和两项金额等式建立失败测试。
  - [x] 3.3 为请求指纹、幂等 Key 和状态机建立失败测试。
  - [x] 3.4 实现最小纯函数并运行聚焦测试。
  - _Evidence: `pnpm -C server exec jest src/modules/sales-orders --runInBand`（5 suites / 54 tests）；`pnpm -C server typecheck`；销售订单目录 ESLint_
  - _Requirements: R2-R6, R8_

- [x] 4. 以 TDD 实现销售订单创建与查询服务
  - [x] 4.1 先建立 Service RED，覆盖编号时机、幂等重放、产品/地区快照和媒体激活。
  - [x] 4.2 实现产品币种选择查询和服务端状态复核。
  - [x] 4.3 实现订单事务、列表、详情和派生金额映射。
  - [x] 4.4 记录无敏感数据的审计事件。
  - [x] 4.5 运行聚焦单元与隔离 PostgreSQL E2E。
  - _Evidence: 销售订单聚焦单元测试（7 suites / 61 tests）；`node --run ci:server-e2e`（35 suites / 200 tests，另含 4 组产品媒体专项 E2E）_
  - _Requirements: R1-R5, R7, R9-R10_

- [x] 5. 以 TDD 实现状态、收款、金额修订和凭证服务
  - [x] 5.1 建立状态流转、取消门禁和签收凭证门禁 RED。
  - [x] 5.2 建立收款累计、付款状态派生和作废 RED。
  - [x] 5.3 建立金额约定修订及前后快照 RED。
  - [x] 5.4 建立临时媒体上传、关联、解除和私有内容读取 RED。
  - [x] 5.5 实现最小服务并运行聚焦测试。
  - _Evidence: `sales-order-mutation.service.spec.ts` 覆盖三维状态、签收门禁、取消门禁、金额修订、收款与作废；Server 全量单元检查通过_
  - _Requirements: R5-R8, R10_

- [x] 6. 建立公共 API、权限与 OpenAPI 契约
  - [x] 6.1 为 DTO、Controller、权限、CSRF 和错误矩阵建立 RED。
  - [x] 6.2 实现稳定 operationId 和 `ApiContractResponse`。
  - [x] 6.3 生成 Server snapshot，通过根 `contract:sync` 同步 Web snapshot。
  - [x] 6.4 运行 contract baseline、Server build/typecheck/lint。
  - [x] 6.5 更新任务证据并创建 Server API 小步提交。
  - _Evidence: `pnpm -C server check`（218 suites / 2203 tests）；`node --run contract:check`；Server/Web OpenAPI snapshot 一致_
  - _Requirements: R1-R10_

- [x] 7. 以 TDD 实现 Web API 适配和纯表单状态
  - [x] 7.1 建立 generated DTO、API URL、Header、AbortSignal 和 retry 边界 RED。
  - [x] 7.2 建立币种路由校验、表单默认值、地址规范化、金额汇总和 DTO 映射 RED。
  - [x] 7.3 实现 Key 延迟创建、未知结果人工重放和字段错误映射。
  - [x] 7.4 运行 Web API/logic 聚焦测试。
  - _Evidence: 销售订单 Web logic/View 聚焦测试（10 tests）；`pnpm -C web check`（Node scripts 172 tests、TypeScript scripts 49 tests、API/View 890 tests）_
  - _Requirements: R1-R7, R10_

- [x] 8. 实现币种弹窗、订单列表和新增订单页面
  - [x] 8.1 为列表币种弹窗和创建页路由门禁建立 View RED。
  - [x] 8.2 实现工业化业务工作台 8/4 布局及窄屏单列。
  - [x] 8.3 复用 `QsRegionSelector`、`MoneyInput`、`QsGenericModal` 和现有媒体能力。
  - [x] 8.4 实现数据库/临时产品明细、地址错误、金额等式和提交状态。
  - [x] 8.5 覆盖键盘、焦点、busy/alert、light/dark 和未保存离开门禁。
  - [x] 8.6 运行 Web test/typecheck/lint/build 并创建 Web 小步提交。
  - _Evidence: `node --run build` 通过；`pnpm -C web check` 通过；真实 Chrome 验证币种门禁、产品选择、字段错误与成功创建_
  - _Requirements: R1-R7, R9-R10_

- [x] 9. 完成跨端与真实浏览器验收
  - [x] 9.1 扩展隔离 PostgreSQL Server E2E inventory。
  - [x] 9.2 新增销售订单 Browser E2E runner、fixture 和 root script。
  - [x] 9.3 验证币种弹窗、产品过滤、地址硬拦截、金额硬拦截和成功创建。
  - [x] 9.4 运行 `node --run check`、contract check、build 和销售订单 E2E。
  - [x] 9.5 检查 Git diff、敏感文件、生成物和提交范围。
  - [x] 9.6 更新全部任务真实证据并完成收口提交。
  - _Evidence: `node --run check`（Root 685 tests；Server 219 suites / 2207 tests；Web Node scripts 172、TypeScript scripts 49、API/View 890 tests；Browser 4 tests）；`node --run contract:check`（由根 check 串行通过）；`node --run build`；`node --run ci:server-e2e`（35 suites / 200 tests，另含 4 组产品媒体专项 E2E）_
  - _Requirements: R1-R10_
