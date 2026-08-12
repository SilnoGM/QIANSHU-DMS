# 产品创建需求规格

## 1. 文档状态

- 状态：Phase 1 已确认
- 编写日期：2026-08-12
- 适用范围：`server/`、`web/apps/qsmds-arco`
- 实施分支：`feat/admin-product-management`
- 关联规格：`specs/product-list/requirements.md`
- 当前门禁：Requirements 已于 2026-08-12 确认；Design、Tasks、Schema/API 实施、本地持久数据库 migration 与外部发布均未授权

## 2. 背景与目标

产品列表已经具备 Product 持久化模型、`GET /api/products`、供应商历史解析、名称/编号搜索和正式列表页面，但 `/admin/products/create` 仍是占位页，列表页“新增产品”仍只显示轻提示。

本期目标是在既有 Product 字段和权限边界内实现真实产品创建：由 Server 使用 `PRODUCT` 编号规则派发不可变产品编号，保存基础资料、供应商、三组价格和有序产品属性，并在同一业务事务内记录创建审计。图片、视频及文件上传不属于本期。

2026-08-12 的只读开发库审计结果仅作为实施前置证据，不作为永久配置假设：

- `PRODUCT` 编号规则为 `ENABLED`，存在一个 Active Version。
- `service_provider.supplier` 字典已启用，存在一个有效 Item。
- `TWD`、`MYR`、`CNY` 货币均已启用，`minorUnit=2`。
- Product 当前为 0 行。

## 3. 用户故事

### 3.1 产品维护人员

作为具有产品创建权限的维护人员，我希望在一个结构清晰的页面中填写产品基础资料、供应商、价格和属性，以便创建一条可进入后续业务流程的产品记录。

### 3.2 产品运营人员

作为产品运营人员，我希望创建成功后看到由系统派发的产品编号，并能返回产品列表确认结果，以便继续检索和核对产品资料。

### 3.3 系统管理员与审计人员

作为系统管理员或审计人员，我希望每次成功创建都具备可信操作者、请求标识和精简审计元数据，以便追踪产品来源且不泄露完整业务内容。

## 4. 已确认业务决策

1. 创建入口固定为 `/admin/products/create`，继续使用既有 `products:create` 权限。
2. 产品编号不显示为可编辑字段，只由 Server 调用 `NumberingGeneratorService` 派发。
3. 创建状态默认 `DRAFT`，允许选择 `DRAFT`、`ACTIVE`、`INACTIVE`。
4. `ACTIVE` 必须选择有效供应商；`DRAFT` 与 `INACTIVE` 允许供应商为空。
5. 任何创建请求携带的非空供应商值都必须在 Product 写事务内确认当前有效。
6. 台币销售价币种固定为 `TWD`，马币销售价币种固定为 `MYR`。
7. 采购成本币种默认 `CNY`，允许从当前有效货币中选择其他币种。
8. 金额允许为空；空金额保存为 `null`，不得转换为零。
9. 产品属性使用有序 `{ title, value }` 列表，支持新增、删除、上移和下移。
10. 本期不实现主图、图片、视频上传，也不提供媒体 URL 输入。
11. 创建成功后，具有 `products:read` 权限的用户返回产品列表；仅有创建权限的用户停留在成功摘要并可继续新增。
12. 创建请求使用稳定幂等键；网络或 `5xx` 导致结果未知时不自动重放。

## 5. 字段与数据口径

### 5.1 客户端可提交字段

| 字段 | 类型 | 必填 | 规则 |
| --- | --- | --- | --- |
| `name` | `string` | 是 | trim + NFC 后 `1..128` Unicode code points |
| `status` | enum | 是 | `DRAFT / ACTIVE / INACTIVE`，Web 默认 `DRAFT` |
| `supplierValue` | `string \| null` | 是 | `null` 或 `1..64` code points 的稳定字典 value |
| `twdSalePrice` | money | 是 | `{ amount: string \| null, currency: "TWD" }` |
| `myrSalePrice` | money | 是 | `{ amount: string \| null, currency: "MYR" }` |
| `purchaseCost` | money | 是 | `{ amount: string \| null, currency: string }`，Web 默认 `CNY` |
| `attributes` | attribute[] | 是 | 最多 50 项，保留顺序 |

Money 中的非空 `amount` 使用不含符号、分组符或科学计数法的十进制字符串。金额必须大于等于零，并同时满足 Product `DECIMAL(30,4)` 物理上限与当前币种 `minorUnit`。

每项 Attribute：

