# 产品创建实施任务

## 1. 文档状态

- 状态：Phase 3 已确认，Phase 4 实施中
- Requirements 确认日期：2026-08-12
- Design 确认日期：2026-08-12
- 编写日期：2026-08-12
- 实施分支：`feat/admin-product-management`
- Requirements：`specs/product-create/requirements.md`
- Design：`specs/product-create/design.md`
- 当前门禁：Gate T 已于 2026-08-12 确认；Phase 4 只按 Gate R/D/T 边界实施，Gate DB 与 Gate E 仍未授权

本计划把产品创建拆为 14 个可独立验证、保持绿色并形成小步提交的任务。任务顺序固定为：绿色基线 -> Schema/Audit -> 编号 scoped 幂等 -> Currency Lookup -> Product 纯逻辑 -> Product Command -> 公共 API -> Server E2E -> OpenAPI 同步 -> Web API/状态机 -> 表单组件 -> 页面编排 -> Browser 验收 -> 全量收口。

## 2. 执行纪律

每个功能任务遵循同一 TDD 闭环：

```text
确认任务边界与前置门禁
-> 添加因目标能力缺失而失败的测试
-> 运行并记录预期 RED 原因
-> 实现最小正确能力
-> 重构并补齐失败/并发/安全路径
-> 运行任务级 GREEN 验证
-> 更新 tasks.md 的状态与真实证据
-> 检查 staged diff、secrets 与 generated 边界
-> 创建绿色小步提交
```

执行规则：

1. 不提交永久红测、不能 typecheck 或不能构建的状态；RED 只作为实施过程证据。
2. 命令错误或测试失败必须记录真实命令、退出码和原因；未转绿前不得勾选任务。
3. 只使用 `apply_patch` 编辑源码和手写文档；OpenAPI/generated 产物只由根脚本生成。
4. 不手工修改 `server/openapi/openapi.json`、`web/openapi/openapi.json` 或 `web/apps/qsmds-arco/src/api/generated/**`。
5. 不修改任何既有 migration；唯一新 migration 只增加 `PRODUCT_CREATED` enum value。
6. 不修改 Product、Numbering、Currency 或 Dictionary 表结构，不新增 Product 幂等表，不 seed 持久环境业务数据。
7. 不恢复独立 Supplier Model/API/Store/权限或专用选择器；产品只保存 `service_provider.supplier` 的稳定 `supplierValue`。
8. 不修改 `MoneyInput`、`QsDictionarySelect`、`QsGenericModal`、`QsGenericTable` 等公共组件契约；业务规则留在 Product 调用方。
9. 不实现媒体输入/上传、Product 查看/编辑/状态变更/删除、SKU/SPU 或新权限。
10. 不新增第三方依赖，不在根目录创建依赖资产，不让 Web/Server 跨目录引用源码。
11. Numbering scoped 入口只能接收固定摘要，不能让 Numbering 模块认识 Product Payload、User 或 Audit。
12. Product mutation 必须 `retry:false`；原始 Key/Payload 不进入日志、Audit、持久浏览器存储或错误正文。
13. Prisma generate、Server check、contract sync/check 必须串行执行，避免并发改写 generated tree。
14. 每次提交前运行范围匹配的测试和 `git diff --check`，核对暂存范围、`.env`、密钥、日志与构建产物。
15. Commit Message 类型使用英文、描述使用中文；不使用 amend、rebase、force push 或历史重写。
16. 未经后续明确授权，不把 migration 应用到持久开发库，不执行 push、PR、merge、部署、分支删除或 worktree 清理。

## 3. 阶段与高风险门禁

### Gate R - Requirements

- [x] Product 字段、状态、供应商、金额、属性、媒体延期、权限、幂等、页面与验收标准已确认。
- [x] `ACTIVE` 供应商要求、价格币种、属性上限与未知结果人工重放语义已确认。

### Gate D - Design 与高风险变更方向

- [x] 用户已于 2026-08-12 确认 `POST /api/products` / `products_create`、Create DTO 和必填 `Idempotency-Key` Header。
- [x] 用户已确认内部 `GenerateScopedNumberRequest` / `generateScoped()`，复用既有 issuance 指纹列且不新增幂等表。
- [x] 用户已确认 Prisma `AuditEventType.PRODUCT_CREATED` 与只扩展 enum 的 append-only migration。
- [x] 用户已确认 OpenAPI/generated types 更新与正式 Web 创建页面方向。

### Gate T - Phase 3 任务清单与正式实施

- [x] 用户已于 2026-08-12 确认本任务顺序、TDD 证据、文件边界、提交序列和验证矩阵。
- [x] Gate T 已确认，Phase 4 只实施 Gate R/D 已确认的精确范围。

### Gate DB - 持久开发数据库

- [ ] 创建 migration 文件和隔离 PostgreSQL 验证不等于持久数据库授权。
- [ ] 若后续需要应用，必须先展示唯一 migration、目标数据库、只读影响检查和备份/恢复边界，再取得独立明确确认。

### Gate E - 外部发布

- [ ] 本地完成后暂停；push、PR、merge、部署和非本地数据库变更均需新的明确授权。

## 4. 实施任务

