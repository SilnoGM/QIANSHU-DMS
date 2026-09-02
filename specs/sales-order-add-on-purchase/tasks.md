# 销售订单三类采购与海运前加购实施计划

## 1. 文档状态

- 阶段：Phase 4 - Implementation
- 状态：已确认并进入实施
- 编写日期：2026-09-02
- 需求规格：[requirements.md](./requirements.md)
- 技术设计：[design.md](./design.md)
- migration 边界：已确认，仅允许新增 `AuditEventType.SALES_ORDER_PRODUCT_APPENDED`
- migration 应用：未授权，开发数据库应用前必须再次取得明确指令

## 2. 执行原则

- 严格采用 TDD：每个新能力先建立有效 RED，确认失败来自行为缺失，再写最小实现转 GREEN。
- Phase 4 开始后实时更新本文件；只在自动化证据通过后勾选任务。
- 公共 API、Prisma Schema 与 migration 只能按已确认设计实施，不扩展表、字段、索引或额外审计结构。
- 开发数据库 migration 应用是独立授权门；隔离临时 PostgreSQL 可以在测试中执行 migration，不代表已应用到开发数据库。
- 所有订单金额由 Server 使用四位定点计算，客户端不提交可信金额汇总。
- 采购创建最终校验、数据库来源数量 trigger、采购幂等发号和未知结果重放保持既有边界。
- 加购 POST 禁止自动重试；未知结果使用持久错误和显式刷新，不静默换新版本重放。
- 不硬编码权限、供应商或密钥，不提交 `.env`、日志、缓存和构建产物。
- 每个业务阶段采用小步本地 Git 提交；不 push、不创建 PR、不发布、不部署。

## 3. 任务清单

### T1：固化已确认规格并建立实施基线

目标：在业务代码变更前形成可审计的需求、设计和任务基线。

- [x] 将 `requirements.md`、`design.md` 标记为已确认，将本文件标记为已确认并进入实施。
- [x] 复核三视图、海运截止点、金额公式、权限、未知结果和 migration 边界与最终确认一致。
- [x] 运行 `git diff --check` 并检查规格目录没有尾随空格或遗漏文件。
- [x] 精确暂存三个规格文件，确认不包含用户的无关改动。
- [x] 创建本地提交：

```text
docs: 设计销售订单海运前加购流程
```

- [x] 记录提交 SHA，不推送远端；最终 SHA 汇总在 T19 收口时统一记录。
- _Requirements: R1-R10_

### T2：建立三视图分类与聚合查询失败测试

目标：先证明当前按履约状态分类的实现无法满足三个事实互斥视图。

- [x] 扩展 `purchase-order-source-sales-order-view` 纯领域测试，覆盖：
  - `PENDING + 无有效采购 + 剩余 > 0`；
  - 海运前 `有效采购 > 0 + 剩余 > 0`；
  - 海运前 `有效采购存在 + 剩余 = 0`；
  - `SEA_TRANSIT`、`SIGNED`、非 `CONFIRMED` 和异常事实返回不可选；
  - 三个视图互斥且优先级稳定。
- [x] 扩展 `purchase-order-source-query.service.spec.ts`，要求聚合按 `sourceSalesOrderLineId` 计算，不按 `productId` 合并。
- [x] 覆盖相同目录产品多销售行、`CUSTOM`、取消采购、部分采购和完全覆盖。
- [x] 要求三个视图计数使用与列表相同关键词，并对缺失分类显式返回 `0`。
- [x] 要求分页排序保持 `orderDate DESC, id DESC`，只加载当前页展示摘要。
- [x] 断言 SQL 使用 Prisma 参数化模板，不允许 `$queryRawUnsafe`。
- [x] 运行定向测试并记录预期失败原因；测试装配错误不算有效 RED。
- _Requirements: R1, R2.1, R3.1, R6_

验证命令：

```bash
pnpm -C server test -- purchase-order-source-sales-order-view.spec.ts purchase-order-source-query.service.spec.ts --runInBand
```

### T3：实现三个可信采购视图

