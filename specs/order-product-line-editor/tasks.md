# 通用订单产品明细编辑与产品选择器实施任务

## 1. 文档状态

- 状态：Phase 4 已完成，自动化、真实浏览器与用户手动验收已通过
- 拆分日期：2026-08-23
- 需求基线：[requirements.md](./requirements.md)
- 技术基线：[design.md](./design.md)
- 当前分支：`feat/sales-order-domain`
- 当前基线提交：`0899db3`
- 目标组件：`QsProductSelector`、`QsOrderProductLineEditor`
- 首个接入页面：`/operations/sales-orders/create`
- 用户已授权按改动内容分批提交；仍不授权推送、合并、部署、数据库变更、依赖新增或服务重启

## 2. 执行纪律

1. Phase 4 按本文依赖顺序串行实施，同一时间只处理一个任务；每个任务先建立聚焦失败测试，再做最小实现，测试转绿后才进入下一任务。
2. 只修改 [design.md](./design.md) 第 14 节预计文件矩阵所列文件和本文明确列出的必要测试文件；出现范围外生产文件时先停止并说明原因。
3. 不新增 Prisma Schema、migration、索引、依赖、采购订单 API、采购权限、采购页面或持久化 Store。
4. 不放宽既有 `product-media:read` 内容接口；销售录单主图必须使用 `sales-orders:create` 保护的独立内容路由。
5. 不改变一单一币种、数量正整数、金额三等式、正式保存才派号、步骤下一步硬拦截等既有销售订单不变量。
6. OpenAPI 生成产物只允许通过 `node --run contract:sync` 更新，不手改生成代码。
7. 只运行本变更直接相关的聚焦测试、两个依赖域的 typecheck、契约检查和一条真实浏览器流程；禁止运行根 `node --run check`、无关模块全量套件或全量浏览器验收。
8. 若真实浏览器验收需要重启前后端，先报告当前进程和健康状态并单独取得用户确认；不得自行重启或影响无关进程。
9. 命令失败或测试不通过时如实保留失败证据，不跳过、不降级验收、不以源码检查冒充真实交互。
10. Phase 4 完成后按改动内容精确暂存并分批提交；不执行 `git push`、合并或部署。

## 3. 实施门禁

- [x] Gate A：Phase 1 需求已确认。
- [x] Gate B：Phase 2 技术方案已确认。
- [x] Gate C：本文任务、顺序、公共 API 扩展范围及聚焦验证口径已确认。
- [x] Gate D：Phase 4 实施完成，自动化聚焦验证和真实浏览器流程通过。
- [x] Gate E：用户手动验收通过，并已授权按改动内容分批提交 Git。

以下任一情况必须暂停并重新确认：

- 需要新增或修改本文未列出的公共 API、数据结构或数据库 Schema/migration。
- 无法在不放宽 `product-media:read` 的情况下提供销售录单主图。
- 需要改变产品资格、金额公式、数量规则、订单发号或订单保存契约。
- 需要为通用组件引入第三方依赖、全局 Store、URL 查询持久化或销售订单专用权限。
- 需要绕过既有原子变更模型直接持久化选择器会话，或修改临时产品同步边界。
- 需要实现采购订单领域接入，而不只是保持组件可复用契约。
- 必须运行全量测试、重启服务、推送、合并或部署等未授权动作。

## 4. 任务依赖

```mermaid
flowchart LR
  T1[T1 基线与失败测试]
  T2[T2 候选产品查询契约]
  T3[T3 销售域主图内容路由]
  T4[T4 OpenAPI 与 Web API]
  T5[T5 Web 纯逻辑与 FaPopover]
  T6[T6 QsProductSelector]
  T7[T7 QsOrderProductLineEditor]
  T8[T8 新增销售订单接入]
  T9[T9 组件库 Showcase]
  T10[T10 聚焦验证与交付]

  T1 --> T2 --> T3 --> T4 --> T5 --> T6 --> T7 --> T8 --> T9 --> T10
```

## 5. 实施任务

### Task 1：冻结基线并建立聚焦失败测试

**目标**

在不修改业务实现的前提下，把已确认口径转换为可失败的测试边界，确认现有销售订单聚焦基线可运行。

**步骤**