- [x] 1. 建立 Phase 4 绿色基线并复核可变真相源
  - [x] 1.1 复核当前 branch、HEAD、工作树和三份规格状态，确认没有用户未提交修改与本功能重叠。
  - [x] 1.2 只读确认 Product Schema、ProductsModule、现有 `products_list`、创建占位页、路由权限和产品列表按钮仍符合 Design 基线。
  - [x] 1.3 只读确认开发环境 `PRODUCT` Rule、Active Version、`service_provider.supplier`、`TWD/MYR/CNY` 当前状态；只记录环境快照，不写入、不把数量编码为契约。
  - [x] 1.4 运行 Product/Numbering/Currency/Dictionary/Audit、Web 产品页、OpenAPI 和根治理的现有绿色基线。
  - [x] 1.5 核对 Gate R、Gate D 与 Gate T 已通过；任一缺失则不得进入 Task 2。
  - [x] 1.6 记录基线 SHA、命令和结果；本任务无源码变更时不创建空提交。
  - 证据（2026-08-12）：基线为 `feat/admin-product-management@0092f42`，初始 `git status --short --branch` 只有分支行且 `git diff --check` 通过；三份规格均为已确认状态，Gate R/D/T 已通过。
  - 代码快照：Product Schema 仍为既有字段；ProductsModule 仅注册 Query，Controller 仅有 `products_list`；Web 创建页仍为单按钮占位，路由精确要求 `products:create`，列表 API 仍只有 GET。
  - 开发库只读快照：`PRODUCT=ENABLED/version 3/Active Version 1`；`service_provider.supplier` 已启用且有效 Item 1；`CNY/MYR/TWD` 均启用且 `minorUnit=2`；Product 0 行；只存在已应用的产品列表 migration，本功能 migration 未应用。数量只作为本次环境证据，不是代码契约。
  - 绿色命令：Server 定向 Jest `14 suites / 147 tests`；Web 定向 Node tests `19/19`；`node --run contract:check` 通过；`node --run test:root` 为 `663/663`。只读检索曾有两次错误：zsh 不存在通配符退出码 1、猜测目录不存在令 `rg` 退出码 2，修正路径后完成核对，均无写入。
  - _Requirements: R1-R14_

- [x] 2. 以 TDD 增加 `PRODUCT_CREATED` Audit enum 与 forward migration
  - [x] 2.1 先为 Prisma Schema 和 migration 建立失败测试，精确要求新 enum value、唯一新 migration、无其他表 DDL、无 seed、无旧 migration 改写。
  - [x] 2.2 运行 RED，确认失败仅因 `PRODUCT_CREATED` 尚不存在。
  - [x] 2.3 在已确认 Gate D 范围内修改 `schema.prisma`，新增 `20260812100000_product_created_audit_event/migration.sql`。
  - [x] 2.4 用隔离 PostgreSQL 验证从当前 migration 集升级和空库全量 replay；不得应用到持久开发库。
  - [x] 2.5 运行 Prisma validate/generate、Schema 测试、Audit 相关单测、Server typecheck 和 root governance。
  - [x] 2.6 更新 Task 2 真实证据，创建提交：`feat: 增加产品创建审计事件`。
  - RED（2026-08-12）：`pnpm exec jest --runInBand src/infrastructure/database/product-create-audit-schema.spec.ts` 为 `1 suite failed / 2 tests failed`；失败精确为 Prisma enum 缺少 `PRODUCT_CREATED` 与目标 migration 目录不存在。
  - GREEN：Schema/Audit 定向 Jest `3 suites / 31 tests`；`pnpm prisma:validate`、`pnpm prisma:generate`、`pnpm typecheck`、`pnpm lint`、`git diff --check` 全部通过；根治理 `663/663`。
  - 隔离数据库：临时 PostgreSQL 16 先逐条执行旧 migration 再单独执行新 migration，并以数据库内断言确认 enum；官方 `node --run ci:server-e2e` 从空库应用 14 条 migration、二次 deploy 无待执行项、status up to date，E2E `26 suites / 147 tests`。两个临时容器均由 wrapper 清理；持久开发库未写入。
  - _Requirements: R8, R14_

- [x] 3. 以 TDD 扩展 Numbering scoped 幂等入口
  - [x] 3.1 先建立 `numbering-internal-input` 与 generator RED，覆盖 64 位小写 SHA-256 摘要校验、raw Key Hash、scoped 重放和 fingerprint 冲突。
  - [x] 3.2 用历史固定向量证明既有 `generate()` 的 v1 request fingerprint 完全不漂移，历史 issuance 仍可重放。
  - [x] 3.3 实现 `GenerateScopedNumberRequest` 与 `generateScoped()`，两个入口复用同一发号状态机、唯一竞态恢复和安全错误映射。
  - [x] 3.4 证明 scoped 入口不接收 Product Payload/User/Audit，不把 raw Key、scope digest 或底层错误写入日志/异常。
  - [x] 3.5 覆盖相同 Consumer/Key/scope 返回同一编号，相同 Key 不同 scope 返回 `NUMBERING_IDEMPOTENCY_CONFLICT`，包括并发唯一竞态。
  - [x] 3.6 运行 Numbering unit/E2E 回归、Server typecheck/lint 和 diff-check。
  - [x] 3.7 更新 Task 3 真实证据，创建提交：`feat: 增加编号作用域幂等入口`。
  - RED（2026-08-12）：两个定向 suite 因缺少 `GenerateScopedNumberRequest`、`validateGenerateScopedNumberRequest()` 和 `generateScoped()` 在 TypeScript 编译阶段失败，`0 tests` 执行；缺失边界明确。
  - GREEN：scoped input/service/persistence `3 suites / 52 tests`；完整 Numbering unit `23 suites / 315 tests`；历史 `numbering.generate.v1` 固定向量继续为 `5a7fc999...bbf4772`，既有 replay 测试全绿。
  - 隔离 E2E：首次遗漏 wrapper 的直跑因 `DATABASE_URL is required for Numbering E2E tests` 导致 10 个 case 同一前置失败；改用官方临时 PostgreSQL wrapper 后 `1 suite / 10 tests` 全绿，包含 20 个相同 scoped 并发请求只写一条 issuance/state、不同 scope 冲突。
  - 静态检查：首次 lint 因测试对对象调用 `String()` 命中 `no-base-to-string` 退出码 1；收窄为字符串断言后 `pnpm typecheck`、`pnpm lint`、`git diff --check` 全部通过，根治理 `663/663`。
  - _Requirements: R4, R8, R13-R14_