目标：以最小实现让 T2 转绿，并删除旧视图的错误语义。

- [x] 将服务端固定视图编码改为：
  - `UNPURCHASED`；
  - `PARTIALLY_PURCHASED`；
  - `COMPLETED_PURCHASE_ADD_ON`。
- [x] 新增 `SalesOrderPurchaseFacts` 和无副作用分类函数。
- [x] 使用参数化 CTE 分别构造 `purchased_by_line`、`active_purchase_by_order` 和 `order_purchase_facts`。
- [x] 有效采购同时限定 `SALES_LINKED`、相同 `salesOrderId` 和非 `CANCELLED`。
- [x] 使用事实查询取得当前视图分页 ID，再通过 Prisma 加载客户、出单人、状态、产品摘要和主图。
- [x] 三个计数和当前列表共享关键词、订单状态与海运前基础谓词。
- [x] 对聚合口径、参数化 SQL和为何不能按产品合并添加必要中文注释。
- [x] 重新运行 T2，确认全部转绿。
- [x] 运行服务端 typecheck 和 lint。
- _Requirements: R1, R2, R3, R6_

### T4：固化三视图 HTTP 与 OpenAPI 契约

目标：先用契约测试固定公共枚举、权限、响应计数和错误边界。

- [x] 更新查询 DTO 测试，接受三个新视图并拒绝旧值和任意状态组合。
- [x] 更新响应 DTO 测试，要求 `view` 与 `counts[].value` 只使用三个固定编码。
- [x] 更新 `purchase-orders.controller.spec.ts` 和 OpenAPI 快照断言。
- [x] 保持 `GET /api/purchase-orders/source-sales-orders`、`purchase-orders:create`、private no-store 和现有分页协议。
- [x] 保持来源图片 GET/HEAD 仍只要求采购创建权限。
- [x] 先确认旧契约测试因新枚举缺失而失败，再完成 DTO/Controller 最小更新。
- [x] 运行定向契约测试、typecheck 和 lint。
- _Requirements: R1.1-R1.6, R10.1, R10.6_

### T5：建立加购 Schema 与 migration 失败测试

目标：只为专用审计事件创建已确认的最小数据库变更。

- [x] 新增 `sales-order-add-on-schema.spec.ts`，先要求 Prisma 枚举和 migration 同时包含 `SALES_ORDER_PRODUCT_APPENDED`。
- [x] 断言 migration 只执行一条 `ALTER TYPE ... ADD VALUE`，不包含表、列、索引、约束、权限或数据回填。
- [x] 运行 schema 测试并确认因枚举和 migration 尚不存在而 RED。
- [x] 修改 `server/prisma/schema.prisma` 的 `AuditEventType`。
- [x] 新增单一职责 migration 文件。
- [x] 运行 `prisma:validate`、schema 定向测试和 `prisma:generate`。
- [x] 在隔离临时 PostgreSQL 执行 migration 并运行 drift gate；不得对开发数据库执行 `db:migrate:deploy`。
- [x] 检查生成 Prisma enum 中存在新事件且没有其他 Schema 漂移。
- _Requirements: R7.6-R7.7, R10.4-R10.5_

验证命令：

```bash
pnpm -C server prisma:validate
pnpm -C server test -- sales-order-add-on-schema.spec.ts --runInBand
pnpm -C server test:prisma-drift-gate
```

### T6：建立加购输入、上下文和产品选项失败测试

目标：先固定只追加销售明细的输入规则、资格读取和供应商产品边界。

- [x] 新增加购 DTO 与纯规范化测试，覆盖 CATALOG、CUSTOM、未知字段、UUID、价格、数量、名称、描述、原因和 `expectedVersion`。
- [x] 要求单次至少 1 行，累计销售明细不超过 100 行。
- [x] 证明现有销售创建行规则与加购行规则一致，避免双重金额口径。
- [x] 新增 `SalesOrderAddOnQueryService` 失败测试，覆盖：
  - `CONFIRMED + 海运前 + 有效采购 + 剩余 = 0` 才返回上下文；
  - 上下文包含版本、金额、有效收款、待收金额、原销售行和剩余行容量；
  - 非法阶段、仍有剩余、无有效采购和非正式订单拒绝；
  - 产品选项使用订单币种、指定供应商、启用产品和唯一主图；
  - `CUSTOM` 不来自产品选项；
  - 图片关系失效时返回既有安全错误。
