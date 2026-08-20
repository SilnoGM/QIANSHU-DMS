# 销售订单域实施计划

- [x] 1. 固化已确认需求、技术方案与执行边界
  - [x] 1.1 使用 EARS 记录需求和验收标准。
  - [x] 1.2 固定数据库、API、编号、媒体、地址、状态和 UI 设计。
  - [x] 1.3 获得 Prisma Schema、迁移、公共 API 和正式实施授权。
  - _Requirements: R1-R10_

- [ ] 2. 以 TDD 建立销售订单数据库 Schema
  - [ ] 2.1 先建立 Schema RED，覆盖表、枚举、命名约束、索引、权限和媒体引用。
  - [ ] 2.2 扩展 Prisma relations 和审计事件枚举。
  - [ ] 2.3 新增 append-only migration，包含金额、状态、产品行、历史和媒体触发器约束。
  - [ ] 2.4 使用隔离 PostgreSQL 应用迁移并验证失败/成功边界。
  - [ ] 2.5 运行 Prisma validate、drift gate 和聚焦 Schema E2E。
  - [ ] 2.6 更新任务证据并创建 Schema 小步提交。
  - _Requirements: R2-R10_

- [ ] 3. 以 TDD 实现订单规范化和纯领域规则
  - [ ] 3.1 为地址去空白、地区前缀硬拦截建立失败测试。
  - [ ] 3.2 为十进制金额、正整数数量和两项金额等式建立失败测试。
  - [ ] 3.3 为请求指纹、幂等 Key 和状态机建立失败测试。
  - [ ] 3.4 实现最小纯函数并运行聚焦测试。
  - _Requirements: R2-R6, R8_

- [ ] 4. 以 TDD 实现销售订单创建与查询服务
  - [ ] 4.1 先建立 Service RED，覆盖编号时机、幂等重放、产品/地区快照和媒体激活。
  - [ ] 4.2 实现产品币种选择查询和服务端状态复核。
  - [ ] 4.3 实现订单事务、列表、详情和派生金额映射。
  - [ ] 4.4 记录无敏感数据的审计事件。
  - [ ] 4.5 运行聚焦单元与隔离 PostgreSQL E2E。
  - _Requirements: R1-R5, R7, R9-R10_

- [ ] 5. 以 TDD 实现状态、收款、金额修订和凭证服务
  - [ ] 5.1 建立状态流转、取消门禁和签收凭证门禁 RED。
  - [ ] 5.2 建立收款累计、付款状态派生和作废 RED。
  - [ ] 5.3 建立金额约定修订及前后快照 RED。
  - [ ] 5.4 建立临时媒体上传、关联、解除和私有内容读取 RED。
  - [ ] 5.5 实现最小服务并运行聚焦测试。
  - _Requirements: R5-R8, R10_

- [ ] 6. 建立公共 API、权限与 OpenAPI 契约
  - [ ] 6.1 为 DTO、Controller、权限、CSRF 和错误矩阵建立 RED。
  - [ ] 6.2 实现稳定 operationId 和 `ApiContractResponse`。
  - [ ] 6.3 生成 Server snapshot，通过根 `contract:sync` 同步 Web snapshot。
  - [ ] 6.4 运行 contract baseline、Server build/typecheck/lint。
  - [ ] 6.5 更新任务证据并创建 Server API 小步提交。
  - _Requirements: R1-R10_

- [ ] 7. 以 TDD 实现 Web API 适配和纯表单状态
  - [ ] 7.1 建立 generated DTO、API URL、Header、AbortSignal 和 retry 边界 RED。
  - [ ] 7.2 建立币种路由校验、表单默认值、地址规范化、金额汇总和 DTO 映射 RED。
  - [ ] 7.3 实现 Key 延迟创建、未知结果人工重放和字段错误映射。
  - [ ] 7.4 运行 Web API/logic 聚焦测试。
  - _Requirements: R1-R7, R10_

- [ ] 8. 实现币种弹窗、订单列表和新增订单页面
  - [ ] 8.1 为列表币种弹窗和创建页路由门禁建立 View RED。
  - [ ] 8.2 实现工业化业务工作台 8/4 布局及窄屏单列。
  - [ ] 8.3 复用 `QsRegionSelector`、`MoneyInput`、`QsGenericModal` 和现有媒体能力。
  - [ ] 8.4 实现数据库/临时产品明细、地址错误、金额等式和提交状态。
  - [ ] 8.5 覆盖键盘、焦点、busy/alert、light/dark 和未保存离开门禁。
  - [ ] 8.6 运行 Web test/typecheck/lint/build 并创建 Web 小步提交。
  - _Requirements: R1-R7, R9-R10_

- [ ] 9. 完成跨端与真实浏览器验收
  - [ ] 9.1 扩展隔离 PostgreSQL Server E2E inventory。
  - [ ] 9.2 新增销售订单 Browser E2E runner、fixture 和 root script。
  - [ ] 9.3 验证币种弹窗、产品过滤、地址硬拦截、金额硬拦截和成功创建。
  - [ ] 9.4 运行 `node --run check`、contract check、build 和销售订单 E2E。
  - [ ] 9.5 检查 Git diff、敏感文件、生成物和提交范围。
  - [ ] 9.6 更新全部任务真实证据并完成收口提交。
  - _Requirements: R1-R10_
