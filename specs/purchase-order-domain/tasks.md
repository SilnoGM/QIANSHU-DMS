# 采购订单域实施计划

## 执行状态

- 当前阶段：Phase 5 Web 采购列表与创建交互实施中。
- 已完成：需求、技术设计、任务、采购菜单、Server/公共 API、采购列表和创建主流程。
- 已授权：采购 Server、公共 API、Prisma schema、append-only migration 和相关数据结构变更。
- 当前边界：只在既有公共 API 内完成 Web；不新增 schema、公共 API 或数据结构。
- TDD 原则：每个新能力先建立可观察的失败测试，再实现最小能力，最后重构并运行风险匹配的验证。

- [x] 1. 固化已确认需求与技术设计
  - [x] 1.1 使用 EARS 记录采购类型、供应商、产品行、销售同步、金额、编号、状态、付款和唛头需求。
  - [x] 1.2 固定独立采购数据模型、幂等发号、累计采购量和权限设计。
  - [x] 1.3 固定 Web 视觉边界：沿用现有工作台，当前两个页面只保留页头。
  - _Requirements: R1-R12_

- [x] 2. 完成采购菜单迁移与页头基线
  - [x] 2.1 建立 `/qs-operations/purchase/pending-purchase-orders` 的“待办采购”入口。
  - [x] 2.2 建立 `/qs-operations/purchase/purchase-orders` 的“全部采购”入口。
  - [x] 2.3 保持两个页面仅包含 `FaPageHeader`，不提前增加业务 UI。
  - _Evidence: commit `c1bbeee` (`feat: 迁移采购订单菜单与页头`)_
  - _Requirements: R1_

- [x] 3. 完成实施前审批门禁
  - [x] 3.1 用户确认本任务拆分与实施顺序。
  - [x] 3.2 单独获得 Prisma schema、append-only migration 和数据库约束修改授权。
  - [x] 3.3 单独获得采购订单公共 API、权限目录和 OpenAPI 契约修改授权。
  - [x] 3.4 确认 Phase 4 先实施完整 Server 域，Web 业务页面继续只保留页头。
  - _Requirements: R1-R12_

- [x] 4. 以 TDD 建立采购订单数据库 Schema
  - [x] 4.1 先建立 Schema RED，覆盖采购枚举、五张领域表、外键、索引和命名约束。
  - [x] 4.2 为采购类型/销售来源形状、固定 CNY、金额等式、行类型形状和 `CUSTOM` 双价格相等建立失败测试。
  - [x] 4.3 为有效付款汇总、状态一致性和销售来源累计数量建立隔离 PostgreSQL RED。
  - [x] 4.4 扩展 Prisma relations、`MediaAsset` 引用、`User` 引用和审计事件枚举。
  - [x] 4.5 新增采购主 migration 与一条媒体引用向前修复 migration，并原子 seed 采购权限；`purchase-orders:create-stock` 只授予 `system_admin`。
  - [x] 4.6 运行 Prisma validate、migration apply、schema drift gate 和数据库专项测试。
  - [x] 4.7 检查暂存范围并提交数据库小步提交。
  - _Evidence: Schema 首轮 RED 因采购权限常量缺失失败；实现后结构专项 `3/3`、权限与结构单元 `11/11`、Prisma validate/generate/typecheck/lint 均通过。隔离 PostgreSQL 已从空库应用 28 条 migration、二次 deploy 无待执行项且 schema up to date；数据库专项验证权限目录、`CUSTOM` 双价格、销售来源累计数量约束和采购凭证媒体引用闭包。采购主 migration 保持不可变，媒体引用缺口通过 `20260827130000_purchase_order_media_reference_extension` 向前修复。完整 E2E 最新结果中采购 schema 与服务专项通过，全局 38 suites / 210 tests 通过、1 个既有字典接口用例出现 `expected 422 / received 404` 的非确定 HTTP 时序失败、4 suites / 10 tests 按条件跳过；未修改无关生产代码。_
  - _Requirements: R2-R12_