- [x] 运行定向测试并记录有效 RED。
- _Requirements: R4, R5, R6, R7.1, R10.2-R10.3_

### T7：实现加购上下文、产品选项和图片端点

目标：提供加购弹窗所需的最小只读数据，并执行双权限硬边界。

- [x] 提取销售创建和加购共用的行输入规范化函数，保持创建接口行为不变。
- [x] 新增 `SalesOrderAddOnQueryService`，实现上下文资格重读和金额映射。
- [x] 复用销售产品选项映射，币种只从销售订单读取，不接受客户端币种。
- [x] 使用 `supplierValue` 限定启用目录产品并通过供应商字典有效性校验。
- [x] 扩展销售产品图片服务，重新校验订单资格、供应商、产品和当前主图关系。
- [x] 新增以下只读路由：
  - `GET /api/sales-orders/:salesOrderId/add-on-context`；
  - `GET /api/sales-orders/:salesOrderId/add-on-product-options`；
  - 加购产品主图 `HEAD/GET`。
- [x] 所有路由声明 `purchase-orders:create` 与 `sales-orders:update`，验证权限 Guard 使用全部满足语义。
- [x] 添加必要中文注释解释为什么采购加购读取不复用 `sales-orders:create` 权限。
- [x] 重新运行 T6 并转绿。
- _Requirements: R4, R5.3-R5.7, R6, R10.2-R10.5_

### T8：建立销售加购原子事务失败测试

目标：先固定行锁、版本、金额、付款状态、修订和审计的原子行为。

- [x] 新增 `sales-order-add-on.service.spec.ts`，要求第一条数据库操作锁定销售订单主行。
- [x] 覆盖 `expectedVersion` 相同成功、不同返回 `SALES_ORDER_ADD_ON_VERSION_CONFLICT`。
- [x] 覆盖锁后进入海运、非 `CONFIRMED`、无有效采购、剩余大于 0 时零写入。
- [x] 覆盖目录产品停用、供应商不匹配、供应商字典失效和行数超限。
- [x] 覆盖相同目录产品形成新销售行，原销售行数量和快照完全不变。
- [x] 覆盖 CATALOG/CUSTOM 快照、最大行号递增和新增行 ID 返回。
- [x] 覆盖金额公式：产品小计、约定总价、定金不变、尾款增加。
- [x] 覆盖有效收款不变，付款状态从 `PAID` 变为 `PARTIALLY_PAID` 或保持原值。
- [x] 要求付款状态变化才写 PAYMENT 历史，销售履约状态始终不写。
- [x] 要求一条 `SalesOrderAmountRevision` 保存完整前后快照和原因。
- [x] 要求每个新增销售明细写一条 `SALES_ORDER_PRODUCT_APPENDED`，共享 `requestId` 与 `amountRevisionId`，且无敏感字段。
- [x] 模拟销售行、金额修订、订单更新、历史或审计任一步失败，断言事务不返回成功。
- [x] 运行定向测试并记录有效 RED。
- _Requirements: R5, R6, R7, R9, R10.4-R10.5_

### T9：实现销售产品追加命令与 POST 契约

目标：以单事务完成销售产品、金额、付款事实和审计写入。

