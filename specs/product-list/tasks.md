# 产品列表实施任务

## 1. 文档状态

- 状态：Phase 4 实施中（Task 1 已完成）
- Requirements 确认日期：2026-08-12
- Design 确认日期：2026-08-12
- 编写日期：2026-08-12
- 实施分支：`feat/admin-product-management`
- Phase 3 基线 SHA：`0b93d76f6fdb`
- Requirements：`specs/product-list/requirements.md`
- Design：`specs/product-list/design.md`

本计划把产品列表拆为 12 个可独立验证、保持绿色并形成小步提交的任务。当前只完成任务拆分；本文件经用户确认且高风险实施门禁获得单独授权前，不得开始 Phase 4。

## 2. 执行纪律

每个功能任务遵循同一 TDD 闭环：

```text
确认任务文件边界和前置门禁
-> 写因目标能力缺失而失败的测试
-> 运行并记录预期 RED 原因
-> 最小实现
-> 重构和补齐异常路径
-> 运行任务级 GREEN 验证
-> 更新 tasks.md 状态与真实证据
-> 检查 staged diff / secrets / generated 边界
-> 创建绿色小步提交
```

执行规则：

1. 不提交永久红测、无法独立 typecheck 或无法构建的状态；RED 只作为实施过程证据。
2. 命令失败必须记录真实命令、退出码和原因，未转绿前不得勾选对应任务。
3. 只使用 `apply_patch` 编辑源文件；生成产物必须由项目脚本生成。
4. 不手工编辑 `server/openapi/openapi.json`、`web/openapi/openapi.json` 或 `web/apps/qsmds-arco/src/api/generated/**`。
5. 不修改既有 migration，不 seed Product，不修改 `PRODUCT` Rule、Currency Catalog 或 `service_provider.supplier` 字典数据。
6. 不恢复 Supplier Model、API、Store、路由、权限、编号规则或专用选择器；Product 只保存稳定 `supplierValue`。
7. 不修改公共 `QsGenericTable`、`ImageGroup`、`AmountDisplay` 或 `QsDictionarySelect`；领域映射留在产品页面和 slots。
8. 不实现创建、详情、编辑、状态变更或删除 API/页面，不新增 `products:update` 等写权限。
9. 不新增依赖，不在仓库根创建 pnpm 依赖资产，不跨 `server/` 与 `web/` 引用源码。
10. 每次提交前运行与范围匹配的测试、`git diff --check`，并核对暂存文件、`.env`、密钥、日志、构建产物和根依赖违规产物。
11. Commit Message 类型使用英文、描述使用中文；不使用 amend、rebase、force push 或历史重写。
12. 未经后续明确授权，不执行本地持久数据库 migration、push、PR、merge、部署、分支删除或 worktree 清理。

## 3. 阶段与高风险门禁

### Gate A - Requirements

- [x] 产品数据口径、状态、供应商、金额、媒体、属性、列表、权限、响应式和验收标准已确认。
- [x] 本期只读边界与新增/查看/编辑 Toast 占位语义已确认。

### Gate B - Design

- [x] Product 扁平表、媒体数组、属性 JSONB、金额/币种列和审计字段方向已确认。
- [x] `supplierValue` 写时校验、读时批量历史解析与无 Supplier FK 方向已确认。
- [x] `GET /api/products`、OpenAPI、Web 页面组合与既有 Browser Job 方向已确认。

### Gate C - Phase 3 任务清单

- [x] 用户已于 2026-08-12 确认本任务顺序、文件边界、验证矩阵和提交边界。
- [x] Gate C 确认只允许申请进入 Phase 4，不自动授权下列高风险变更。

### Gate D1 - 数据结构、Schema、migration 与公共 API 实施授权

- [x] 用户已于 2026-08-12 单独授权修改 `server/prisma/schema.prisma`、新增 Product migration、建立 Product 公共 DTO 和 `GET /api/products`。
- [x] 授权范围只包括已确认 Design，不得顺手增加写 API、权限、搜索、状态筛选、排序参数或额外 Product 领域模型。

### Gate D2 - 本地持久数据库变更授权

- [ ] 在对本地开发数据库执行 `prisma migrate deploy/dev` 或任何 Product DDL 前，展示待应用 migration、目标数据库的非敏感身份、当前 migration 状态和只读影响检查，并再次取得明确确认。
- [ ] 隔离 CI/Test PostgreSQL 的可丢弃式 migration replay 属自动化测试范围；不得把测试成功解释为已授权修改本地持久数据库。

