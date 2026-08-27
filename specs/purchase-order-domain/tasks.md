# 采购订单域实施计划

## 执行状态

- 当前阶段：Phase 4 Server 优先实施。
- 已完成：需求确认、技术设计确认、任务确认、采购菜单与两个页头入口。
- 已授权：采购 Server、公共 API、Prisma schema、append-only migration 和相关数据结构变更。
- 暂不实施：采购业务页面；两个采购页面继续只保留页头。
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
  - [x] 4.5 新增单一 append-only migration，并原子 seed 采购权限；`purchase-orders:create-stock` 只授予 `system_admin`。
  - [x] 4.6 运行 Prisma validate、migration apply、schema drift gate 和数据库专项测试。
  - [x] 4.7 检查暂存范围并提交数据库小步提交。
  - _Evidence: Schema 首轮 RED 因采购权限常量缺失失败；实现后结构专项 `3/3`、权限与结构单元 `11/11`、Prisma validate/generate/typecheck/lint 均通过。隔离 PostgreSQL 已从空库应用 27 条 migration、二次 deploy 无待执行项且 schema up to date；数据库专项验证权限目录、`CUSTOM` 双价格和销售来源累计数量约束。完整 E2E 首轮暴露新测试夹具污染，改为事务内夹具后污染相关用例全部恢复；之后两次完整重跑中，采购 schema 均通过，分别只剩既有地区读取和管理登录各一次 `expected 200 / received 404` 的非确定 HTTP 时序失败，最新结果为 36 suites / 203 tests 通过、1 suite / 1 test 失败、4 suites / 10 tests 按条件跳过；未修改无关生产代码。_
  - _Requirements: R2-R12_

- [ ] 5. 以 TDD 实现采购领域纯规则
  - [ ] 5.1 为规范十进制金额、正整数数量和行金额计算建立 RED。
  - [ ] 5.2 为采购总价、定金、尾款等式和付款状态派生建立 RED。
  - [ ] 5.3 为 `CUSTOM` 两个价格必填且规范化后相等建立 RED。
  - [ ] 5.4 为采购类型行形状、待办谓词和三维状态机建立 RED。
  - [ ] 5.5 为唛头 Unicode 长度、空白规范化和未来日期门禁建立 RED。
  - [ ] 5.6 实现最小纯函数并运行采购领域聚焦测试。
  - _Requirements: R2, R5, R7, R9-R11_

- [ ] 6. 以 TDD 实现创建规范化、请求指纹与幂等发号
  - [ ] 6.1 为创建 DTO、规范化命令和不同采购类型 payload 形状建立 RED。
  - [ ] 6.2 为 UUID v4 `Idempotency-Key`、SHA-256 存储和规范请求指纹建立 RED。
  - [ ] 6.3 为“预校验后发号、最终事务重校验”顺序建立 Service RED。
  - [ ] 6.4 接入 `PURCHASE_ORDER` / `PURCHASE_ORDER.CREATE`，覆盖同请求重放、Key 冲突和编号域错误映射。
  - [ ] 6.5 验证客户端不能提交订单号或其他币种。
  - [ ] 6.6 运行创建服务聚焦测试并提交创建核心小步提交。
  - _Requirements: R2-R8, R11-R12_

- [ ] 7. 以 TDD 实现供应商、产品与销售来源校验
  - [ ] 7.1 为 `service_provider.supplier` 最终事务校验建立 RED。
  - [ ] 7.2 为 `CATALOG` 产品 ACTIVE、CNY 采购成本、供应商匹配和快照来源建立 RED。
  - [ ] 7.3 为关联/备货 `CUSTOM` 快照与双价格规则建立 RED。
  - [ ] 7.4 为销售订单有效状态、销售行归属、行类型和产品一致性建立 RED。
  - [ ] 7.5 实现最小依赖加载与快照映射，不信任客户端名称、属性、供应商或采购定价。
  - [ ] 7.6 运行聚焦测试并提交依赖校验小步提交。
  - _Requirements: R2-R6_

- [ ] 8. 以 TDD 实现累计采购量并发控制
  - [ ] 8.1 建立同一销售行多采购订单拆分数量的正常测试。
  - [ ] 8.2 建立累计超量、并发超量和取消释放数量 RED。
  - [ ] 8.3 在 `Serializable` 事务中按来源销售行 UUID 稳定排序加锁并重新聚合。
  - [ ] 8.4 实现数据库延迟约束触发器，防止绕过服务层写入超量数据。
  - [ ] 8.5 使用隔离 PostgreSQL 并发测试证明最多一个冲突事务成功。
  - [ ] 8.6 提交累计采购量小步提交。
  - _Requirements: R2, R6, R8-R9_