- [x] 新增 `SalesOrderAddOnService`，复用可信 mutation context 和事务 timeout。
- [x] 使用 `SELECT ... FOR UPDATE` 锁定销售订单，再校验版本和最新资格。
- [x] 服务端预生成新销售明细 UUID，按最大 `lineNumber` 递增并批量写入。
- [x] 重新读取正式产品构造编号、名称、属性和标准售价快照。
- [x] 使用销售金额定点函数计算 `amountDelta` 和四个新金额字段。
- [x] 汇总非作废收款，推导新付款状态和待收金额。
- [x] 原子写入销售订单、金额修订、必要付款历史和逐行审计，版本只增加 1。
- [x] 新增 `POST /api/sales-orders/:salesOrderId/add-on-lines`，要求 Session、CSRF、两项权限和 private no-store。
- [ ] Web API 客户端显式配置 `retry: false`，且未知结果不自动重放。
- [x] 返回新增行 ID、金额增量、前后版本、付款状态和可信金额结果。
- [x] 完成错误码和 OpenAPI Controller 测试。
- [x] 对行锁顺序、未知结果不可重放和履约状态不回退添加必要中文注释。
- [x] 重新运行 T8 并转绿。
- _Requirements: R5-R10_

### T10：增加隔离 PostgreSQL 服务端 E2E

目标：以真实约束、事务和并发验证三视图与加购闭环。

- [ ] 扩展采购服务 E2E，验证未采购、部分采购、全部采购三个视图及可信计数。
- [ ] 验证取消采购后按最新有效采购事实重新分类。
- [ ] 验证相同产品多行和 CUSTOM 的逐销售明细剩余数量。
- [ ] 扩展销售服务 E2E，验证 PREPARING、LAND_TRANSIT、WAREHOUSE_ARRIVED 可加购。
- [ ] 验证 SEA_TRANSIT、SIGNED 和非 `CONFIRMED` 硬拦截。
- [ ] 验证缺少任一权限时 POST 和只读加购端点均为 403。
- [ ] 验证产品、金额、付款状态、金额修订、付款历史和逐行审计一次提交。
- [ ] 并发提交同一 `expectedVersion`，断言只有一个成功。
- [ ] 加购成功后订单进入部分采购视图；补齐新增行后退出部分视图且原履约状态不变。
- [ ] 验证来源数量 constraint trigger 继续阻止超量采购。
- [ ] 在隔离 PostgreSQL 中执行完整 migration 后运行 E2E，不触碰开发数据库。
- _Requirements: R1-R10_

### T11：同步 OpenAPI 并建立 Web API 失败测试

目标：以生成类型驱动 Web 接入，不手写漂移 DTO。

- [ ] 执行 `node --run contract:sync`，检查 Server/Web OpenAPI 和 generated types。
- [ ] 断言三个视图编码、加购上下文、产品选项、图片和 POST 请求/响应完整生成。
- [ ] 扩展 `purchase-orders.test.ts`，固定三视图查询和来源明细恢复调用。
- [ ] 扩展 `sales-orders.test.ts`，固定加购上下文、产品选项和 POST 均使用 generated DTO。
- [ ] 断言加购 POST 配置 `errorPresentation: local`、`retry: false` 和 AbortSignal。
- [ ] 运行 API 定向测试并先确认缺少 Web API 方法的 RED。
- [ ] 实现最小 API 适配方法并转绿。
- [ ] 运行 `contract:check`，不接受手改 generated 文件。
- _Requirements: R1, R4, R5, R8, R9, R10_

### T12：扩展销售订单选择器和采购适配器

目标：让公共选择器支持三种动作语义，同时保持纯组件和受控业务关闭。

- [ ] 先扩展组件测试，要求 `confirmText`、`confirmDisabled`、禁用原因和 `closeOnConfirm`。
- [ ] 要求切换视图保留关键词、重置页码并清空失效草稿选择。
- [ ] 要求顶部工具栏、搜索和底部分页固定，只有候选列表滚动。
- [ ] 实现公共 props，默认行为继续兼容组件库其他调用方。
- [ ] 将采购适配器改为三个 `QsStatusSwitchToolbar` 项并接入可信计数。
- [ ] 适配器确认事件携带 `{ view, item }`，不根据中文文案推断动作。
- [ ] 第三视图显示“加购产品”；缺少 `sales-orders:update` 时禁用并解释原因。
- [ ] 未选择供应商时允许触发父级轻提示并保持选择器打开。
- [ ] 更新组件库示例，覆盖三视图、计数、权限禁用、桌面和移动布局。
- [ ] 运行选择器、适配器和组件库定向测试。
- _Requirements: R1, R4.1-R4.3, R10.2-R10.3_