- [x] 5. 以 TDD 实现采购领域纯规则
  - [x] 5.1 为规范十进制金额、正整数数量和行金额计算建立 RED。
  - [x] 5.2 为采购总价、定金、尾款等式和付款状态派生建立 RED。
  - [x] 5.3 为 `CUSTOM` 两个价格必填且规范化后相等建立 RED。
  - [x] 5.4 为采购类型行形状、待办谓词和三维状态机建立 RED。
  - [x] 5.5 为唛头 Unicode 长度、空白规范化和未来日期门禁建立 RED。
  - [x] 5.6 实现最小纯函数并运行采购领域聚焦测试。
  - _Evidence: 3 个领域 suite 首轮均因目标模块不存在而 RED；最小实现后 3 suites / 47 tests 全绿。用户金额入口只接受两位小数，受信任产品成本快照可保留四位；全部运算使用 `bigint` 四位最小单位，并覆盖零元订单直接 `PAID`、`CUSTOM` 双价格、采购类型行形状、取消/履约、待办谓词、Unicode code point 和业务日期门禁。_
  - _Requirements: R2, R5, R7, R9-R11_

- [x] 6. 以 TDD 实现创建规范化、请求指纹与幂等发号
  - [x] 6.1 为创建 DTO、规范化命令和不同采购类型 payload 形状建立 RED。
  - [x] 6.2 为 UUID v4 `Idempotency-Key`、SHA-256 存储和规范请求指纹建立 RED。
  - [x] 6.3 为“预校验后发号、最终事务重校验”顺序建立 Service RED。
  - [x] 6.4 接入 `PURCHASE_ORDER` / `PURCHASE_ORDER.CREATE`，覆盖同请求重放、Key 冲突和编号域错误映射。
  - [x] 6.5 验证客户端不能提交订单号或其他币种。
  - [x] 6.6 运行创建服务聚焦测试并提交创建核心小步提交。
  - _Evidence: 规范化与指纹 2 suites 首轮因 DTO、Normalizer、Fingerprint 模块不存在而 RED；最小实现后 2 suites / 17 tests 通过。创建服务 RED 因 Service 不存在失败；实现后与依赖解析合计 2 suites / 15 tests 通过。已固定销售关联/备货四类行 payload、固定 CNY、两位用户金额、服务端行汇总、字典值规范化、UUID v4 Key、Key SHA-256、发号前预检、最终 `Serializable` 重校验、同请求重放/冲突恢复与 `PURCHASE_ORDER` / `PURCHASE_ORDER.CREATE` 编号范围。_
  - _Requirements: R2-R8, R11-R12_

- [x] 7. 以 TDD 实现供应商、产品与销售来源校验
  - [x] 7.1 为 `service_provider.supplier` 最终事务校验建立 RED。
  - [x] 7.2 为 `CATALOG` 产品 ACTIVE、CNY 采购成本、供应商匹配和快照来源建立 RED。
  - [x] 7.3 为关联/备货 `CUSTOM` 快照与双价格规则建立 RED。
  - [x] 7.4 为销售订单有效状态、销售行归属、行类型和产品一致性建立 RED。
  - [x] 7.5 实现最小依赖加载与快照映射，不信任客户端名称、属性、供应商或采购定价。
  - [x] 7.6 运行聚焦测试并提交依赖校验小步提交。
  - _Evidence: 依赖解析 suite 首轮因 Service 不存在而 RED；实现后 9/9 通过，覆盖系统字典供应商、CNY、管理员备货权限、销售订单/销售行归属与类型、销售快照、当前产品采购成本、正式产品供应商匹配、关联/备货 `CUSTOM` 和累计采购数量。_
  - _Requirements: R2-R6_

- [x] 8. 以 TDD 实现累计采购量并发控制
  - [x] 8.1 建立同一销售行多采购订单拆分数量的正常测试。
  - [x] 8.2 建立累计超量、并发超量和取消释放数量 RED。
  - [x] 8.3 在 `Serializable` 事务中按来源销售行 UUID 稳定排序加锁并重新聚合。
  - [x] 8.4 实现数据库延迟约束触发器，防止绕过服务层写入超量数据。
  - [x] 8.5 使用隔离 PostgreSQL 并发测试证明最多一个冲突事务成功。
  - [x] 8.6 提交累计采购量小步提交。
  - _Evidence: 创建服务先以单元测试固定最终事务来源行锁与聚合顺序；隔离 PostgreSQL 专项 3/3 通过，覆盖同一销售行拆分两张采购单、第三张超量拒绝、取消释放后再次创建，以及两个请求并发争抢数量为 1 的来源行时恰好一个成功且有效采购汇总为 1。完整 E2E 中采购专项继续通过且未污染后续 suite。_
  - _Requirements: R2, R6, R8-R9_