### Gate E - 外部发布授权

- [ ] 本地完成后暂停；push、PR、merge、部署和非本地数据库 migration 均需新的明确授权。

## 4. 实施任务

- [x] 1. 建立 Phase 4 绿色基线并复核可变真相源
  - [x] 1.1 复核当前分支、HEAD、工作树和三份规格状态，确认没有用户未提交改动与任务范围重叠。
  - [x] 1.2 只读确认当前 Prisma Schema、Product 模块、OpenAPI operation 和 Web 正式页面仍未被其他提交新增；若事实漂移，停止并更新 Design/Tasks 后重新确认。
  - [x] 1.3 只读确认 `PRODUCT` Rule 与 `service_provider.supplier` Type/Items 的当前状态；只记录环境快照，不写入、不 seed、不把当前数量编码为契约。
  - [x] 1.4 运行 Schema、Server、Web、OpenAPI 和根治理相关的现有绿色基线；真实记录任何既有失败，避免把基线缺陷归因于 Product。
  - [x] 1.5 核对 Gate C 与 Gate D1 已明确通过；任一未通过则不得进入 Task 2。
  - _Requirements: R1, R3, R4, R15_

  Task 1 证据：当前 HEAD `a7be399`、工作树无既有改动，Product Schema、模块、operation 与正式页面均不存在；本地只读快照中 `PRODUCT` Rule 为 `ENABLED`/version 3，`service_provider.supplier` Type 启用/version 3，1 个 Item 且启用。`prisma:validate`、`contract:check`、Server 定向 10/10、Server/Web typecheck、Web 产品路由 4/4 与 Root governance 663/663 全部通过；未执行数据库写入或 migration。

- [x] 2. 以 TDD 建立 Product Schema 与 forward migration
  - [x] 2.1 先新增失败的 Schema/migration 合约测试，覆盖 `ProductStatus`、UUID、唯一不可变 `productNo`、nullable `supplierValue`、有序媒体、JSONB 属性、三组金额/币种、审计字段、索引和命名约束。
  - [x] 2.2 运行 RED，确认失败原因仅为 Product 结构尚不存在；不得以放宽断言或 allowlist 方式制造通过。
  - [x] 2.3 在 Gate D1 已授权范围内修改 Prisma Schema，新增唯一 forward migration；不得修改任何既有 migration。
  - [x] 2.4 建立非空、状态、`ACTIVE` 供应商非空、固定 `TWD/MYR`、采购币种三位大写、金额非负、attributes array 和正 version 等数据库约束。
  - [x] 2.5 通过精确 trigger 保证 `id` 与 `productNo` 更新失败；trigger 不查询字典、不执行业务状态流。
  - [x] 2.6 在隔离 PostgreSQL 中验证空库全量 replay 与当前 migration 集升级，验证约束、索引、回滚隔离和无数据 seed。
  - [x] 2.7 更新 Task 2 状态并在目标测试、Prisma validate、Server typecheck 与 diff-check 绿色后创建提交：`feat: 建立产品列表数据结构`。
  - _Requirements: R1-R7, R15_

  Task 2 证据：Schema RED 为 4/4 失败，原因精确为缺少 `Product` Model 与新 migration。最小实现后 Schema/migration 合约 4/4、Prisma validate、Server typecheck、Root governance 663/663 与 diff-check 通过。隔离 PostgreSQL 16 首次按顺序应用 13 条 migration，第二次 deploy 无待应用项，status 为 up to date；migration 未 seed Product、编号规则或字典数据，未应用到本地持久数据库。Root 首轮因数据库迁移规范缺少新基线而 662/663，补齐真实第 13 条历史后恢复全绿。