- [x] 1.1 复核 `requirements.md`、`design.md`、当前分支、HEAD 和工作区，记录用户已有改动并避免覆盖。
- [x] 1.2 运行现有销售订单 Server、Web API/View 聚焦测试作为基线；不运行根全量检查。
- [x] 1.3 为 Server 候选产品查询增加失败测试：`supplierValue`、`page`、`pageSize`、`total`、稳定顺序、固定币种唯一标准价、批量主图元数据。
- [x] 1.4 为销售域主图内容路由增加失败测试：权限元数据、GET/HEAD、产品资格、只允许 READY 主图、防枚举 404、存储错误透传。
- [x] 1.5 为 Web 选择器和明细编辑器纯逻辑增加失败测试：已有明细索引、ADD、累计 INCREMENT、REMOVE、取消无副作用、原子应用、分页追加、筛选版本隔离、金额汇总。
- [x] 1.6 为组件结构和销售接入增加失败测试：空表、两个入口、列顺序、单行 Tooltip、无行内产品搜索、销售与付款信息相邻且三列同排。

**基线验证命令**

```bash
pnpm -C server exec jest src/modules/sales-orders --runInBand
pnpm -C web exec tsx --test \
  apps/qsmds-arco/test/api/sales-orders.test.ts \
  apps/qsmds-arco/test/views/sales-order-create.logic.test.ts \
  apps/qsmds-arco/test/views/sales-order-create-view.logic.test.ts \
  apps/qsmds-arco/test/views/sales-order-pages.test.ts
```

**完成条件**

- 既有聚焦基线通过；新增测试只因目标能力尚未实现而按预期失败。
- 失败信息不包含密钥、Cookie、客户完整地址或媒体私有路径。

**覆盖需求**：R1-R14。

### Task 2：扩展销售订单候选产品查询

**目标**

把 `GET /api/sales-orders/product-options` 扩展为支持固定币种、关键词、供应商和滚动加载所需的页码分页响应，同时返回匹配总数及最小主图标识。

**步骤**

- [x] 2.1 扩展 Query DTO：`currencyCode`、`keyword`、`supplierValue`、`page`、`pageSize`，补齐边界和非法输入测试。
- [x] 2.2 扩展响应 DTO：`items`、`page`、`pageSize`、`total`，单项只保留稳定产品 ID、编号、名称、供应商值、当前币种标准价和主图最小字段。
- [x] 2.3 在 `SalesOrderQueryService` 中实现所有筛选条件的 AND 组合、稳定排序、独立 `count`、分页查询和当前币种价格唯一映射。
- [x] 2.4 使用批量查询解析当前页 READY 主图，避免每张卡片单独查询数据库；没有主图时返回 `null`。
- [x] 2.5 保持 `sales-orders:create` 权限、`ACTIVE` 产品和当前币种标准价资格不变，不返回其他币种或采购成本。
- [x] 2.6 运行 DTO、Query Service 和 Controller 聚焦测试并确认转绿。

**完成条件**

- 筛选变化可从第一页重新加载；响应 `total` 表示当前组合条件的服务端匹配总数。
- 相同输入得到稳定分页顺序，不产生 N+1 主图查询。

**覆盖需求**：R2、R4、R5、R12、R14。

### Task 3：新增销售录单受保护主图内容路由

**目标**

让仅具备 `sales-orders:create` 的用户读取当前可选产品主图，同时不改变产品管理媒体权限。

**步骤**

- [x] 3.1 从产品媒体域提取无状态 HTTP 内容响应 helper，并保持 Products Controller 现有 GET/HEAD 行为不变。
- [x] 3.2 让 `ProductsModule` 以最小边界导出既有 `ProductMediaContentService`，由 `SalesOrdersModule` 显式导入复用。
- [x] 3.3 新增 `SalesOrderProductImageService`，按 `productId + productMediaId + currencyCode` 重新校验 ACTIVE、当前币种标准价、PRIMARY、READY 和归属关系。
- [x] 3.4 新增 GET/HEAD 路由：`/api/sales-orders/product-options/:productId/main-image/:productMediaId/content`，只使用 `sales-orders:create`。
- [x] 3.5 对不存在、无资格、非主图、非 READY 或归属不符统一返回不可枚举的 404；不暴露存储路径和底层对象地址。
- [x] 3.6 运行产品媒体回归聚焦测试及销售域主图 Service/Controller 测试并确认转绿。

**完成条件**

- 销售录单图片可读，原产品媒体路由权限和响应语义保持不变。
- GET/HEAD 的缓存、范围请求和错误映射继续复用单一内容服务。

**覆盖需求**：R2、R5、R12、R14。

### Task 4：同步 OpenAPI 与 Web API 适配器

**目标**

从 Server 真相源同步候选产品分页与主图契约，并提供可取消、可分页的 Web loader。

**步骤**