- [x] 9. 以 TDD 实现查询、产品选项和销售来源服务
  - [x] 9.1 为全部/待办列表、筛选、排序和派生已付/未付金额建立 RED。
  - [x] 9.2 为详情客户名通过销售订单关联读取建立 RED。
  - [x] 9.3 为按供应商返回 CNY 正式产品及当前采购成本建立 RED。
  - [x] 9.4 为最小销售来源订单和明细响应、剩余数量计算建立 RED。
  - [x] 9.5 实现查询服务，避免把完整销售订单详情泄露到采购权限边界。
  - [x] 9.6 运行聚焦测试并提交查询小步提交。
  - _Evidence: 两个 Query suite 首轮因 Service 不存在而 RED；实现后 2 suites / 7 tests 通过，覆盖固定待办谓词、稳定排序、有效付款聚合、客户名关联、历史供应商解析、有效供应商 CNY 产品选项、最小 CONFIRMED 销售来源与剩余可采购数量。采购模块累计 9 suites / 86 tests，typecheck/lint 全绿。_
  - _Requirements: R2-R6, R12_

- [x] 10. 以 TDD 实现状态、付款、凭证与审计
  - [x] 10.1 为履约顺序、取消付款门禁、取消后写入门禁和状态历史建立 RED。
  - [x] 10.2 为付款金额、`payment.method` 字典、累计上限、状态派生和作废建立 RED。
  - [x] 10.3 为可选付款凭证上传、关联、软解除和私有内容读取建立 RED。
  - [x] 10.4 实现采购状态、付款和凭证服务，并只记录非敏感审计摘要。
  - [x] 10.5 运行聚焦单元与隔离 PostgreSQL E2E，并提交状态付款小步提交。
  - _Evidence: 状态/付款/凭证测试先因目标 Service 不存在而 RED；实现后聚焦 2 suites / 9 tests 通过，采购模块累计 11 suites / 95 tests 全绿，typecheck/lint 通过并提交 `dca1ce3`。隔离 PostgreSQL 进一步证明备货权限、付款 `UNPAID → PARTIALLY_PAID → PAID`、尾款作废回退、取消付款门禁、五步履约和待办退出/重入。_
  - _Requirements: R9-R12_

- [x] 11. 建立采购公共 API、权限与 OpenAPI 契约
  - [x] 11.1 为 Controller 路由、DTO、权限、CSRF、状态码和错误矩阵建立 RED。
  - [x] 11.2 实现列表、详情、产品选项、销售来源、创建、状态和付款接口。
  - [x] 11.3 实现稳定 operationId 与 `ApiContractResponse`，禁止额外字段漂移。
  - [x] 11.4 生成 Server OpenAPI snapshot，并通过根契约入口同步 Web snapshot。
  - [x] 11.5 运行 contract check、Server typecheck/lint/build 和 API E2E。
  - [x] 11.6 检查暂存范围并提交 API 小步提交。
  - _Evidence: Controller suite 首轮因目标 Controller 不存在而 RED；实现后采购模块 12 suites / 99 tests 全绿，固定 14 个 HTTP operationId、权限和创建后详情读取。采购 HTTP API E2E 4/4、全局 HTTP contract E2E 23/23 均通过；`contract:sync` 已同步 Server/Web OpenAPI，`contract:check`、Server typecheck/lint/build 均通过。`node --run check` 全绿，覆盖 Root 685/685、Server 2396/2396、Web 975 项、28 条 migration 空库部署、正式构建与真实 Chrome 4/4。完整 Server E2E 中采购专项通过；全局仅有既有字典接口一次 `expected 422 / received 404` 的非确定 HTTP 失败。_
  - _Requirements: R2-R12_