- `title`：trim + NFC 后 `1..64` Unicode code points。
- `value`：trim + NFC 后 `1..512` Unicode code points。
- 保留列表顺序和重复标题；Server 不静默去重、排序或合并。
- 对象只允许 `title`、`value` 两个字段。

### 5.2 Server 专属字段

以下字段不得由客户端提交：

- `id`
- `productNo`
- `mainImage`
- `images`
- `videos`
- `createdByUserId`
- `updatedByUserId`
- `version`
- `createdAt`
- `updatedAt`

创建时 Server 固定写入：

```text
mainImage = null
images = []
videos = []
version = 1
createdByUserId = current user id
updatedByUserId = current user id
```

## 6. Requirements 与 Acceptance Criteria

### Requirement 1 - 创建入口与权限

#### Acceptance Criteria

1. 当用户访问 `/admin/products/create` 时，系统应要求 `products:create` 权限。
2. 当用户缺少 `products:create` 或必须修改密码时，系统应阻止页面和 API 创建能力。
3. 当产品列表页用户具有 `products:create` 时，点击“新增产品”应导航到真实创建页，不再显示占位轻提示。
4. 当用户只有 `products:create` 而没有 `products:read` 时，系统仍应允许创建，但不得在成功后导航到无权访问的产品列表。
5. 当创建页失去创建权限或身份域发生变化时，系统应中止旧请求、清除不再可信的表单上下文，并交由既有路由权限机制收敛。

### Requirement 2 - 产品名称与状态

#### Acceptance Criteria

1. 当用户输入产品名称时，系统应在提交边界执行 trim 与 NFC，并要求规范化后长度为 `1..128` Unicode code points。
2. 当用户未选择状态时，Web 应使用 `DRAFT` 作为初始值；Server 仍应只接受三个显式状态值。
3. 当请求包含未知状态、空白名称或超长名称时，Server 应返回稳定字段校验错误且不得派发编号。
4. 当状态为 `DRAFT` 或 `INACTIVE` 时，系统应允许 `supplierValue=null`。
5. 当状态为 `ACTIVE` 且 `supplierValue=null` 时，Server 应拒绝创建且不得派发编号。

### Requirement 3 - 供应商选择与写时有效性

#### Acceptance Criteria

1. 当创建页展示供应商字段时，系统应复用 `QsDictionarySelect dictionaryCode="service_provider.supplier"` 并保存稳定 Item `value`。
2. 当请求携带非空 `supplierValue` 时，Product Command 应在调用方事务内通过 `DictionaryLookupService.requireEffectiveValue()` 确认 Type 与 Item 当前均启用。
3. 当供应商 Type 或 Item 缺失、停用或在提交期间变化时，Server 应拒绝 Product 写入与成功审计。
4. 当供应商 Catalog 加载失败且当前状态允许空供应商时，页面应允许用户保持 `null` 创建，并明确说明供应商选项暂不可用。
5. 当状态为 `ACTIVE` 且供应商 Catalog 不可信或没有有效选项时，页面应阻止提交并提供可操作的重试状态。
6. 当创建成功后供应商字典发生变化时，Product 应继续保存原始稳定 value；后续列表读取沿用既有历史解析语义。

### Requirement 4 - 产品编号与幂等创建

#### Acceptance Criteria

1. 当有效创建请求首次进入编号阶段时，Server 应调用 `NumberingGeneratorService.generate()`，固定使用 `ruleCode="PRODUCT"` 和 `consumerCode="PRODUCT.CREATE"`。
2. 当客户端提交创建请求时，应提供 canonical lowercase UUID v4 `Idempotency-Key` Header；该值不得放入 JSON DTO、日志、审计或响应。
3. 当同一操作者使用相同 `Idempotency-Key` 和等价规范化 Payload 重放请求时，系统应返回同一 Product，且不得创建第二条 Product、第二条发号记录或第二条成功审计。
4. 当相同 `Idempotency-Key` 被不同操作者使用，或与不同规范化 Payload 组合使用时，Server 应返回 `409 PRODUCT_CREATE_IDEMPOTENCY_CONFLICT`。
5. 当编号已派发但 Product 事务确定失败时，系统应保留发号记录并允许相同 Key、相同 Payload 的人工重试继续使用同一编号；不得回收或改派已消费编号。
6. 当 `PRODUCT` Rule 缺失、未启用、没有 Active Version、配置无效或容量耗尽时，Server 应失败关闭，不得本地拼接或伪造编号。
7. 当 Product 已创建后响应丢失时，相同 Key 的人工重放应通过已派发 `productNo` 对账并返回现有 Product。

### Requirement 5 - 金额与币种