- [x] 4. 以 TDD 增加事务内 Currency Lookup
  - [x] 4.1 先为 `CurrencyLookupService.requireEnabledCodes()` 建立 RED，覆盖输入去重、code 稳定排序、`FOR SHARE`、缺失、停用和非法 `minorUnit`。
  - [x] 4.2 实现调用方事务内单 SQL 读取，返回冻结的 `{ code, minorUnit }`；Service 不创建嵌套事务。
  - [x] 4.3 错误类型只暴露稳定 reason/code，Prisma/PostgreSQL 异常统一脱敏，不携带整份输入。
  - [x] 4.4 从 CurrencyModule 只导出 Lookup，Query/Command 继续保持模块私有；不修改 Currency 表或 Catalog HTTP 契约。
  - [x] 4.5 运行 Currency 定向单测、既有管理回归、Server typecheck/lint 和 diff-check。
  - [x] 4.6 更新 Task 4 真实证据，创建提交：`feat: 增加币种有效性查询服务`。
  - RED（2026-08-12）：Lookup 与 Module 两个 suite 因 `currency-lookup.service.ts` 不存在在 TypeScript 编译阶段失败，`0 tests` 执行；implicit-any 是缺失返回类型的连带诊断。
  - GREEN：Lookup/Module/Query 定向 `3 suites / 15 tests`；Currency + Exchange Rate 完整回归 `16 suites / 87 tests`。单 SQL 使用去重后的 ASCII code 稳定序、`ORDER BY code ASC FOR SHARE`，返回数组与元素均冻结。
  - 安全/边界：缺失、停用、非法 `minorUnit`、输入与 persistence 各自使用固定 reason，错误不附加 code 集合或底层异常；Lookup 无 PrismaService/事务创建能力，CurrencyModule 仅导出 Lookup，既有 Query/Command 与 HTTP 契约保持私有/不变。
  - 静态检查：`pnpm typecheck`、`pnpm lint`、`git diff --check` 全部通过，根治理 `663/663`。
  - _Requirements: R5, R8, R13-R14_

- [x] 5. 以 TDD 建立 Product 创建 DTO、规范化与作用域指纹
  - [x] 5.1 先建立 Create DTO RED，覆盖所有必填字段、nested Money/Attribute、未知字段拒绝、状态和 nullable 的精确语义。
  - [x] 5.2 建立 normalizer RED：trim/NFC、Unicode code points、Active supplier、固定 `TWD/MYR`、采购币种格式、严格金额 grammar、26+4 边界和属性上限/顺序/重复。
  - [x] 5.3 建立 Header RED：缺失、合并重复值、非 lowercase、非 v4 和合法 canonical UUID。
  - [x] 5.4 建立 fingerprint 固定向量 RED，覆盖等价金额、NFC、actor、null、属性顺序和 Payload 变化。
  - [x] 5.5 最小实现纯函数与安全错误类型；规范化结果深复制/冻结，不持有调用方可变对象。
  - [x] 5.6 证明任何 DTO/normalizer 失败都发生在发号前，错误只含白名单字段路径，不回显输入。
  - [x] 5.7 运行 Product DTO/normalizer/fingerprint 定向测试、Server typecheck/lint 和 diff-check。
  - [x] 5.8 更新 Task 5 真实证据，创建提交：`feat: 建立产品创建输入规范`。
  - RED（2026-08-12）：DTO、normalizer、fingerprint 三个 suite 因目标模块尚不存在在 TypeScript 编译阶段失败，`0 tests` 执行；失败边界精确为三个待实现文件。
  - GREEN：三个定向 suite `3 suites / 60 tests`；固定指纹向量为 `f1a460b2...4b47112`，覆盖 actor、null、属性顺序、NFC 与等价金额。DTO 严格拒绝未知/媒体字段，Header 只接受 lowercase canonical UUID v4。
  - 安全/边界：normalizer 为纯函数，输出深复制并递归冻结；错误只返回受控字段路径和固定消息，不回显输入；本任务源码不依赖 Numbering、Prisma、Controller 或网络，因此所有输入失败在后续发号编排前完成。
  - 验证插曲：首次 GREEN 的两个失败均为测试断言写法，修正后通过；并行运行 `typecheck`/`lint` 曾因两条命令同时执行 `prisma generate` 产生生成目录竞争，改为串行后验证成功。期间 lint 报告的两处测试类型问题均已修正。
  - 静态检查：`pnpm typecheck`、`pnpm lint`、`git diff --check` 全部通过。
  - _Requirements: R2-R7, R9, R13-R14_