- [x] 3. 以 TDD 增加通用字典批量历史解析
  - [x] 3.1 先为 `DictionaryLookupService.resolveStoredValues()` 建立失败测试，覆盖空输入、null、去重、顺序、同 Label 不同 value、Type disabled、Item disabled 与 unknown。
  - [x] 3.2 运行 RED，确认现有单值 resolver 无法满足一页 Product 的无 N+1 批量契约。
  - [x] 3.3 提取业务中立的纯映射内核，以一次 Type/Item 查询解析去重后的 raw values，并让单值与批量入口复用同一状态语义。
  - [x] 3.4 返回 `EFFECTIVE/DISABLED/UNKNOWN`、raw value 和已知 Label；不得创建 Product/Supplier 专用字典服务，也不得吞掉未知值。
  - [x] 3.5 证明一页重复 `supplierValue` 不会产生逐行查询，异常信息不泄露 SQL 或不可信内容。
  - [x] 3.6 更新 Task 3 状态并在字典服务定向测试与 Server 检查绿色后创建提交：`feat: 增加字典值批量历史解析`。
  - _Requirements: R3, R8, R12, R15_

  Task 3 证据：RED 在 TypeScript 编译期精确报告 `resolveStoredValues` 与 `values` 校验字段不存在。最小实现使用一次 `findMany` 查询去重后的精确 raw values，以 Map 恢复输入顺序和重复项，并与单值入口复用同一映射函数。最终字典 Lookup 22/22、Server typecheck、目标 ESLint 与 diff-check 通过；lint 曾发现并阻断 `any[]` unsafe return，改为逐项收敛到 `string[]` 后转绿。

- [x] 4. 以 TDD 实现 Product 列表查询内核
  - [x] 4.1 先为 Query DTO、mapper 和 Query Service 建立失败测试，覆盖 `page/pageSize/supplierValue`、空白/超长输入、精确 raw 筛选、稳定排序与 count/items 共用 where。
  - [x] 4.2 先固定响应映射：Decimal 只输出 `string | null`，媒体/属性保持顺序，actor 只选择 `id/displayName`，非法 attributes fail-closed。
  - [x] 4.3 实现 `updatedAt DESC, id DESC` 稳定分页和单次批量供应商解析；不得加入未确认的搜索、状态筛选或自定义排序。
  - [x] 4.4 对空结果返回 `items=[]`、`total=0`；对 nullable actor/supplier/money/media 提供确认过的稳定 shape。
  - [x] 4.5 证明列表、筛选和 mapper 不调用 `NumberingGeneratorService`，不创建 Product，不写 AuditEvent。
  - [x] 4.6 更新 Task 4 状态并在 Product 模块定向单元测试、typecheck、lint 与 diff-check 绿色后创建提交：`feat: 实现产品列表查询内核`。
  - _Requirements: R1-R8, R15_

  Task 4 证据：三个测试文件最初因 normalizer、mapper、service 缺失而 RED；两处测试类型噪声随生产类型同步收敛。实现后 Product 定向 23/23、Server typecheck、目标 ESLint、Root governance 663/663 与 diff-check 通过。Service 在同一受限事务内串行 count/findMany，共用精确 where 与稳定排序，只选择 actor `id/displayName`；页面供应商值去重后调用一次 batch resolver，Decimal 仅 `toString()`，非法 attributes 与底层异常统一脱敏为固定 500。首次 lint 发现 11 处测试 mock `any`/无必要 async，明确类型后转绿。

- [ ] 5. 以 TDD 暴露受保护的 Product 列表公共 API
  - [ ] 5.1 在 Gate D1 已授权范围内，先建立 Controller metadata 与 OpenAPI RED，精确要求 `GET /api/products`、operationId `products_list`、`products:read`、private no-store、分页 DTO 和 403/422 错误。
  - [ ] 5.2 注册 `ProductsModule`，实现只读 Controller 和白名单响应 DTO；不得添加 POST、detail、update、status 或 delete 路由。
  - [ ] 5.3 复用 Session、PasswordChangeRequired、Permission Guard 和既有异常映射；未授权请求不得查询或返回 Product 数据。
  - [ ] 5.4 扩展契约门禁，使 Product operation allowlist 只接受 `products_list`，并证明未生成写 operation。
  - [ ] 5.5 更新 Task 5 状态并在 Controller/metadata/OpenAPI 生成前置测试绿色后创建提交：`feat: 添加产品列表查询接口`。
  - _Requirements: R1, R8, R15_

- [ ] 6. 完成 Product 数据库与 HTTP E2E
  - [ ] 6.1 先建立失败的隔离数据库/API E2E，测试 fixture 只在测试数据库直接插入受控 Product，不新增生产 seed 或创建 API。
  - [ ] 6.2 覆盖权限拒绝、password-change-required、分页、稳定排序、精确供应商筛选、空结果、停用/未知历史值和三组 Decimal string/null。
  - [ ] 6.3 覆盖 Product 约束：状态、金额、币种、attributes、`ACTIVE` supplier 非空、`id/productNo` 不可更新和唯一编号。
  - [ ] 6.4 使用查询观测或 mock 边界证明供应商批量解析无逐行 N+1，actor 响应没有越权字段。
  - [ ] 6.5 运行隔离 PostgreSQL migration replay 和 Server E2E；不得在本任务中对本地持久数据库执行 migration。
  - [ ] 6.6 更新 Task 6 状态；若只有测试变更则创建提交：`test: 补齐产品列表服务端验收`，若暴露生产缺陷则以对应 `fix:` 提交最小修复与回归测试。
  - _Requirements: R1-R8, R15_