### T13：建立并实现 `QsSalesOrderAddOnProductsModal`

目标：提供只追加产品、金额预览和二次确认的纯业务组件。

- [ ] 先新增组件 logic 测试，覆盖：
  - 新增小计和新金额预览；
  - 定金不变、尾款增加；
  - 原销售行不进入可编辑 `modelValue`；
  - 累计行容量、必填原因和 CATALOG/CUSTOM 校验；
  - 相同历史产品仍可作为新的独立行选择。
- [ ] 先新增组件结构测试，固定 `QsGenericModal`、订单摘要、原产品只读区、编辑区和二次确认。
- [ ] 新建组件 `types.ts`、`logic.ts`、`index.vue` 和 `README.md`。
- [ ] 复用 `QsOrderProductLineEditor`，传入订单币种、采购供应商和剩余行容量。
- [ ] 默认原因设为“客户加购产品”，允许用户修改。
- [ ] 桌面实现约 `5:7` 双栏，移动端纵向排列；不产生页面级横向滚动。
- [ ] 使用现有主题 token、Noto 字体、mono 金额样式和不少于 44px 的移动触控目标。
- [ ] 禁止直接发 API；只发取消、编辑、检查和确认意图。
- [ ] 新增组件库路由与 Showcase，覆盖稳定、空、加载、错误、行数满和移动状态。
- [ ] 运行组件、logic、组件库、typecheck 和 lint。
- _Requirements: R4.4-R4.5, R5, R7.1-R7.5, R8.1, R10.3_

### T14：建立采购页加购流程失败测试

目标：先固定候选、上下文、原子保存、三步加载和失败恢复状态机。

- [ ] 新增 `purchase-order-sales-add-on.logic.test.ts`，覆盖候选与正式关联分离。
- [ ] 扩展采购页面测试，要求：
  - 普通两个视图继续直接选择和读取来源行；
  - 第三视图未选供应商时只发 Warning Toast；
  - 取消加购不覆盖当前已选销售订单；
  - 双权限满足后加载上下文并打开加购弹窗；
  - 二次确认只启动一次 loader；
  - 三个步骤顺序和文案固定；
  - 第 1 步 POST 成功后才把 candidate 提升为正式关联；
  - 第 3 步使用采购来源接口刷新并复用现有同步逻辑；
  - 新增行可编辑，历史采购行置灰且始终排在后面；
  - 销售保存失败不产生本地正式关联；
  - 销售成功但同步失败时保留关联、供应商和可恢复错误；
  - 网络未知结果不自动 POST 第二次，保留持久核对提示；
  - 流程不创建采购幂等键、不提交采购单、不派发采购编号。
- [ ] 扩展快捷入口测试，要求在未采购视图未命中时查询部分采购视图，且不自动触发加购。
- [ ] 运行 Web 页面定向测试并记录有效 RED。
- _Requirements: R2, R3, R4, R8, R9, R10.6_

### T15：接入采购页和 `FaMultiStepLoader`

目标：完成海运前加购到采购表单同步闭环，不改变采购正式提交流程。

- [ ] 新增 `purchase-order-sales-add-on.logic.ts` 管理候选、上下文、输入、确认、loader 和失败结果。
- [ ] 在采购页接入双权限判断、供应商前置轻提示和加购上下文请求。
- [ ] 接入 `QsSalesOrderAddOnProductsModal` 与二次确认。
- [ ] 配置三个 loader 步骤：
  - 正在新增销售产品；
  - 完成销售订单金额变更；
  - 同步产品到采购单。
- [ ] 第 1 步执行唯一 POST；第 2 步只验证可信返回；第 3 步读取采购来源行并同步。
- [ ] loader 期间禁止关闭、重复提交和页面离开。
- [ ] 成功后保留销售订单和供应商，进入采购第二步继续填写采购价格与付款约定。
- [ ] 同步失败保留销售成功事实并提供当前页重试和部分采购视图恢复入口。
- [ ] 未知结果使用持久 `FaAlert`；普通前置问题继续使用现有 `useQsToast().warning()`。
- [ ] 快捷入口按未采购、部分采购顺序精确匹配订单 ID 与订单号。
- [ ] 对为何不自动重放、为何销售成功后不回滚和为何不提前创建采购幂等键添加必要中文注释。
- [ ] 重新运行 T14 并转绿。
- _Requirements: R2-R10_