- [x] 6. 以 TDD 实现 Product Command 与原子审计
  - [x] 6.1 先为 persistence 与 Command 建立 RED，固定 preflight -> scoped generate -> replay/read -> Product transaction 的调用顺序。
  - [x] 6.2 实现 preflight transaction，第一条 SQL 设置 timeout，按 Supplier Type/Item -> Currency code 的稳定锁序验证有效性和 `minorUnit`。
  - [x] 6.3 调用 `generateScoped({ ruleCode: 'PRODUCT', consumerCode: 'PRODUCT.CREATE' })`；映射 Rule 不可用、容量、状态和 scope 冲突为 Product 公共错误。
  - [x] 6.4 实现 replay：既有 Product 必须与 actor/规范化 Payload 精确一致；一致返回同一 Product 且不写新 Audit，不一致返回幂等冲突。
  - [x] 6.5 实现 Product write transaction：timeout 第一条 SQL、再次校验依赖、固定媒体空值、insert Product、同事务 `PRODUCT_CREATED` Audit。
  - [x] 6.6 Audit 只包含 `productNo/status`、供应商/价格存在性和 attribute count，不含金额、属性内容、supplier value、Key、fingerprint 或请求体。
  - [x] 6.7 精确处理 `products_product_no_key` 并发竞态；事务失败后重读匹配才转幂等成功，其他持久化异常固定脱敏。
  - [x] 6.8 覆盖 Audit 失败整体回滚、编号已提交但 Product 失败保留间隙、相同 Key/Payload 恢复原编号、配置二次校验变化。
  - [x] 6.9 复用 Product 响应 mapper 与历史 supplier 解析，避免创建第二份响应协议或 N+1。
  - [x] 6.10 运行 Product Command/Mapper、Numbering/Currency/Dictionary/Audit 相关回归、Server typecheck/lint 和 diff-check。
  - [x] 6.11 更新 Task 6 真实证据，创建提交：`feat: 实现产品创建命令`。
  - RED（2026-08-12）：Persistence 与 Command 两个 suite 因目标模块不存在在 TypeScript 编译阶段失败，`0 tests` 执行；RED 精确锁定两个待实现文件。
  - GREEN：Persistence/Command 定向 `2 suites / 27 tests`；Product Command/Mapper 定向 `4 suites / 37 tests`；Product、Numbering、Currency、Dictionary、Audit 相关回归 `60 suites / 766 tests`。
  - 事务/恢复：preflight 与 Product transaction 均以 timeout 为第一条 SQL，并保持 Supplier Type/Item -> Currency 稳定锁序；发号位于独立事务。重放逐字段核对 actor、固定媒体、三组金额/币种、有序属性与 version；可信同 Key 唯一竞态才恢复，其他冲突失败关闭。Audit 被等待且响应 mapper 位于 Product transaction 内，任一失败均使业务事务拒绝，数据库最终回滚由 Task 8 隔离 E2E 再做实体计数证明。
  - 安全/契约：Audit 仅记录获准元数据；编号、字典、货币、Prisma 错误按可信类型/code/constraint 映射，未知错误固定脱敏。创建与列表共用 `PRODUCT_RESPONSE_SELECT` 和 `mapProductListItem()`；新建路径复用锁定供应商快照，历史重放只进行一次历史解析。
  - 全量修复：首次根入口先暴露 Product 新文件未进入供应商残留精确白名单，修复后 Root `663/663`；随后 Server 全量暴露 Dictionary 旧 Audit enum 总数仍为 `40`，更新为已确认的 `41` 并显式断言 `PRODUCT_CREATED`。最终 Server `152 suites / 1507 tests`，Prisma validate、typecheck、lint 全部通过。
  - 预期待办：提交前 `node --run check` 已通过 Root 与 Server，随后在 Contract 阶段以 `OpenAPI contract check failed` 停止；tracked snapshot 尚未同步已确认 enum，且 `products_create` 尚待 Task 7 实现，按 Task 9 统一执行 `contract:sync`，本任务不提前修改生成产物。
  - _Requirements: R3-R8, R13-R14_

- [x] 7. 以 TDD 暴露受保护的 Product 创建公共 API
  - [x] 7.1 先建立 Controller metadata/OpenAPI RED，精确要求 `POST /api/products`、operationId `products_create`、`products:create`、CSRF、private no-store、201 和必填 Header。
  - [x] 7.2 实现 Controller 从可信 Auth/Request ID/Header 构造 Command context，Body 只接收 Create DTO。
  - [x] 7.3 在 ProductsModule 注册已确认的依赖和 ProductCommandService；不得新增其他 Product 写 operation。
  - [x] 7.4 固定 403/409/422/500 错误矩阵和安全中文消息，证明无权/强制改密/CSRF 失败不调用 Command。
  - [x] 7.5 扩展 Product operation allowlist，只新增 `products_create`，保留 `products_list`，拒绝 detail/update/status/delete/media/generate 路由。
  - [x] 7.6 运行 Controller/Module/OpenAPI 前置测试、Server typecheck/lint/build 和 diff-check。
  - [x] 7.7 更新 Task 7 真实证据，创建提交：`feat: 添加产品创建接口`。
  - RED（2026-08-12）：Controller suite 在 TypeScript 编译阶段因第二个构造依赖和 `create` handler 不存在失败；Module suite 精确显示缺少 Auth/Currency/Numbering imports，`2 suites failed`。
  - GREEN：Controller/Module/Command 定向 `3 suites / 29 tests`；Product + App/OpenAPI 前置回归 `16 suites / 162 tests`；Server 全量 `152 suites / 1512 tests`，Prisma validate、typecheck、lint 全绿，`pnpm build` 通过。
  - 契约实测：临时生成 OpenAPI（未修改 tracked snapshot）确认 `/api/products` 只含 GET/POST，POST operationId、201/400/401/403/409/422/500、Session、CSRF/Idempotency 两个必填 Header、七个全部 required Create 字段和 private no-store 响应头均符合设计；Controller prototype 仅 `list/create`，不存在其他 Product operation。
  - 准入/安全：handler 精确声明 `products:create`，全局 Authentication/PasswordChange/Permission/CSRF Guards 的既有回归包含 403 固定错误；框架在 Guard 拒绝时不会进入 handler。Controller 在委托 Command 前同步拒绝缺失、重复合并、非小写与非 v4 Key，并只从可信 request context 构造 actor/requestId。Task 8 再通过真实 HTTP 证明四类拒绝下数据库与 Command 最终无写入。
  - Root 边界：新增 Controller 中已确认的 `PRODUCT_SUPPLIER_*` 错误码触发供应商残留精确门禁；仅加入 `products.controller.ts` 后定向 `2/2` 通过，没有扩大目录或恢复 Supplier 领域。
  - _Requirements: R1, R4, R8-R9, R13-R14_