- [ ] 9. 以 TDD 实现查询、产品选项和销售来源服务
  - [ ] 9.1 为全部/待办列表、筛选、排序和派生已付/未付金额建立 RED。
  - [ ] 9.2 为详情客户名通过销售订单关联读取建立 RED。
  - [ ] 9.3 为按供应商返回 CNY 正式产品及当前采购成本建立 RED。
  - [ ] 9.4 为最小销售来源订单和明细响应、剩余数量计算建立 RED。
  - [ ] 9.5 实现查询服务，避免把完整销售订单详情泄露到采购权限边界。
  - [ ] 9.6 运行聚焦测试并提交查询小步提交。
  - _Requirements: R2-R6, R12_

- [ ] 10. 以 TDD 实现状态、付款、凭证与审计
  - [ ] 10.1 为履约顺序、取消付款门禁、取消后写入门禁和状态历史建立 RED。
  - [ ] 10.2 为付款金额、`payment.method` 字典、累计上限、状态派生和作废建立 RED。
  - [ ] 10.3 为可选付款凭证上传、关联、软解除和私有内容读取建立 RED。
  - [ ] 10.4 实现采购状态、付款和凭证服务，并只记录非敏感审计摘要。
  - [ ] 10.5 运行聚焦单元与隔离 PostgreSQL E2E，并提交状态付款小步提交。
  - _Requirements: R9-R12_

- [ ] 11. 建立采购公共 API、权限与 OpenAPI 契约
  - [ ] 11.1 为 Controller 路由、DTO、权限、CSRF、状态码和错误矩阵建立 RED。
  - [ ] 11.2 实现列表、详情、产品选项、销售来源、创建、状态和付款接口。
  - [ ] 11.3 实现稳定 operationId 与 `ApiContractResponse`，禁止额外字段漂移。
  - [ ] 11.4 生成 Server OpenAPI snapshot，并通过根契约入口同步 Web snapshot。
  - [ ] 11.5 运行 contract check、Server typecheck/lint/build 和 API E2E。
  - [ ] 11.6 检查暂存范围并提交 API 小步提交。
  - _Requirements: R2-R12_

- [ ] 12. 以 TDD 扩展业务中立产品组件与 Web 适配层
  - [ ] 12.1 为 `ProductSelectorCurrency` 增加 `CNY` 建立类型/逻辑 RED，保证销售币种行为不变。
  - [ ] 12.2 为采购产品 loader、销售来源 loader、AbortSignal 和错误映射建立 RED。
  - [ ] 12.3 为行级采购定价编辑策略建立 RED：`CATALOG` 只读，`CUSTOM` 可编辑且必填。
  - [ ] 12.4 为 `CUSTOM` 双价格分别输入、相等校验和 DTO 映射建立 RED。
  - [ ] 12.5 实现最小通用组件扩展，不导入采购 API、路由、Store 或权限常量。
  - [ ] 12.6 运行销售订单回归和采购 Web 聚焦测试，提交组件/适配小步提交。
  - _Requirements: R3-R7, R12_

- [ ] 13. 实现采购列表与创建交互
  - [ ] 13.1 在用户授权完整 UI 实施后，先按 `ui-design` 与 `web-development` 技能固定最终页面规格。
  - [ ] 13.2 为待办/全部列表模式、筛选和派生金额展示建立 View RED。
  - [ ] 13.3 为“新增销售关联采购”和仅管理员可见的“新增备货采购”入口建立 RED。
  - [ ] 13.4 实现销售来源选择、供应商选择、同步产品、临时产品、金额和唛头表单。
  - [ ] 13.5 实现 Idempotency-Key 生命周期、未知结果安全重试、字段错误和未保存离开门禁。
  - [ ] 13.6 覆盖键盘、焦点、busy/alert、亮暗主题和窄屏布局。
  - [ ] 13.7 运行 Web test/typecheck/lint/build 并提交页面小步提交。
  - _Requirements: R1-R12_

- [ ] 14. 完成跨端、并发与真实浏览器验收
  - [ ] 14.1 扩展隔离 PostgreSQL E2E inventory，覆盖 schema、权限、创建、并发数量和付款全流程。
  - [ ] 14.2 建立采购订单 Browser E2E runner 和稳定 fixture。
  - [ ] 14.3 验证销售关联创建、管理员备货创建、普通用户拒绝和两个采购列表。
  - [ ] 14.4 验证 `CUSTOM` 双价格、供应商漂移、采购成本漂移、超量并发和幂等重放。
  - [ ] 14.5 验证履约到签收、付款到付清后订单从待办列表退出。
  - [ ] 14.6 运行 `node --run check`、contract check、Server E2E、Web build 和 Browser E2E。
  - [ ] 14.7 检查 Git diff、敏感文件、生成物、迁移顺序和小步提交范围。
  - [ ] 14.8 更新本文件真实执行证据并完成收口提交。
  - _Requirements: R1-R12_