- [ ] 7. 同步 OpenAPI 与 Web generated contract
  - [ ] 7.1 先运行 `contract:check` 记录 Product operation 尚未同步的 RED，不手工修改任何 snapshot 或 generated type。
  - [ ] 7.2 运行根 `contract:sync`，生成 Server/Web OpenAPI snapshot 和 Web API types；核对 diff 只包含已确认的 Product list 契约。
  - [ ] 7.3 运行 `contract:check`、contract baseline 测试、Server build 和 Web generated typecheck，确认两份 snapshot 字节一致且无写 API。
  - [ ] 7.4 更新 Task 7 状态并将生成产物与对应门禁测试纳入 Product API 提交；若 Task 5 已提交源契约，则创建独立提交：`chore: 同步产品列表接口契约`。
  - _Requirements: R8, R15_

- [ ] 8. 以 TDD 实现 Web Product API adapter 与纯逻辑
  - [ ] 8.1 先建立 API/logic RED，覆盖 generated DTO adapter、query 编码、AbortSignal、分页、筛选应用/清空回第一页和不 trim `supplierValue`。
  - [ ] 8.2 建立 Product 页面只读 view model，严格保留 decimal string、媒体/属性顺序、supplier raw/label/state 与 actor nullable 状态。
  - [ ] 8.3 从 Dictionary Catalog 构建供应商筛选选项，包含已停用已知项，Label 用于展示、stable value 用于查询；Catalog 失败不阻断 Product 请求。
  - [ ] 8.4 建立主图单项与 images 整组的 `ImageGroup` 输入映射，过滤空 URL 但不重排有效媒体。
  - [ ] 8.5 覆盖 requestVersion、authEpoch、permission 和 Abort 竞态，迟到响应不得覆盖新身份或新筛选结果。
  - [ ] 8.6 不创建 Product Pinia Store，不复制 generated DTO，不实现任何 mutation adapter。
  - [ ] 8.7 更新 Task 8 状态并在 Web API/logic 定向测试、typecheck 与 lint 绿色后创建提交：`feat: 建立产品列表前端数据适配`。
  - _Requirements: R3, R5-R6, R8-R9, R12, R15_

- [ ] 9. 以 TDD 实现页面结构、查询状态与表格列
  - [ ] 9.1 先建立 View RED，固定 `FaPageHeader + FaPageMain + QsGenericTable`、权限、加载/错误/重试/空态、供应商 Catalog 独立状态和单次最终请求。
  - [ ] 9.2 实现确认顺序的全部业务/审计列，不展示 `id/version`；行号最左，`productNo` 默认 left-fixed，actions right-fixed 且不可隐藏。
  - [ ] 9.3 让业务列复用 QsGenericTable 的显隐、左右固定与对齐配置；关闭表格内 create/search，不修改共享表格内核。
  - [ ] 9.4 页头新增按钮只在 `products:create` 权限下展示；页面数据请求只在 `products:read` 可信时执行。
  - [ ] 9.5 供应商筛选使用 QsGenericTable filter definition；Catalog loading/error/retry 与 Product list loading/error 分离，已有 raw 条件始终可清除。
  - [ ] 9.6 覆盖 768px 桌面/窄屏切换、表格区域滚动、固定列边界、无页面级横向溢出和移动卡片字段/操作一致性。
  - [ ] 9.7 更新 Task 9 状态并在页面定向测试、typecheck、lint 与 build 绿色后创建提交：`feat: 实现产品列表页面骨架`。
  - _Requirements: R9-R10, R12, R14-R15_