- [x] 8. 完成 Product 创建隔离 PostgreSQL 与 API E2E
  - [x] 8.1 先建立 `product-create-api.e2e-spec.ts` RED，只在隔离测试数据库准备受控 `PRODUCT` Rule、Active Version、供应商与币种 fixture。
  - [x] 8.2 覆盖认证、`products:create`、CSRF、Header、未知字段、Active supplier、金额精度/边界和有序属性。
  - [x] 8.3 覆盖成功 201、自动编号、固定媒体、三组 Decimal/币种、actor/version/timestamp 和 `PRODUCT_CREATED` Audit metadata。
  - [x] 8.4 覆盖相同 actor/Key/Payload 重放、不同 Payload/actor 冲突、编号后 Product 失败恢复以及相同 Key 并发只落一条 Product/Audit/issuance。
  - [x] 8.5 覆盖 Rule 缺失/停用/无 Active Version/容量耗尽、Supplier/Currency 提交期间变化和安全错误脱敏。
  - [x] 8.6 证明新 migration 可全量 replay 且无 Product/业务配置 seed；测试结束可靠清理，不触碰持久开发库。
  - [x] 8.7 运行 Product 定向 E2E 和官方隔离 `node --run ci:server-e2e`；如有既有套件漂移，报告并以最新完整结果为准。
  - [x] 8.8 更新 Task 8 真实证据；只有测试变更时创建 `test: 补齐产品创建服务端验收`，若暴露生产缺陷则用独立 `fix:` 提交最小修复。
  - RED（2026-08-12）：首个 suite 先因缺少 E2E harness 在 TypeScript 编译阶段失败；夹具建立后依次暴露错误 segment 类型、固定字符含分隔符、测试库 `TWD/MYR` 默认停用及启用外币缺少汇率约束。夹具按真实 Numbering/Currency 约束修正后，首个完整 Product/Audit/issuance 闭环转绿。
  - 缺陷 RED/GREEN：26 位整数金额在数据库中正确持久化，但响应 mapper 曾返回科学计数法；新增 mapper 失败测试后，以 `toFixed(4)` 展开并安全移除尾零，定向 `2 suites / 28 tests` 转绿，独立提交 `48e290b fix: 修正产品大额金额响应格式`。
  - 隔离验收：官方 `node --run ci:server-e2e` 从空库应用 14 条 migration、二次 deploy 无待执行项、status up to date，最终 `27 suites / 160 tests` 全绿。新增 12 个 Product 创建 E2E 覆盖认证/权限/强制改密/CSRF、Header/未知字段、Active supplier、金额精度与 26 位边界、DRAFT null supplier、创建与安全 Audit、同 Key 重放/冲突、Audit 失败编号间隙恢复、同 Key 并发、Supplier/Currency 二次校验以及 Rule 缺失、DRAFT、无 Active Version 与容量耗尽。
  - 数据边界：harness 启动前断言 Product、PRODUCT Rule 与 PRODUCT_CREATED Audit 为零，证明 migration 未 seed 业务数据；供应商、外币/测试汇率、用户和 Product 均只存在于官方一次性 PostgreSQL，并在 suite 结束恢复/清理。编号 ledger/rule 随容器销毁，持久开发库未写入。
  - 伴随失败：首次扩展全量 E2E 除科学计数法外，既有 Dictionary suite 曾一次 `socket hang up`；修复后完整重跑该 suite 与全部 27 suite 均通过，未复现，因此未修改 Dictionary 生产代码。
  - 静态/治理：Server typecheck、lint、`git diff --check` 全绿；Root 供应商残留门禁只精确新增两个 Product E2E 文件后定向 `2/2` 通过。
  - _Requirements: R1-R9, R13-R14_

- [x] 9. 同步 OpenAPI 与 Web generated contract
  - [x] 9.1 先运行 `contract:check` 记录 tracked snapshot 尚缺 `products_create` 的预期 RED，不手改任何产物。
  - [x] 9.2 串行运行根 `contract:sync`，生成 Server/Web snapshot 与 Web API types。
  - [x] 9.3 核对 diff 只新增已确认的 POST、Header、Create DTO、201 响应和错误矩阵；既有 GET 不得漂移。
  - [x] 9.4 运行 `contract:check`、contract baseline、Server build 和 Web typecheck，证明两份 snapshot 字节一致。
  - [x] 9.5 更新 Task 9 真实证据，创建提交：`chore: 同步产品创建接口契约`。
  - RED（2026-08-12）：Task 7/8 完成后首次 `node --run contract:check` 以 `OpenAPI contract check failed` 退出，原因是 tracked Server/Web snapshots 尚未包含已实现的 `products_create`；检查过程只写临时目录，没有改动 tracked generated tree。
  - 生成：仅运行根 `node --run contract:sync`；两份 OpenAPI snapshot 各增加已确认的 POST、`Idempotency-Key`、Create DTO、201/错误矩阵与 `PRODUCT_CREATED` enum，既有 GET operation 保持。Server/Web snapshot 经 `cmp` 证明字节一致。Web `types.gen.ts` 按现有约定位于 `.gitignore`，由 `api:generate` 在 typecheck/build 前从 tracked Web snapshot 重建，不作为提交资产。
  - GREEN：`node --run contract:check` 通过；OpenAPI/contract baseline `180/180`；`pnpm -C server build` 与 `pnpm -C web typecheck` 全部通过，`git diff --check` 通过。
  - _Requirements: R9, R14_