#### Acceptance Criteria

1. 当台币销售价提交时，Server 应要求 `currency="TWD"`；当马币销售价提交时，应要求 `currency="MYR"`。
2. 当采购成本首次展示时，Web 应默认选择 `CNY`；用户可改选当前有效货币。
3. 当采购成本币种提交时，Server 应确认该币种存在且当前启用，不得只信任 Web Catalog。
4. 当任一金额为空时，系统应保存 `null` 并仍保存其独立币种代码。
5. 当任一金额非空时，系统应使用严格十进制字符串校验，不得经过 JavaScript `number` 或浮点换算。
6. 当金额为负数、包含分组符/符号/科学计数法、超过币种精度或超过 `DECIMAL(30,4)` 边界时，Server 应返回对应字段错误且不得派发编号。
7. 当货币 Catalog 加载失败时，页面应保留用户已输入的金额草稿，但阻止提交并提供重试入口。
8. 当用户切换采购成本币种时，系统不得自动换算或改写金额。

### Requirement 6 - 产品属性

#### Acceptance Criteria

1. 当用户添加属性时，页面应创建独立的标题和值输入，并提供清晰的可访问名称。
2. 当用户删除、上移或下移属性时，系统应立即更新可见序号但保持其他项值和对象引用隔离。
3. 当属性超过 50 项、标题/值为空白或超过长度边界时，Web 与 Server 应给出字段级错误并拒绝提交。
4. 当多个属性标题相同时，系统应按输入顺序原样保存，不得自动合并。
5. 当客户端提交含未知 Attribute 属性、非数组值或非对象条目时，Server 应拒绝整个请求。
6. 当属性列表为空时，系统应保存 `[]`。

### Requirement 7 - 媒体延期边界

#### Acceptance Criteria

1. 当用户打开创建页时，系统应展示简短说明，明确图片与视频将在后续功能中补充。
2. 当本期创建 Product 时，Server 应固定保存 `mainImage=null`、`images=[]`、`videos=[]`。
3. 当客户端尝试在创建请求中提交 `mainImage`、`images` 或 `videos` 时，Server 应按未知字段拒绝，不得静默接收。
4. 本期不得新增上传 API、对象存储依赖、签名 URL、媒体预览、URL 输入或媒体审计字段。

### Requirement 8 - Product 写事务与审计

#### Acceptance Criteria

1. 当 Product insert 开始时，Command Service 应创建事务，并把事务 timeout 设置为第一条 SQL。
2. 当供应商非空时，系统应按既有锁序在 Product insert 前完成字典有效性校验。
3. 当 Product 创建成功时，Server 应在同一事务中写入 `PRODUCT_CREATED` 成功审计。
4. 当 Product insert 或 Audit 任一失败时，该 Product 事务应整体回滚；已独立提交的编号发号记录不回收。
5. 当写入审计时，系统应记录可信操作者、Product ID、requestId、productNo、status、是否选择供应商、价格字段存在性和 attribute count；不得记录完整属性值、金额、原始幂等键或完整请求体。
6. 当 Product 创建成功时，`createdByUserId` 与 `updatedByUserId` 应同时等于当前可信 Session User ID，`version` 应为 1。
7. 当同一幂等创建返回既有 Product 时，系统不得重复写入 `PRODUCT_CREATED`。

### Requirement 9 - 公共 API 契约

#### Acceptance Criteria

1. 当客户端创建产品时，系统应提供 `POST /api/products`，operationId 固定为 `products_create`，成功状态为 `201`，响应复用完整 Product Item DTO。
2. 当调用 `POST /api/products` 时，系统应要求 Session、`products:create`、CSRF 与合法 `Idempotency-Key`。
3. 当输入字段校验失败时，API 应返回 `422 VALIDATION_FAILED` 和安全字段错误。
4. 当 Active 缺少供应商、供应商不可用、采购币种不可用或编号规则不可用时，API 应返回稳定业务错误码和可操作的中文公开消息。
5. 当幂等语义冲突时，API 应返回 `409 PRODUCT_CREATE_IDEMPOTENCY_CONFLICT`。
6. 当请求无权、密码必须修改或 CSRF 失败时，API 应沿用既有 `403` 错误契约。
7. 当发生未知持久化或编号内部错误时，API 应返回安全错误，不得泄露 SQL、连接信息、编号配置或 Payload。
8. 所有响应应使用 private no-store，并由 OpenAPI snapshot 与 generated Web types 作为双端契约。
9. 本期不得增加 Product update、status、detail、delete、media 或 generate HTTP operation。