### T16：完成静态检查和隔离运行时验收

目标：在不应用开发数据库 migration 的前提下完成代码、契约和隔离数据库验证。

- [ ] 运行全部定向 Server 单元和 Controller 测试。
- [ ] 运行 `prisma:validate`、drift gate、Server typecheck 和 lint。
- [ ] 运行隔离 PostgreSQL E2E，包含 migration、三视图、加购、并发和后续采购。
- [ ] 运行 `contract:check`。
- [ ] 运行全部定向 Web API、logic、页面和组件测试。
- [ ] 运行 Web typecheck、ESLint、Stylelint 和生产构建。
- [ ] 运行 `node --run check`；任何既有或新增失败均如实报告，不掩盖。
- [ ] 运行 `git diff --check` 并审计变更只在确认范围内。
- [ ] 确认未对开发数据库应用 migration。
- _Requirements: R1-R10_

验证命令：

```bash
pnpm -C server prisma:validate
pnpm -C server test -- purchase-order-source-sales-order-view.spec.ts purchase-order-source-query.service.spec.ts sales-order-add-on-query.service.spec.ts sales-order-add-on.service.spec.ts purchase-orders.controller.spec.ts --runInBand
pnpm -C server typecheck
pnpm -C server lint
node scripts/ci-postgres.mjs -- zsh -lc 'pnpm -C server db:migrate:deploy && pnpm -C server test:e2e -- purchase-order-service.e2e-spec.ts sales-order-service.e2e-spec.ts'
node --run contract:check
pnpm -C web test:api
pnpm -C web typecheck
pnpm -C web lint
pnpm -C web build
node --run check
git diff --check
```

### T17：开发数据库 migration 应用确认门

目标：把已验证 migration 应用与代码实现解耦，避免未经授权改变开发数据库。

- [ ] 展示待应用 migration 的精确目录、SQL 内容、Schema diff、隔离 E2E 和 drift 结果。
- [ ] 确认 SQL 只有 `SALES_ORDER_PRODUCT_APPENDED` 的 `ALTER TYPE ... ADD VALUE`。
- [ ] 检查当前开发数据库连接目标，只报告脱敏环境信息，不输出连接字符串或密码。
- [ ] 停止并等待用户明确指令“应用 migration”。
- [ ] 未取得该指令前不得执行开发数据库 `db:migrate:deploy`，不得用手工 SQL 绕过。
- _Requirements: R7.6-R7.7, R10.4_

### T18：应用 migration 并完成真实浏览器验收

前置条件：T17 获得用户明确应用授权。

- [ ] 使用仓库标准命令应用 migration，不手工修改迁移历史。
- [ ] 执行 `prisma:drift:check`，确认开发数据库与 migration 历史一致。
- [ ] 按既有脚本重启前后端；只管理 3000/9000，不影响无关进程。
- [ ] 验证 Server `/api/health` 中数据库为 `up`，Web 返回 HTTP 200。
- [ ] 使用隔离测试数据进行 1440px 和 390px 浏览器验收：
  - 三视图、计数、搜索和分页；
  - 普通首次采购与部分采购同步；
  - 第三视图权限不足和未选供应商；
  - 加购弹窗、金额预览、二次确认和三步 loader；
  - 加购成功进入部分采购并同步新增产品；
  - CATALOG、CUSTOM、相同产品再加购；
  - 海运硬拦截；
  - 销售成功但同步失败恢复；
  - 未知结果不自动重放。
- [ ] 验证原销售行、采购历史、履约状态和采购正式提交边界未被破坏。
- [ ] 清理仅属于测试的数据时使用测试夹具既有清理机制，不手工删除用户业务数据。
- _Requirements: R1-R10_