- [ ] 10. 以 TDD 实现 Web Product mutation adapter 与纯状态逻辑
  - [ ] 10.1 先建立 API RED，覆盖 generated Create DTO、POST URL、`Idempotency-Key`、AbortSignal、`retry:false`、local error presentation 和 201 类型。
  - [ ] 10.2 先建立 logic RED，覆盖默认 model、stable row key、dirty、trim/NFC DTO、MoneyInput validation 结果和属性映射。
  - [ ] 10.3 建立字段错误白名单 parser RED，覆盖 nested money、`attributes.0..49`、未知/恶意路径降级和 requestId。
  - [ ] 10.4 建立页面状态机 RED，覆盖 editing/submitting/deterministic failure/unknown/success、冻结 snapshot/key、人工同请求重放和显式放弃。
  - [ ] 10.5 实现 `crypto.randomUUID()` 延迟建 Key，不把 DTO/Key 写入 Store、Storage、URL 或日志；深复制冻结 unknown snapshot。
  - [ ] 10.6 HTTP `4xx` 解锁并使下一次提交使用新 Key；network/`5xx` 保留同 Key/Payload，禁止自动重试。
  - [ ] 10.7 运行 Web Product API/logic 定向测试、typecheck、ESLint 和 diff-check。
  - [ ] 10.8 更新 Task 10 真实证据，创建提交：`feat: 建立产品创建前端状态`。
  - _Requirements: R1-R7, R9, R11-R14_

- [ ] 11. 以 TDD 实现产品表单与属性编辑器
  - [ ] 11.1 先建立 View RED，固定基础资料、状态/供应商、三组 MoneyInput、属性、媒体延期说明和操作按钮。
  - [ ] 11.2 实现 `product-attributes-editor.vue`：最多 50 项，稳定 key、增删、上移/下移、序号、边界 disabled 和可访问名称。
  - [ ] 11.3 实现 `product-create-form.vue`：真实 label/description/error 关联、动态 Active supplier required、提交锁和首个错误滚动聚焦。
  - [ ] 11.4 `TWD/MYR` 传单一当前有效 descriptor，采购成本传有效货币集合；切币种不得修改 amount。
  - [ ] 11.5 Catalog loading/error/empty、金额错误和 Attribute 错误都用文字呈现，不只依赖颜色或图标。
  - [ ] 11.6 实现桌面 8/4 grid、窄屏单列、44px 移动触控、light/dark Token、Noto 字体和 Reduced Motion 边界。
  - [ ] 11.7 不修改公共组件，不增加媒体 URL/上传控件或装饰性新依赖。
  - [ ] 11.8 运行表单/属性 View 测试、Web typecheck、ESLint、Stylelint、build 和 diff-check。
  - [ ] 11.9 更新 Task 11 真实证据，创建提交：`feat: 实现产品创建表单`。
  - _Requirements: R2-R7, R10-R11, R14_

- [ ] 12. 以 TDD 完成创建页面编排、权限与导航
  - [ ] 12.1 先建立页面 RED，覆盖 `FaPageHeader + FaPageMain`、Catalog 状态、API 调用、提交锁、错误摘要和成功分支。
  - [ ] 12.2 把产品列表“新增产品”从 Toast 改为 `adminProductCreate` 导航；查看/编辑轻提示保持不变。
  - [ ] 12.3 实现 Supplier/Currency Catalog 提交门禁：DRAFT/INACTIVE supplier null 可降级，ACTIVE 或已选 supplier 必须可信；Currency 失败始终阻止提交并保留草稿。
  - [ ] 12.4 实现 requestVersion/authEpoch/permission/Abort 竞态守卫，身份域变化清除草稿与幂等上下文，迟到响应不能更新新身份。
  - [ ] 12.5 实现 success：有 `products:read` Toast 后返回列表；create-only 显示产品编号与“继续新增”。
  - [ ] 12.6 实现 unknown-result：冻结表单、相同 Key/Payload 人工确认和明确放弃。
  - [ ] 12.7 使用同级 `QsGenericModal` 实现页面取消/路由离开确认；刷新关闭用 `beforeunload`，成功/放弃后不再提示。
  - [ ] 12.8 覆盖键盘操作、焦点恢复、busy/alert 语义、窄屏无横向滚动和权限按钮可见性。
  - [ ] 12.9 运行产品页面/路由/API 定向测试、完整 Web `test:api`、typecheck、lint、build 和 diff-check。
  - [ ] 12.10 更新 Task 12 真实证据，创建提交：`feat: 完成产品创建页面流程`。
  - _Requirements: R1, R3-R7, R10-R14_