### Requirement 10 - 创建页面结构与视觉规范

#### Acceptance Criteria

1. 当创建页渲染时，系统应使用既有 `FaPageHeader + FaPageMain` 页面骨架和 Fantastic-admin/Fa/Tailwind 组件语言。
2. 在桌面视口中，页面应采用左侧主要资料/价格/属性、右侧状态/供应商/自动编号说明的不对称信息布局，并保持清晰阅读顺序。
3. 在窄屏视口中，页面应收敛为单列，内容不得横向滚动，所有主要触控目标至少为 44px。
4. 页面应使用既有 `Noto Sans SC`，编号和金额使用 `Noto Sans Mono`；不得引入其他字体。
5. 页面应只消费既有 `background/foreground/muted/primary/destructive` 等语义 Token，兼容 Light/Dark 与用户主题，不硬编码另一套产品主题。
6. 页面图标应使用现有 Lucide/FaIcon，不得使用 Emoji、图片图标或新图标依赖。
7. 页面应提供“创建产品”和“取消”主操作；提交期间两者与所有可变字段应进入一致锁定状态，阻止同步重复提交。
8. 当表单存在未保存修改且用户取消或离开路由时，系统应要求确认；创建成功或显式放弃后不得再次提示。

### Requirement 11 - 表单校验与可访问性

#### Acceptance Criteria

1. 当用户提交无效表单时，页面应展示字段级错误、安全摘要和可选 requestId，并滚动聚焦第一个错误字段。
2. 当仅使用键盘时，用户应能完成状态、供应商、三组金额、属性增删/排序、提交、取消和错误重试。
3. 当用户启用 Reduced Motion 时，页面应停止非必要持续动画。
4. 当组件加载、失败、空选项或不可用时，页面应提供可理解的文字状态，不得只以颜色或图标表达。
5. 当提交进行中时，页面应暴露可访问的 busy 状态；完成后焦点应进入成功提示或首个错误。
6. 当 Server 返回未知字段路径时，页面应使用安全表单级错误，不得把不可信路径插入 DOM selector。

### Requirement 12 - 提交结果与导航

#### Acceptance Criteria

1. 当创建成功且用户具有 `products:read` 时，页面应显示包含 `productNo` 的成功 Toast，并导航到产品列表。
2. 当创建成功但用户缺少 `products:read` 时，页面应显示成功摘要、产品编号和“继续新增”，不得导航到无权页面。
3. 当 Server 返回确定性 `4xx` 时，页面应允许修正表单；Payload 变化后应生成新的幂等键。
4. 当网络错误或 `5xx` 使结果未知时，页面应冻结本次规范化 Payload 与 Key，禁止编辑，并明确说明不会自动重放。
5. 当结果未知时，页面应提供用户主动触发的“使用相同请求重新确认”操作；该操作必须复用同一 Payload 与 Key。
6. 当人工重放确认创建成功时，页面应进入正常成功路径；当确认幂等冲突时，应停止重放并要求人工核查。
7. 当用户显式放弃结果未知状态时，系统应清除内存中的 Key 与 Payload，不得持久化到 LocalStorage、SessionStorage 或日志。

### Requirement 13 - 并发、安全与隐私

#### Acceptance Criteria

1. 当两个相同 Key、相同 Payload 的请求并发到达时，系统应最终只存在一个 Product、一个编号 issuance 和一个创建审计。
2. 当两个不同 Key 创建相同业务内容时，系统应把它们视为两次独立创建并派发不同编号；本期不增加名称唯一约束。
3. 当 Product 唯一编号竞态发生时，Server 应只按可信约束名处理，不得解析数据库错误正文。
4. 当记录日志、异常或审计时，系统不得输出 Cookie、Token、数据库 URL、原始幂等键或完整创建 Payload。
5. 创建页不得把表单草稿、幂等键或完整错误响应写入浏览器持久化存储。
6. Web 的 unsafe mutation 不得启用 Axios 通用自动重试。

### Requirement 14 - 自动化验证

#### Acceptance Criteria

1. Server 单测应覆盖 DTO、规范化、金额、属性、供应商有效性、编号映射、幂等重放/冲突、事务、审计和持久化错误映射。
2. 隔离 PostgreSQL API E2E 应覆盖无权/CSRF、成功创建、自动编号、Active 供应商要求、金额/属性持久化、审计、相同 Key 重放、Payload 冲突和编号不可用。
3. OpenAPI 契约测试应精确新增 `products_create`，并证明不存在未授权 Product 写 operation。
4. Web API/View 测试应覆盖 generated types、Header、禁止自动重试、字段校验、MoneyInput、QsDictionarySelect、属性顺序、权限变化、提交锁、未知结果与导航。
5. 真实 Chrome 应覆盖桌面与窄屏创建主路径、键盘可操作性、产品列表新增入口及创建后的列表回显。
6. 最终验收应运行 Server/Web 全量检查、根治理、contract check、隔离 E2E、生产构建、diff-check 与工作树检查。