- [x] 4.1 补齐 Controller decorators、DTO schema 和 OpenAPI 聚焦快照，保证 query、分页响应、主图 GET/HEAD 的 operationId 唯一。
- [x] 4.2 运行 `node --run contract:sync` 更新受管 OpenAPI 和 Web 类型，不手工修改生成产物。
- [x] 4.3 扩展 `salesOrdersApi.productOptions`：完整传递固定币种、关键词、供应商、页码、页大小和 `AbortSignal`。
- [x] 4.4 将 Server 最小响应转换为组件中立的 `ProductSelectorOptionPage`，主图 URL 保持销售适配层职责。
- [x] 4.5 增加 API adapter 聚焦测试：query 序列化、空供应商省略、分页响应、取消请求和错误保持局部可见。
- [x] 4.6 运行 `node --run contract:check`，确保契约生成结果无漂移。

**完成条件**

- Web 不自行声明与 OpenAPI 冲突的销售响应类型。
- 选择器 loader 不读取路由、Store 或另一币种价格。

**覆盖需求**：R1、R2、R4、R5、R12、R14。

### Task 5：实现 Web 纯逻辑和 FaPopover 最小焦点能力

**目标**

先建立无 UI 副作用的选择会话和明细 reducer，并为重复产品局部确认提供受控焦点入口。

**步骤**

- [x] 5.1 定义业务中立类型：候选项、分页、已有明细快照、`ADD | INCREMENT | REMOVE` 会话变更、数据库/临时产品行和标签配置。
- [x] 5.2 实现选择器纯逻辑：查询版本、Abort 失效、第一页替换、后续页追加、跨筛选保留会话状态、已有明细稳定 ID 判重和已选投影。
- [x] 5.3 实现重复产品规则：每次确认累计 `+1`；拒绝后不改变会话，移除/恢复与左侧状态同步。
- [x] 5.4 实现编辑器原子 reducer：先重新校验当前明细，再一次性应用 ADD/INCREMENT/REMOVE；任何冲突或上限错误时整批不写入。
- [x] 5.5 复用销售订单既有十进制定点口径实现行小计、标准价汇总、本单售价汇总，禁止使用浮点直接累加。
- [x] 5.6 为 `FaPopover` 增加默认 `false` 的 `autoFocus?: boolean`；只在重复确认浮层传 `true`，验证关闭后焦点回到触发项。
- [x] 5.7 运行上述纯逻辑与 FaPopover 聚焦测试并确认转绿。

**完成条件**

- 取消/关闭选择器不会触发父级 `update:modelValue`。
- 一次最终确认最多触发一次原子更新，既有数据库产品不会生成重复行。
- `FaPopover` 现有调用方行为不变。

**覆盖需求**：R1、R6、R7、R10、R12、R13。

### Task 6：实现 `QsProductSelector`

**目标**

实现通过 loader 注入数据的通用产品选择弹窗，并完整承载搜索、供应商筛选、滚动分页、卡片、统计和数据库产品已选清单。

**步骤**

- [x] 6.1 创建组件目录、公开 props/emits/types 和 README，禁止在组件内导入销售 API、路由或权限常量。
- [x] 6.2 使用 `QsGenericModal` 建立左宽右窄布局并局部加宽至 `68rem`：左侧搜索/供应商、结果卡片、匹配总数；右侧已选产品列表和最终确认。
- [x] 6.3 通过 Dictionary Catalog 加载 `service_provider.supplier`，默认“全部供应商”，并允许显示产品已存储的停用历史供应商值。
- [x] 6.4 实现产品卡片：主图/占位图、加大加粗的单行产品名、产品编号、已有/待新增/待增量状态。
- [x] 6.5 实现滚动触底加载、加载中、局部错误、重试、无结果、无更多数据和匹配总数；过滤变化后丢弃旧响应。
- [x] 6.6 当产品已在打开时明细快照或本次已选清单中，使用弹窗内 `FaPopover` 询问“产品已存在，是否增加数量？”，每次确认累计 `+1`。
- [x] 6.7 右侧回显全部数据库产品并支持移除、恢复；只有最终“确认添加”才 emit ADD/INCREMENT/REMOVE 变更集，取消和关闭清空会话。
- [x] 6.8 补齐键盘、焦点回收、暗色主题、Reduced Motion、窄屏单列和主图替代文本。
- [x] 6.9 运行逻辑与组件结构聚焦测试并确认转绿。

**完成条件**

- 筛选与分页不丢失本次选择，服务端总数不与已加载数混淆。
- 组件在不知道销售订单 DTO 的情况下可以独立运行。

**覆盖需求**：R1、R3-R7、R11-R14。

### Task 7：实现 `QsOrderProductLineEditor`