- [ ] 13. 扩展现有管理 Browser 真实验收
  - [ ] 13.1 先扩展 `management.browser.test.mjs` 建立 Chrome RED，不新建 Product 专属 CI Job。
  - [ ] 13.2 在 `provision-admin.mjs` 仅为隔离 Browser 数据库准备有效 `PRODUCT` Rule/Version/Segment、供应商和币种前置；不得修改生产 seed 或持久数据库。
  - [ ] 13.3 覆盖列表入口导航、默认 DRAFT、Active supplier、三组金额、币种切换不换算、属性增删排序和媒体延期说明。
  - [ ] 13.4 提交真实 Product，核对成功 Toast/产品编号/列表搜索、数据库 Product/Audit/issuance 最终态。
  - [ ] 13.5 覆盖同步重复点击锁、Server 字段错误、Catalog retry、未保存离开确认和 unknown-result 人工重放；网络故障必须通过受控请求拦截产生。
  - [ ] 13.6 覆盖 1440x900 Desktop、390x844 Mobile、light/dark、Reduced Motion、44px targets、键盘和无页面级横向溢出。
  - [ ] 13.7 运行根 `node --run ci:browser-auth-e2e`，确保容器、Chrome 和临时状态由现有 runner 回收。
  - [ ] 13.8 更新 Task 13 真实证据；纯验收创建 `test: 补齐产品创建浏览器验收`，若暴露缺陷使用独立 `fix:` 提交。
  - _Requirements: R1-R14_

- [ ] 14. 完成全量验证、规格状态与 Git 收口
  - [ ] 14.1 冻结生产/测试源码，汇总 Task 2-13 的真实 RED/GREEN、提交 SHA、失败与非阻断警告；不得预写结果。
  - [ ] 14.2 串行执行第 5 节完整矩阵，确认 Schema、Server unit/E2E、OpenAPI、Web API/View、Browser、build、root governance 和 diff-check 全绿。
  - [ ] 14.3 复核最终文件矩阵：无禁止路径、删除、旧 migration 改写、额外 Schema、依赖/lockfile、持久数据、Supplier 领域复活、未授权 Product operation 或敏感文件。
  - [ ] 14.4 明确记录 Gate DB 状态；未获独立授权时，新 migration 只能存在于代码并已在隔离 PostgreSQL 验证，不得部署到持久开发库。
  - [ ] 14.5 将 Requirements、Design、Tasks 更新为实际完成状态和真实提交证据；文档收口后不再修改生产/测试源码。
  - [ ] 14.6 暂存精确文件并核对 secrets/staged diff，创建提交：`docs: 完成产品创建实施验收`。
  - [ ] 14.7 核对 `git status --short --branch`、相对基线提交序列和每个提交范围，向用户交付本地结果后暂停。
  - [ ] 14.8 不执行 push、PR、merge、deploy、持久数据库 migration 或分支清理。
  - _Requirements: R1-R14_

## 5. 验证矩阵

### 5.1 Phase 3 文档验证

```bash
node --run test:root
git diff --check
git status --short --branch
```

### 5.2 Phase 4 任务级验证

实际文件建立后使用下列定向入口；每次 RED/GREEN 都在对应 Task 证据中记录：

```bash
# Server unit（按任务选择精确 spec；命令必须串行）
pnpm -C server test --runInBand \
  src/modules/numbering/numbering-internal-input.spec.ts \
  src/modules/numbering/numbering-generator.service.spec.ts

pnpm -C server test --runInBand \
  src/modules/currencies/currency-lookup.service.spec.ts \
  src/modules/products/dto/product-dtos.spec.ts \
  src/modules/products/product-command.normalizer.spec.ts \
  src/modules/products/product-create-fingerprint.spec.ts \
  src/modules/products/product-command.persistence.spec.ts \
  src/modules/products/product-command.service.spec.ts \
  src/modules/products/products.controller.spec.ts \
  src/modules/products/products.module.spec.ts

# Server isolated E2E
pnpm -C server test:e2e product-create-api.e2e-spec.ts
node --run ci:server-e2e

# Web unit/view
pnpm -C web exec tsx --test \
  apps/qsmds-arco/test/api/products.test.ts \
  apps/qsmds-arco/test/views/product-create.logic.test.ts \
  apps/qsmds-arco/test/views/product-create-page.test.ts

# Browser
node --run ci:browser-auth-e2e
```

若 Jest/tsx 的过滤参数与当前 runner 不兼容，必须先核对 package script 后使用项目真实支持的精确入口，不能用“0 tests”冒充通过。若 `tsx --test` 在受限 shell 出现 `listen EPERM ...*.pipe`，改用项目已验证的 `node --import tsx --test` 或在允许 IPC 的环境重跑，并报告环境错误。

### 5.3 Phase 4 最终验证

```bash
# 串行执行，避免 Prisma/generated 竞态
pnpm -C server prisma:validate
pnpm -C server typecheck
pnpm -C server lint
pnpm -C server test --runInBand
node --run ci:server-e2e

node --run contract:sync
node --run contract:check

pnpm -C web test:api
pnpm -C web typecheck
pnpm -C web lint
pnpm -C web build
node --run ci:browser-auth-e2e

node --run test:root
node --run check
node --run build
git diff --check
git status --short --branch
```

`contract:sync` 只在 Task 9 和最终复核受控运行。`ci:contract` 依赖真实 GitHub event context，本地不伪造 event；其 baseline 逻辑由根测试覆盖。

## 6. 精确文件边界

### 6.1 计划新增