## 7. UI Design Specification

### 7.1 Purpose Statement

页面面向高频维护产品资料的后台人员，需要降低字段遗漏、币种混淆和错误提交风险。视觉重点是“快速扫描、明确分区、稳定提交”，而不是营销展示。

### 7.2 Aesthetic Direction

采用 `Industrial/utilitarian`：信息密度克制但不空泛，使用清晰边界、数据型排版和稳定操作区，延续现有管理后台而不创建独立视觉子系统。

### 7.3 Color Palette

参考色：

- Ink `#0F172A`
- Paper `#FFFFFF`
- Mist `#F1F5F9`
- Functional accent `#0F766E`
- Destructive `#DC2626`

实现不得直接建立上述硬编码主题；只消费现有语义 Token，使用户选择的 Primary Theme 和 Light/Dark 状态继续生效。

### 7.4 Typography

- 正文与表单：`Noto Sans SC`
- 编号、金额、币种代码：`Noto Sans Mono`

### 7.5 Layout Strategy

- Desktop：约 `8/4` 的非对称双栏；左栏按基础资料、价格、属性纵向推进，右栏集中状态、供应商、自动编号和媒体延期说明。
- Tablet：保留主次顺序，必要时收敛右栏但不改变 DOM 阅读顺序。
- Mobile：单列；页面级操作在可视区域内保持稳定，属性操作按序换行，不出现横向滚动。
- 视觉表面复用 Fa 容器、边框、Alert 和表单组件；不增加装饰性渐变、玻璃拟态或持续动效。

## 8. 非目标

- 不实现媒体上传、拖拽、对象存储、URL 输入、预览、排序或删除。
- 不实现产品详情、编辑、状态流转、删除、批量操作、导入导出或复制产品。
- 不修改 Product 表字段、产品状态枚举或现有产品列表查询语义。
- 不新增 Supplier Model、Supplier API、Supplier Store、供应商权限或供应商专用选择器。
- 不新增公开编号生成 API，不允许客户端提交 `productNo`。
- 不实现产品名称查重、SKU、库存、分类、品牌、单位、条码、税率或汇率换算。
- 不修改公共 Qs/Fa 组件契约，不新增第三方依赖。
- 不自动应用 migration 到持久开发数据库，不 push、创建 PR、merge 或部署。

## 9. 风险与失败关闭

| 风险 | 失败关闭要求 |
| --- | --- |
| 编号已消费但 Product 写入失败 | 保留 issuance；相同 Key 人工重试复用编号，不回收编号 |
| 创建提交结果未知 | 冻结 Payload/Key，禁止自动重放，仅允许用户显式同请求确认 |
| 相同 Key 携带不同 Payload | 返回幂等冲突，不覆盖、不创建 |
| 供应商在选择后停用 | Server 事务内重验，拒绝 Product 与 Audit |
| 采购币种停用 | Server 重验，拒绝写入 |
| Audit 写入失败 | Product 事务回滚，编号 issuance 不回收 |
| 权限或身份切换 | Abort 旧请求并阻断迟到响应写回 |
| 不可信数据库错误 | 仅按 Prisma/PostgreSQL code 与 constraint 白名单映射 |
| 属性或金额畸形 Payload | DTO 和领域规范化双层拒绝，不依赖前端校验 |

## 10. Phase Gates

### Gate R - Requirements

- [ ] 用户确认本文字段、校验、幂等、失败恢复、页面结构和非目标。

### Gate D - Design

- [ ] Requirements 确认后编写 `specs/product-create/design.md`。
- [ ] 单独确认公共 API、审计枚举 migration、编号/Product 幂等事务和 Web 状态机设计。

### Gate T - Tasks

- [ ] Design 确认后编写 `specs/product-create/tasks.md`。
- [ ] Tasks 确认后才进入 TDD 实施。

### Gate DB - 持久数据库

- [ ] 新 migration 只在可销毁隔离 PostgreSQL 中自动验证。
- [ ] 应用到 `qianshu_dms_dev` 或其他持久数据库前必须重新展示影响并取得明确确认。

### Gate E - 外部动作

- [ ] push、PR、merge、部署与非本地数据库变更继续需要独立授权。