- [ ] 10. 以 TDD 完成特殊单元格、只读弹窗与占位动作
  - [ ] 10.1 先建立 View RED，覆盖状态 `FaTag` 文字语义、供应商历史标识、主图/图片 `ImageGroup`、三列 `AmountDisplay`、日期和 actor 空态。
  - [ ] 10.2 主图使用单项 `ImageGroup`，附加图片使用 `maxCount=3` 并保持整组预览；不得修改 ImageGroup 或把业务字段下沉到共享组件。
  - [ ] 10.3 属性空值显示 `—`，非空显示可聚焦“`N 项属性`”按钮；使用局部 `QsGenericModal` 完整只读展示有序属性。
  - [ ] 10.4 视频空值显示 `—`，非空显示图标和“`N 个视频`”按钮；弹窗提供地址选择、单一预览、加载失败安全外链，并在关闭时停止播放。
  - [ ] 10.5 新增、查看、编辑分别调用确认文案的 `QsToast.info`；证明不导航、不发 API、不发号、不写数据。
  - [ ] 10.6 覆盖 Escape、关闭按钮、焦点约束/恢复、44px 触控目标、light/dark、键盘和 Reduced Motion。
  - [ ] 10.7 更新 Task 10 状态并在页面/组件定向测试和 Web 检查绿色后创建提交：`feat: 完善产品列表特殊字段展示`。
  - _Requirements: R5-R6, R9-R11, R13-R15_

- [ ] 11. 扩展现有管理 Browser 回归
  - [ ] 11.1 先扩展 `management.browser.test.mjs` 建立真实 Chrome RED；不新建 Product 专属 CI Job。
  - [ ] 11.2 在隔离测试数据库准备有效、停用、未知供应商、空金额、多图、属性和视频 Product fixture；测试结束必须可靠清理。
  - [ ] 11.3 覆盖 `products:read/products:create` 权限、供应商筛选应用/清空、分页归一、列设置、左右固定列和占位 Toast。
  - [ ] 11.4 覆盖主图、多图 `+N`/整组预览、金额格式/回退、属性弹窗、视频弹窗、安全链接和键盘关闭。
  - [ ] 11.5 覆盖 1440px Desktop、390x844 Mobile、light/dark、Reduced Motion、触控目标和无页面级横向溢出。
  - [ ] 11.6 运行现有 `test:browser:auth` 与对应根 CI 编排；若 Browser 暴露生产缺陷，以 `fix:` 提交最小生产修复和回归测试。
  - [ ] 11.7 更新 Task 11 状态并在 Browser 与相关 helper 测试绿色后创建提交：`test: 补齐产品列表浏览器验收`。
  - _Requirements: R9-R15_

- [ ] 12. 完成全量验证、文档与 Git 收口
  - [ ] 12.1 冻结生产和测试源码，汇总 Tasks 2-11 的真实 RED/GREEN、提交 SHA、失败与非阻断警告；不得预写未运行结果。
  - [ ] 12.2 运行第 5 节完整矩阵，确认 Schema、Server、API E2E、OpenAPI、Web API/View、Browser、build、root governance 和 diff-check 全绿。
  - [ ] 12.3 复核最终文件矩阵：无禁止路径、删除、旧 migration 修改、依赖变化、Product seed、Supplier 领域复活、写 API/权限或敏感文件。
  - [ ] 12.4 若获 Gate D2 授权，按展示过的 migration 对本地持久数据库执行一次受控 deploy，并核对 migration 行、Product 结构、约束与未被修改的基础数据；未获授权则明确记录“未应用”。
  - [ ] 12.5 将 Requirements、Design 和本计划更新为实际完成状态，只记录最新输出；文档收口后不得再修改生产/测试源码。
  - [ ] 12.6 暂存精确文件，核对 staged diff 与 secrets，创建提交：`docs: 完成产品列表实施验收`。
  - [ ] 12.7 核对 `git status --short --branch`、相对基线的提交序列和每个提交范围，向用户交付本地结果后暂停，不 push、不建 PR。
  - _Requirements: R1-R15_

## 5. 验证矩阵

### 5.1 Phase 3 文档验证

```bash
node --run test:root
git diff --check
git status --short --branch
```

### 5.2 Phase 4 任务级与最终验证

```bash
# Schema / Server
pnpm -C server prisma:validate
pnpm -C server typecheck
pnpm -C server lint
pnpm -C server test -- --runInBand
node --run ci:server-e2e

# OpenAPI
node --run contract:sync
node --run contract:check
node --run ci:contract

# Web
pnpm -C web test:api
pnpm -C web typecheck
pnpm -C web lint
pnpm -C web build
pnpm -C web test:browser:auth

# Repository
node --run test:root
node --run check
node --run build
git diff --check
git status --short --branch
```