```text
server/prisma/migrations/20260812100000_product_created_audit_event/migration.sql
server/src/infrastructure/database/product-create-schema.spec.ts
server/src/modules/currencies/currency-lookup.service.ts
server/src/modules/currencies/currency-lookup.service.spec.ts
server/src/modules/products/dto/product-create.dto.ts
server/src/modules/products/product-command.normalizer.ts
server/src/modules/products/product-command.normalizer.spec.ts
server/src/modules/products/product-create-fingerprint.ts
server/src/modules/products/product-create-fingerprint.spec.ts
server/src/modules/products/product-command.persistence.ts
server/src/modules/products/product-command.persistence.spec.ts
server/src/modules/products/product-command.service.ts
server/src/modules/products/product-command.service.spec.ts
server/src/modules/products/product.errors.ts
server/src/modules/products/product.persistence-error.mapper.ts
server/src/modules/products/product.persistence-error.mapper.spec.ts
server/test/product-create-api.e2e-spec.ts

web/apps/qsmds-arco/src/views/admin/product-management/create/product-create.logic.ts
web/apps/qsmds-arco/src/views/admin/product-management/create/product-create-form.vue
web/apps/qsmds-arco/src/views/admin/product-management/create/product-attributes-editor.vue
web/apps/qsmds-arco/test/views/product-create.logic.test.ts
web/apps/qsmds-arco/test/views/product-create-page.test.ts
```

测试过程中若证明某个拆分文件没有独立职责，可在不扩大行为范围的前提下合并；不得为满足文件清单制造空壳抽象。

### 6.2 计划修改

```text
server/prisma/schema.prisma
server/src/modules/audit/**                         # enum 回归或查询测试，非新 writer
server/src/modules/currencies/currency.module.ts
server/src/modules/numbering/numbering-internal-input.ts
server/src/modules/numbering/numbering-generator.service.ts
server/src/modules/numbering/*spec.ts
server/src/modules/products/dto/product-dtos.spec.ts
server/src/modules/products/product-query.mapper.ts  # 只允许复用/扩展 mapper
server/src/modules/products/product-query.mapper.spec.ts
server/src/modules/products/products.controller.ts
server/src/modules/products/products.controller.spec.ts
server/src/modules/products/products.module.ts
server/src/modules/products/products.module.spec.ts
server/openapi/openapi.json                          # generated only

web/openapi/openapi.json                             # generated only
web/apps/qsmds-arco/src/api/generated/**             # generated only
web/apps/qsmds-arco/src/api/modules/products.ts
web/apps/qsmds-arco/test/api/products.test.ts
web/apps/qsmds-arco/src/views/admin/product-management/create/index.vue
web/apps/qsmds-arco/src/views/admin/product-management/list/index.vue
web/apps/qsmds-arco/test/api/product-management-routes.test.ts
web/apps/qsmds-arco/test/browser/management.browser.test.mjs
scripts/browser-auth/provision-admin.mjs
scripts/browser-auth-runtime.test.mjs
scripts/root-governance.test.mjs

specs/product-create/requirements.md
specs/product-create/design.md
specs/product-create/tasks.md
```

### 6.3 禁止修改或删除

```text
existing prisma migrations
server/src/modules/suppliers/**
web/apps/qsmds-arco/src/api/modules/suppliers.ts
web/apps/qsmds-arco/src/components/base/MoneyInput/**
web/apps/qsmds-arco/src/components/business/QsDictionarySelect/**
web/apps/qsmds-arco/src/components/business/QsGenericModal/**
web/apps/qsmds-arco/src/components/business/QsGenericTable/**
web/apps/qsmds-arco/src/router/modules/product.management.ts
package.json / lockfiles
.env files
```

若实现证明必须越过上述边界、修改 Product/Numbering/Currency/Dictionary 表、增加依赖或增加其他公共 Product operation，立即暂停，回到 Requirements/Design 并重新取得明确确认。

## 7. 建议提交序列

1. `feat: 增加产品创建审计事件`
2. `feat: 增加编号作用域幂等入口`
3. `feat: 增加币种有效性查询服务`
4. `feat: 建立产品创建输入规范`
5. `feat: 实现产品创建命令`
6. `feat: 添加产品创建接口`
7. `test: 补齐产品创建服务端验收`
8. `chore: 同步产品创建接口契约`
9. `feat: 建立产品创建前端状态`
10. `feat: 实现产品创建表单`
11. `feat: 完成产品创建页面流程`
12. `test: 补齐产品创建浏览器验收`
13. `docs: 完成产品创建实施验收`

只有对应任务全部绿色后才提交。若任务没有独立变更，不创建空提交；若测试暴露生产缺陷，用职责明确的 `fix:` 小步提交，不把修复藏入 `test:` 或 `docs:`。

## 8. Phase 3 确认门

确认 Gate T 表示：

1. 接受 Task 1-14 的顺序、TDD 证据、隔离数据库、真实 Browser、生成产物和最终矩阵作为完成条件。
2. 授权进入 Phase 4，并在 Gate R/D 已确认的精确范围内实施公共 `POST /api/products`、Create DTO/Header、内部 Numbering scoped 数据结构、`PRODUCT_CREATED` Prisma enum/migration、OpenAPI/generated types 和正式创建页面。
3. 允许在不改变职责和行为边界的前提下合并相邻绿色任务或减少没有独立价值的文件，不允许扩大功能。
4. 不授权把 migration 应用到持久开发数据库，不授权 push、PR、merge、deploy、删除或任何外部发布动作。

请用户明确确认 Gate T 后，才把本文件状态改为已确认、提交 Phase 3 文档并开始 Task 1。