- [x] 12. 以 TDD 扩展业务中立产品组件与 Web 适配层
  - [x] 12.1 为 `ProductSelectorCurrency` 增加 `CNY` 建立类型/逻辑 RED，保证销售币种行为不变。
  - [x] 12.2 为采购产品 loader、销售来源 loader、AbortSignal 和错误映射建立 RED。
  - [x] 12.3 为行级采购定价编辑策略建立 RED：`CATALOG` 只读，`CUSTOM` 可编辑且必填。
  - [x] 12.4 为 `CUSTOM` 双价格分别输入、相等校验和 DTO 映射建立 RED。
  - [x] 12.5 实现最小通用组件扩展，不导入采购 API、路由、Store 或权限常量。
  - [x] 12.6 运行销售订单回归和采购 Web 聚焦测试，提交组件/适配小步提交。
  - _Evidence: 采购 API 与组件测试先因模块/导出/可选属性缺失形成 4 个 RED；最小实现后采购适配、产品选择、产品明细和销售创建回归 55/55 通过。Web typecheck 通过；`QsProductSelector` 以固定供应商可选参数隔离订单级供应商，`QsOrderProductLineEditor` 以默认关闭的双价格输入能力保持销售行为不变。_
  - _Requirements: R3-R7, R12_

- [ ] 13. 实现采购列表与创建交互
  - [x] 13.1 在用户授权完整 UI 实施后，先按 `ui-design` 与 `web-development` 技能固定最终页面规格。
  - [x] 13.2 为待办/全部列表模式、筛选和派生金额展示建立 View RED。
  - [x] 13.3 为“新增销售关联采购”和仅管理员可见的“新增备货采购”入口建立 RED。
  - [x] 13.4 实现销售来源选择、供应商选择、同步产品、临时产品、金额和唛头表单。
  - [x] 13.5 实现 Idempotency-Key 生命周期、未知结果安全重试、字段错误和未保存离开门禁。
  - [ ] 13.6 覆盖键盘、焦点、busy/alert、亮暗主题和窄屏布局。
  - [x] 13.7 运行 Web test/typecheck/lint/build 并提交页面小步提交。
  - _Partial evidence: 列表逻辑与 View 先因目标模块不存在、占位页未实现形成 4 个 RED；实现后采购列表逻辑/页面 7/7、连同销售页面回归 14/14 通过。创建逻辑、来源选择器与页面结构先形成 4 个 RED；实现后采购创建与通用明细聚焦测试 25/25、Web API/View 全量 998/998 通过，Web typecheck、变更文件 eslint/stylelint 与正式 build 通过。两个列表使用服务端 `view=all|pending` 和全量筛选；创建页固定 CNY、供应商字典、销售剩余明细同步、管理员备货、`CUSTOM` 双价格、金额等式、唛头、二次确认、未知结果同 Key 重放和未保存离开门禁。_
  - _Requirements: R1-R12_

- [ ] 14. 完成跨端、并发与真实浏览器验收
  - [x] 14.1 扩展隔离 PostgreSQL E2E inventory，覆盖 schema、权限、创建、并发数量和付款全流程。
  - [ ] 14.2 建立采购订单 Browser E2E runner 和稳定 fixture。
  - [ ] 14.3 验证销售关联创建、管理员备货创建、普通用户拒绝和两个采购列表。
  - [ ] 14.4 验证 `CUSTOM` 双价格、供应商漂移、采购成本漂移、超量并发和幂等重放。
  - [x] 14.5 验证履约到签收、付款到付清后订单从待办列表退出。
  - [ ] 14.6 运行 `node --run check`、contract check、Server E2E、Web build 和 Browser E2E。
  - [ ] 14.7 检查 Git diff、敏感文件、生成物、迁移顺序和小步提交范围。
  - [ ] 14.8 更新本文件真实执行证据并完成收口提交。
  - _Partial evidence: Server 侧采购 schema、创建、并发数量、付款和履约 E2E 已通过；根检查、契约、Web build 与既有真实 Browser E2E 已通过。采购列表与创建主流程已实现，采购专项 Browser E2E、漂移/并发边界和完整 Web 收口验证仍待本阶段后续执行。_
  - _Requirements: R1-R12_