定向 RED/GREEN 命令应在实施时写入对应任务证据，最终矩阵不能替代任务级失败测试。若 `tsx --test` 在受限 shell 出现 `listen EPERM ...*.pipe`，使用项目已验证的 `node --import tsx --test` 入口或在允许 IPC 的环境重跑，并如实报告环境错误。

## 6. 精确文件边界

### 6.1 计划新增

```text
server/prisma/migrations/<timestamp>_product_list_schema/migration.sql
server/src/modules/products/**
server/test/product-list-api.e2e-spec.ts
server/src/infrastructure/database/product-list-schema.spec.ts

web/apps/qsmds-arco/src/api/modules/products.ts
web/apps/qsmds-arco/src/views/admin/product-management/list/product-list.logic.ts
web/apps/qsmds-arco/src/views/admin/product-management/list/product-attributes-modal.vue
web/apps/qsmds-arco/src/views/admin/product-management/list/product-videos-modal.vue
web/apps/qsmds-arco/test/api/products.test.ts
web/apps/qsmds-arco/test/views/product-list.test.ts
web/apps/qsmds-arco/test/views/product-list.logic.test.ts
```

### 6.2 计划修改

```text
server/prisma/schema.prisma
server/src/http.modules.ts
server/src/modules/dictionaries/dictionary-lookup.service.ts
server/src/modules/dictionaries/dictionary-lookup.service.spec.ts
server/openapi/openapi.json                       # generated only

web/openapi/openapi.json                          # generated only
web/apps/qsmds-arco/src/api/generated/**          # generated only
web/apps/qsmds-arco/src/views/admin/product-management/list/index.vue
web/apps/qsmds-arco/test/api/product-management-routes.test.ts
web/apps/qsmds-arco/test/browser/management.browser.test.mjs
scripts/ci-contract-baseline.mjs
scripts/ci-contract-baseline.test.mjs
docs/后端文档/数据库迁移规范.md

specs/product-list/requirements.md
specs/product-list/design.md
specs/product-list/tasks.md
```

测试文件可按当前模块命名收敛，但职责与范围不得改变；任何新增生产文件应先补入本矩阵。

### 6.3 禁止修改或删除

```text
server/src/modules/suppliers/**
web/apps/qsmds-arco/src/api/modules/suppliers.ts
web/apps/qsmds-arco/src/components/business/QsGenericTable/**
web/apps/qsmds-arco/src/components/base/ImageGroup/**
web/apps/qsmds-arco/src/components/base/AmountDisplay/**
web/apps/qsmds-arco/src/components/business/QsDictionarySelect/**
web/apps/qsmds-arco/src/views/admin/product-management/create/index.vue
web/apps/qsmds-arco/src/router/modules/product.management.ts
existing prisma migrations
package.json / lockfiles
```

若实现发现必须修改、删除或越过上述对象，立即暂停并回到 Design/Gate D1 重新确认。

## 7. 建议提交序列

1. `feat: 建立产品列表数据结构`
2. `feat: 增加字典值批量历史解析`
3. `feat: 实现产品列表查询内核`
4. `feat: 添加产品列表查询接口`
5. `test: 补齐产品列表服务端验收`
6. `chore: 同步产品列表接口契约`
7. `feat: 建立产品列表前端数据适配`
8. `feat: 实现产品列表页面骨架`
9. `feat: 完善产品列表特殊字段展示`
10. `test: 补齐产品列表浏览器验收`
11. `docs: 完成产品列表实施验收`

只有对应任务全部绿色后才创建提交。若某任务没有形成独立变更，不创建空提交；若跨任务发现缺陷，提交类型与描述必须反映真实职责，不使用 `misc`、`wip` 或掩盖失败的提交。

## 8. Phase 3 确认门

确认本计划意味着接受：

1. 按 Task 1-12 顺序实施，允许在不改变职责的前提下合并相邻绿色提交。
2. TDD 证据、生成产物、隔离数据库 E2E、真实 Browser 与最终矩阵均属于完成条件。
3. Product 列表继续保持只读，Supplier 字典、金额 string、共享组件和页面/API 边界不变。
4. Gate D1、D2、E 继续独立生效；Phase 3 确认本身不授权任何高风险变更或外部动作。

本文件确认后，下一步仍需先取得 Gate D1 的明确授权，才能开始 Product 数据结构、Schema、migration 和 `GET /api/products` 公共 API 的 Phase 4 实施。