**目标**

实现可供销售订单首期接入、未来可由采购订单复用的业务中立明细编辑器。

**步骤**

- [x] 7.1 创建组件目录、公开 `v-model`、字段标签配置、固定币种、候选 loader 和必要校验回调，不写死“销售”或“采购”。
- [x] 7.2 顶部提供“添加数据库产品”和“添加临时产品”；默认显示空表，临时产品直接新增一行。
- [x] 7.3 组合 `QsProductSelector`，打开时读取当前数据库产品及数量，最终确认时调用原子 reducer 并一次更新明细。
- [x] 7.4 实现可横向滚动的语义化表格，列顺序固定为：来源、编号、名称、主图、标准价、本单售价、数量、本单售价小计、备注、删除。
- [x] 7.5 数据库产品字段按候选快照只读；临时产品编号显示“仅本订单”、主图为空、标准价不参与汇总。
- [x] 7.6 本单售价使用 `MoneyInput`，数量只允许正整数，备注使用单行输入，删除使用项目现有图标并提供可访问名称。
- [x] 7.7 产品名称和备注保持单行省略；Hover 与键盘聚焦均通过 `FaTooltip` 显示完整内容。
- [x] 7.8 表格底部展示标准价汇总和本单售价汇总，金额统一按固定币种格式化。
- [x] 7.9 增加空态、临时行、数据库行、删除、Tooltip、横向滚动、两项汇总和原子应用聚焦测试。

**完成条件**

- 每列有明确最小宽度，完整业务列不被静默隐藏。
- 组件不保存订单、不发号、不请求销售 API，公共模型不包含销售专用字段名。

**覆盖需求**：R1、R6-R11、R13、R14。

### Task 8：接入新增销售订单“产品与销售”步骤

**目标**

用通用编辑器替换现有明细行内搜索，同时保持销售订单既有步骤、金额和提交不变量。

**步骤**

- [x] 8.1 保留 `sales-order-lines.vue` 为薄销售适配层，将现有销售明细模型与通用行模型、标签和错误路径双向映射。
- [x] 8.2 在 `create.vue` 注入固定订单币种和 `salesOrdersApi.productOptions` loader，移除进入页面时的候选产品全量预取。
- [x] 8.3 删除数据库产品行内搜索框与搜索按钮；初始产品明细保持空表。
- [x] 8.4 将“销售与付款约定”改为“销售与付款信息”，紧跟明细编辑器下方；销售总价、定金、尾款三项在桌面端同排。
- [x] 8.5 移除页面重复的“产品明细汇总”展示，由编辑器底部本单售价汇总承担唯一明细汇总展示。
- [x] 8.6 保持下一步金额硬拦截：手填销售总价 = 明细本单售价汇总，定金 + 尾款 = 销售总价；服务端仍重新计算。
- [x] 8.7 保持正式保存才派号、固定币种、客户/地址、附件和第四步核对布局不变。
- [x] 8.8 更新 DTO 构建逻辑，明确主图和选择器查询状态不进入订单创建请求。
- [x] 8.9 运行销售订单 create logic、view、page 和 API 聚焦回归测试并确认转绿。

**完成条件**

- 产品与销售仍为同一步骤，点击下一步时继续执行明细与金额硬校验。
- 新选择的数据库产品和临时产品均生成现有 Server 可接受的订单明细 DTO。

**覆盖需求**：R1、R2、R8-R10、R12-R14。

### Task 9：增加组件库 Showcase

**目标**

让两个新增业务组件在组件库中可独立查看和手动操作，不依赖真实 Server 或销售订单权限。

**步骤**

- [x] 9.1 为 `QsProductSelector` 创建本地 Fixture：供应商、分页、主图占位、加载、错误、已有明细和待处理状态。
- [x] 9.2 为 `QsOrderProductLineEditor` 创建本地 Fixture：空表、数据库行、临时行、长名称/备注、TWD/MYR 和汇总。
- [x] 9.3 新增两个 Showcase 页面及组件库路由，沿用既有业务组件展示规范。
- [x] 9.4 测试 Fixture 不发起真实 API 请求，组件库路由可发现，长文本 Tooltip 和横向滚动可手动验收。

**完成条件**

- 两个组件均可在组件库导航中进入，演示数据不会写入业务域。

**覆盖需求**：R1、R3、R8、R11-R13。

### Task 10：聚焦验证、真实浏览器验收与交付

**目标**

只对本变更建立可审计证据，并把最终人工判断留给用户。

**步骤**