### T19：分阶段 Git 提交与最终收口

目标：用可回溯的小提交保存完整实现和验证证据。

- [ ] 实施中按以下建议阶段提交，实际文件范围必须精确检查：

```text
docs: 设计销售订单海运前加购流程
feat: 按采购事实分类销售来源
feat: 添加销售订单加购接口
feat: 添加销售订单加购弹窗
feat: 接入采购订单加购流程
test: 完成销售加购流程验收
```

- [ ] 每次提交前运行该阶段定向测试和 `git diff --check`。
- [ ] 检查暂存区不包含 `.env`、密钥、日志、数据库转储、缓存、构建产物或用户无关变更。
- [ ] 将本文件任务逐项勾选，最终状态改为已完成。
- [ ] 复核完整 diff、migration、OpenAPI、generated types 和测试证据。
- [ ] 记录所有本地提交 SHA、验证结果、migration 应用结果和运行时健康状态。
- [ ] 确认工作树不存在本需求遗留改动；若存在用户改动则明确区分，不覆盖。
- [ ] 不 push、不创建 PR、不发布、不部署。
- _Requirements: R1-R10_

## 4. 需求追踪矩阵

| 需求 | 主要任务 | 核心证据 |
| --- | --- | --- |
| R1 三个可信采购视图 | T2-T4、T10、T12 | 纯分类测试、聚合测试、E2E、组件计数 |
| R2 未采购同步全部产品 | T3、T10、T14-T15 | 来源行 E2E、采购页面同步测试 |
| R3 部分采购同步剩余产品 | T3、T10、T14-T15 | 逐行剩余、灰色历史行和恢复测试 |
| R4 已完成采购进入加购 | T6-T7、T12-T15 | 上下文资格、第三视图交互测试 |
| R5 只追加销售明细 | T6、T8-T10、T13 | 规范化、快照、旧行不变和相同产品测试 |
| R6 海运前资格与硬拦截 | T2、T6-T10、T18 | 状态边界单测、E2E、浏览器验收 |
| R7 销售金额原子变更 | T5、T8-T10、T13 | 金额公式、事务回滚、修订和 Schema 测试 |
| R8 多步骤加载与采购同步 | T11、T13-T15、T18 | loader 顺序、页面恢复和浏览器验收 |
| R9 并发、重复提交与恢复 | T8-T10、T14-T16 | 版本并发、retry=false、未知结果测试 |
| R10 权限、审计与数据边界 | T5-T11、T12、T16-T18 | 双权限、逐行审计、OpenAPI、隔离与真实验收 |

## 5. 完成定义

只有同时满足以下条件才能声明完成：

1. T1–T19 按真实结果更新，所有适用任务已完成；
2. 三个来源视图和计数完全来自服务端采购事实且互斥；
3. 加购只追加销售明细，旧销售行和历史采购行保持不变；
4. 销售行、金额、付款状态、金额修订、状态历史和审计同事务提交或回滚；
5. 海运及后续状态无法加购，同版本并发最多一个成功，未知结果不自动重放；
6. 新增行能够进入部分采购视图、同步到采购表单并受剩余数量数据库约束；
7. Server、OpenAPI、Web generated types、组件和页面契约一致；
8. 定向测试、隔离 PostgreSQL E2E、类型检查、Lint、构建和根检查均有最新证据；
9. 开发数据库 migration 仅在获得明确授权后应用并通过 drift/health 验证；
10. 真实浏览器完成桌面、移动、权限、错误和恢复场景验收；
11. 本地 Git 小提交完成，工作树范围清楚，未 push、未发布、未部署。

## 6. Phase 3 确认门

确认本实施计划后才进入 Phase 4。进入 Phase 4 表示授权按任务顺序修改已确认范围内的业务代码、公共 API、Prisma Schema 和 migration 文件，但仍不授权：

- 将 migration 应用到开发数据库；
- push、PR、发布或部署；
- 扩大为额外 Schema、数据回填或无关重构。

开发数据库 migration 应用将在 T17 再次单独请求明确指令。