- [x] 10.1 运行所有新增/修改的 Server 销售订单与产品媒体聚焦 Jest 文件。
- [x] 10.2 运行所有新增组件、销售订单页面和 API 的 Web 聚焦 Node 测试文件。
- [x] 10.3 运行 `pnpm -C server typecheck`、`pnpm -C web typecheck` 和 `node --run contract:check`。
- [x] 10.4 运行 `git diff --check`，审查变更文件、生成产物、敏感信息和未授权范围；不暂存、不提交。
- [x] 10.5 在健康开发环境中完成真实浏览器流程，并由用户完成手动验收。
- [x] 10.6 浏览器验证：打开回显、取消回滚、重复选择累计加量、右侧删除同步、重新打开状态、加宽弹窗、长产品名省略与 Tooltip。
- [x] 10.7 检查页面交互与控制台，无未捕获异常、页面级横向溢出或操作按钮遮挡。
- [x] 10.8 向用户交付文件清单、命令结果、已知限制和手动验收路径，等待用户手动验收及后续 Git 指令。

**最终验证命令**

```bash
pnpm -C server exec jest <本次修改的 sales-orders/products spec 文件> --runInBand
pnpm -C web exec tsx --test <本次新增或修改的 API/View/组件测试文件>
pnpm -C server typecheck
pnpm -C web typecheck
node --run contract:check
git diff --check
git status --short
```

**明确不运行**

```text
node --run check
pnpm -C server check
pnpm -C web check
node --run ci:browser-auth-e2e
```

其中现有 `node --run ci:browser-auth-e2e` 会运行多条无关浏览器套件，不符合本次“必要测试”约束。真实销售订单流程优先在当前健康开发环境中定向验收；如自动化隔离环境成为完成条件，再先确认是否增加只运行 `sales-orders.browser.test.mjs` 的最小测试入口。

**完成条件**

- 所有必要聚焦测试和类型/契约检查通过；任何未运行项、失败项或环境限制均明确报告。
- 用户可以按给定入口手动复核两个组件和新增订单完整交互。

**覆盖需求**：R1-R14。

## 6. 需求追踪矩阵

| Requirement | 实施任务 | 核心证据 |
| --- | --- | --- |
| R1 组件分层与复用 | T5-T9 | 通用类型、loader 注入、薄销售适配、Showcase |
| R2 固定币种与资格 | T2-T4、T8、T10 | Server 资格测试、API query、浏览器固定币种 |
| R3 弹窗信息架构 | T6、T9、T10 | 结构测试、Showcase、真实浏览器 |
| R4 搜索/供应商/分页 | T2、T4、T6、T10 | Query 测试、分页 reducer、真实筛选 |
| R5 产品卡片 | T2-T4、T6、T10 | 主图最小响应、卡片结构和图片读取 |
| R6 已有明细与判重 | T5-T7、T10 | 稳定 ID、累计加量、删除/恢复、重复确认 |
| R7 已选同步与原子确认 | T5-T7、T10 | ADD/INCREMENT/REMOVE reducer、取消无副作用、单次 emit |
| R8 入口与空态 | T7-T9 | 两个入口、空表、销售适配 |
| R9 表格字段行为 | T7、T8、T10 | 列结构、编辑、删除和 DTO 映射 |
| R10 汇总和硬校验 | T5、T7、T8、T10 | 十进制定点测试、下一步硬拦截 |
| R11 宽度与 Tooltip | T6、T7、T9、T10 | 单行省略、焦点 Tooltip、横向滚动 |
| R12 加载/错误/恢复 | T2、T4-T7、T10 | Abort、版本隔离、重试、会话恢复 |
| R13 响应式/主题/无障碍 | T5-T7、T9、T10 | 键盘、焦点、主题、Reduced Motion |
| R14 权限/安全/门禁 | T1-T4、T8、T10 | 权限元数据、受保护媒体、契约与范围审查 |

## 7. Phase 3 确认门禁

确认本文后才进入 Phase 4 实施。该确认将授权且仅授权：

1. 按 T1-T10 修改已列明的生产代码和聚焦测试。
2. 扩展 `GET /api/sales-orders/product-options` 的查询/分页响应，并新增销售域主图 GET/HEAD 公共路由。
3. 通过既有流程同步 OpenAPI 和 Web 生成类型。
4. 新增两个通用业务组件、对应组件库 Showcase，并接入新增销售订单页面。
5. 运行本文列出的必要聚焦测试、typecheck、契约检查和一条真实浏览器验收。

当前另行授权按改动内容精确暂存并分批提交 Git；仍不授权数据库 Schema/migration、采购订单实现、依赖新增、全量测试、服务重启、推送、合并或部署。
