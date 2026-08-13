# 产品列表需求规格

## 1. 文档状态

- 状态：Phase 4 与搜索增量本地实施完成
- 需求确认日期：2026-08-12
- 技术方案确认日期：2026-08-12
- 适用范围：`server/`、`web/apps/qsmds-arco`
- 实施分支：`feat/admin-product-management`
- 当前基线：Product Schema、只读列表 API、名称/编号搜索、正式列表页面与自动化验收均已实现
- 当前门禁：Gate D1 与 Gate D2 已完成；push、PR、merge 与部署仍需 Gate E

## 2. 背景与目标

管理员工作台原有“产品管理”导航与 `products:read`、`products:create` 两项最小权限。本期已在该边界内建立 Product 持久化模型、唯一只读列表 API 与正式产品列表；“新增产品”路由继续保持占位语义。

本需求建立产品数据的首期只读管理切片：新增能够承载产品基础资料、供应商、媒体、价格、属性和审计信息的数据结构；提供受权限保护的分页列表接口；使用 `FaPageHeader + FaPageMain + QsGenericTable` 实现正式列表页面。真实新增、查看和编辑流程不在本期实现，相关入口只提供明确的轻提示。

供应商已经退化为系统字典。产品只保存 `service_provider.supplier` Dictionary Item 的稳定 `value`，不得恢复独立 Supplier 主数据、专用 API、Store、权限或选择器。

## 3. 用户故事

### 3.1 产品运营人员

作为产品运营人员，我希望在统一列表中查看产品编号、名称、状态、供应商、媒体、价格、属性和审计信息，并按产品名称/编号搜索、按供应商筛选，以便快速确认产品资料。

### 3.2 产品维护人员

作为具有产品创建权限的维护人员，我希望在列表页看到“新增产品”入口，同时明确知道真实新增功能尚未开放，避免误以为点击已经创建数据。

### 3.3 系统维护者

作为系统维护者，我希望产品编号、金额、供应商历史值和列表权限遵守现有 Numbering、Currency、Dictionary、OpenAPI 与审计约束，避免为产品域建立重复基础设施。

## 4. 已确认业务决策

1. 产品状态固定为 `DRAFT`、`ACTIVE`、`INACTIVE`。
2. 台币销售价、马币销售价和采购成本价的金额均允许为 `null`，币种仍独立持久化。
3. `DRAFT` 允许 `supplierValue=null`；产品进入 `ACTIVE` 时必须关联当时有效的供应商字典值。
4. `INACTIVE` 可以保留已停用或未知的历史供应商值。
5. 操作列本期显示“查看”和“编辑”，两者点击后只显示轻提示。
6. 视频列使用“图标 + 数量”入口，点击后在只读弹窗中显示地址列表和预览。
7. 产品图片列使用 `ImageGroup maxCount=3`；接受超过三个位置时展示两张缩略图和一个 `+N` 溢出入口的既有语义。
8. 产品编号只能由编号管理的 `PRODUCT` Rule 派发。
9. 产品列表搜索只覆盖产品名称与产品编号，使用不区分大小写的包含匹配；不得伪造当前页本地搜索。

## 5. 术语与数据口径

### 5.1 Product

本规格中的 Product 是产品级基础记录，不引入 SPU、SKU、库存、渠道商品、组合商品或变体模型。

### 5.2 产品编号

产品编号是 `PRODUCT` Numbering Rule 的生成结果。客户端不得提交、覆盖或重新计算产品编号；编号一旦分配即保持唯一且不可修改。本期没有真实创建接口，因此列表读取和占位按钮均不得触发发号。

### 5.3 供应商值

- 持久化字段名：`supplierValue`。
- 字典 Type code：`service_provider.supplier`。
- 持久化内容：Dictionary Item 的稳定 `value` 字符串。
- 禁止内容：旧 Supplier UUID、Dictionary Item UUID、复制的 Label 或名称快照。
- `EFFECTIVE`：Type 与 Item 当前均启用。
- `DISABLED`：值已知，但 Type 或 Item 当前停用。
- `UNKNOWN`：当前 Catalog 中不存在该 raw value。

供应商有效性是写入时规则。供应商字典后续被停用时，系统不得静默修改既有产品状态或供应商值；列表应保留产品数据并把供应商标识为历史值。

### 5.4 金额

金额由十进制金额和三位币种代码组成。数据库使用 `DECIMAL/NUMERIC`，HTTP JSON 使用十进制字符串或 `null`，不得经过 JavaScript `number`。币种代码独立持久化：台币销售价为 `TWD`，马币销售价为 `MYR`，采购成本价默认 `CNY`。

### 5.5 媒体与产品属性

- `mainImage`：单一主图 URL，可空。
- `images`：有序图片 URL 列表，默认空列表，不重复包含主图。
- `videos`：有序视频 URL 列表，默认空列表。
- `attributes`：有序 `{ title, value }` 列表，默认空列表。

## 6. 功能需求

### Requirement 1 - 首期范围与只读边界

#### Acceptance Criteria

1. 当本期交付完成时，系统应提供产品持久化结构、产品分页列表 API 和正式产品列表页面。
2. 当用户点击本期任何产品入口时，系统不得创建、更新、启用、停用或删除产品。
3. 当本期实现 Server HTTP 能力时，系统应只新增列表读取接口，不得新增产品创建、详情、更新、状态变更或删除接口。
4. 当数据库 migration 执行时，系统不得插入演示产品、复制旧分支产品数据或修改 `PRODUCT` Numbering Rule 和供应商字典数据。
5. 当既有 `/admin/products/create` 占位路由仍存在时，本期不得把它解释为真实创建流程；其后续处置不属于产品列表范围。

### Requirement 2 - Product 数据结构

#### Acceptance Criteria

1. 当 Product 结构建立时，系统应使用数据库生成的 UUID 作为主键 `id`。
2. 当 Product 记录存在时，系统应保存非空 `name`、唯一 `productNo`、`status`、供应商、媒体、三组金额、属性和必要审计字段。
3. 当 Product 初始建立时，`status` 应默认为 `DRAFT`。
4. 当 Product 结构包含有序列表时，系统应保留 `images`、`videos` 与 `attributes` 的原始顺序。
5. 当列表对外返回 Product 时，系统应把技术主键用于行身份，但不得把 `id` 渲染为用户可见表格列。
6. 当 Product 使用并发版本字段时，系统不得把技术 `version` 作为默认业务展示列。

### Requirement 3 - 产品状态与供应商规则

#### Acceptance Criteria

1. 当 Product 状态被持久化时，系统应只接受 `DRAFT`、`ACTIVE` 或 `INACTIVE`。
2. 当 Product 为 `DRAFT` 时，系统应允许 `supplierValue=null`。
3. 当未来写流程把 Product 置为 `ACTIVE` 时，系统应要求 `supplierValue` 非空，并在调用方事务内确认 `service_provider.supplier` Type 与 Item 当时均有效。
4. 当 Product 为 `INACTIVE` 时，系统应允许保留有效、停用或未知的非空供应商历史值。
5. 当读取已停用或未知供应商时，系统应保留精确 raw `supplierValue`，不得清空、替换或回退到其他供应商。
6. 当供应商字典在产品启用后发生变化时，系统应保持产品状态和持久化值不变，并在读取结果中暴露当前解析状态。

### Requirement 4 - 产品编号边界

#### Acceptance Criteria

1. 当未来创建 Product 时，Server 应通过 `NumberingGeneratorService` 和 `ruleCode="PRODUCT"` 获取 `productNo`。
2. 当产品列表加载、筛选、打开弹窗或点击占位操作时，系统不得调用编号生成器。
3. 当 Product 记录存在时，`productNo` 应全局唯一、非空且不可由客户端修改。
4. 当实施环境缺少已发布且启用的 `PRODUCT` Rule 时，未来创建流程应失败关闭，不得生成本地回退编号；只读列表仍应保持可用。

### Requirement 5 - 金额与币种

#### Acceptance Criteria

1. 当系统保存任一价格时，应分别保存金额和币种代码，不得把符号或格式化文本写入金额字段。
2. 当价格金额为空时，系统应保存 `null`，不得将空值改写为零。
3. 当台币销售价存在时，其币种应为 `TWD`；当马币销售价存在时，其币种应为 `MYR`。
4. 当采购成本价尚未由业务流程显式选择币种时，其币种应默认为 `CNY`。
5. 当金额通过 HTTP 返回时，系统应返回十进制字符串或 `null`，不得返回二进制浮点数。
6. 当列表展示金额时，Web 应使用 `AmountDisplay` 和当前 Currency Catalog；Catalog 暂不可用时仍应保留原始金额与币种代码。
7. 当金额非空时，系统不得接受负数。

### Requirement 6 - 媒体与属性数据

#### Acceptance Criteria

1. 当 Product 没有主图时，`mainImage` 应为 `null`；没有附加媒体或属性时，相应列表应为空列表而不是 `null`。
2. 当 Product 返回图片和视频时，系统应保持持久化顺序，不得按 URL 或名称重新排序。
3. 当 Product 返回属性时，每项应包含非空 `title` 和 `value`，并保持原始顺序。
4. 当产品列表展示主图时，Web 应把 `mainImage` 映射为单项 `ImageGroup`。
5. 当产品列表展示附加图片时，Web 应使用 `ImageGroup maxCount=3`；溢出入口应能打开整组预览。
6. 当产品没有有效图片时，图片单元格应显示稳定空态，不得渲染损坏的空 URL。
7. 当用户点击视频入口时，系统应打开只读视频弹窗并允许在地址列表中选择预览；不支持或加载失败时应保留可访问的原始链接。
8. 当用户点击属性入口时，系统应在只读弹窗中完整展示全部属性；Hover 反馈不得成为触屏或键盘用户的唯一访问方式。

### Requirement 7 - 审计字段

#### Acceptance Criteria

1. 当 Product 结构建立时，系统应包含 `createdAt`、`updatedAt`、`createdByUserId`、`updatedByUserId` 和正整数 `version`。
2. 当创建人或更新人为空时，列表应显示 `—`，不得伪造用户名称。
3. 当用户记录的展示名称变化时，产品列表应显示当前用户展示名称，同时保留 Product 中的用户 UUID 关系。
4. 当本期只有读取能力时，系统不应新增虚假的 Product Mutation AuditEvent；真实写流程的 Audit 类型与内容在对应功能设计时单独确认。

### Requirement 8 - 产品列表 API

#### Acceptance Criteria

1. 当具有 `products:read` 权限的用户请求产品列表时，Server 应返回分页 Product 数据。
2. 当用户缺少 `products:read` 权限或需要修改密码时，Server 应拒绝列表访问且不得返回产品数据。
3. 当请求包含 `supplierValue` 时，Server 应按精确 raw value 过滤，不得按 Label 模糊匹配或将值规范化为另一个供应商。
4. 当请求未包含 `supplierValue` 时，Server 应返回所有供应商范围内的数据。
5. 当请求包含 `keyword` 时，Server 应先去除首尾空白，再对 `name` 或 `productNo` 执行不区分大小写的包含匹配。
6. 当 `keyword` 与 `supplierValue` 同时存在时，Server 应按 `keyword AND supplierValue` 组合条件，不得扩大结果集。
7. 当请求未包含 `keyword` 时，Server 不应增加隐式搜索条件。
8. 当 Server 返回供应商时，应同时返回 raw value、当前 Label（若已知）及 `EFFECTIVE/DISABLED/UNKNOWN` 解析状态。
9. 当一页包含重复供应商值时，Server 应批量解析去重后的值，不得对每一行产生一次独立字典查询。
10. 当列表没有记录时，Server 应返回空 `items` 和 `total=0`，不得返回 `null` 或 404。
11. 当请求分页、关键词或供应商筛选值不合法时，Server 应返回稳定的输入校验错误；`keyword` 应为 1 到 128 个 Unicode code points 的非空白字符串。
12. 当返回结果顺序未由用户指定时，Server 应按 `updatedAt DESC, id DESC` 提供稳定顺序。

### Requirement 9 - 页面结构与权限

#### Acceptance Criteria

1. 当产品列表页面渲染时，Web 应使用 `FaPageHeader + FaPageMain + QsGenericTable`，不得建立第二套页面容器或表格内核。
2. 当用户具有 `products:read` 权限时，页面应加载列表；失去权限或身份域变化后，页面应停止旧请求并清除不再可信的产品数据。
3. 当用户同时具有 `products:create` 权限时，页头应显示带 Lucide Plus 图标的“新增产品”按钮；没有创建权限时不得显示该按钮。
4. 当页头已经提供新增入口时，`QsGenericTable` 自身的新增入口应关闭。
5. 当用户提交或清空搜索时，页面应使用 `QsGenericTable` 内建搜索入口、回到第一页并只发起一次最终 Server 请求。
6. 当列表加载、刷新、失败、重试、空数据或无筛选结果时，页面应复用 `QsGenericTable` 的稳定状态。

### Requirement 10 - 表格列与列设置

#### Acceptance Criteria

1. 当表格首次展示时，应按“行号、产品编号、产品名称、产品状态、供应商、产品主图、产品图片、产品视频、台币销售价、马币销售价、采购成本价、产品属性、创建时间、创建人、更新时间、更新人、操作”顺序建立列。
2. 当表格渲染行号时，`QsGenericTable` 应保持行号为最左侧固定列；产品编号应默认固定在其后方左侧。
3. 当表格提供操作列时，操作列应固定在右侧且不参与列显隐。
4. 当用户打开列设置时，除行号、操作列和隐藏的技术字段外，业务列应支持显隐、左右固定与对齐配置。
5. 当用户调整列设置时，表头、单元格和响应式展示应同步更新。
6. 当表格渲染产品时，`id` 和 `version` 不应作为可见列。
7. 当桌面表格宽度超过内容区时，滚动应限制在表格区域，固定列边界应保持清晰，不得造成页面级横向溢出。

### Requirement 11 - 特殊单元格与只读弹窗

#### Acceptance Criteria

1. 当产品状态显示时，系统应同时使用文字与 `FaTag` 语义样式，不得只依赖颜色区分状态。
2. 当供应商有效时，供应商列应显示当前 Label；停用时应显示 Label 与“已停用”；未知时应显示 raw value 与“未知”。
3. 当产品图片显示时，图片点击、键盘导航、加载失败、空态和 Reduced Motion 应继续遵守 `ImageGroup` 公共契约。
4. 当金额显示时，三列金额应使用 `AmountDisplay`，并使用右对齐与 `tabular-nums` 数据排版。
5. 当属性列表为空时，属性列应显示 `—`；非空时应显示“`N 项属性`”可聚焦按钮。
6. 当视频列表为空时，视频列应显示 `—`；非空时应显示“`N 个视频`”可聚焦按钮。
7. 当属性或视频弹窗打开时，系统应使用 `QsGenericModal`，支持 Escape、明确关闭按钮、焦点约束、窄屏适配和可访问标题。

### Requirement 12 - 供应商下拉筛选

#### Acceptance Criteria

1. 当供应商 Catalog 可信加载时，页面应从 `service_provider.supplier` Catalog 构建 `QsGenericTable` 的供应商筛选选项。
2. 当构建筛选选项时，展示文本应使用 Label，提交值应使用精确稳定 `value`，不得使用 UUID 或 Label 作为查询值。
3. 当 Catalog 包含停用条目时，筛选列表应保留该条目并在 Label 中标识“已停用”，因为读取筛选不等同于新写入选择。
4. 当用户应用或清空供应商筛选时，页面应回到第一页并只发起一次最终列表请求。
5. 当 Catalog 正在加载、缺失或失败时，页面应保持产品列表可用，并显示独立的安全状态；失败时应提供重试，不得把加载失败显示为“暂无供应商”。
6. 当筛选 Catalog 暂不可用但已有 `supplierValue` 条件时，页面应保留该 raw 条件并允许用户清除，不得静默改变结果集。
7. 当供应商筛选启用时，页面应复用 `QsGenericTable` 的筛选面板；不得为产品域修改 `QsGenericTable` 或新增 Supplier 专用选择器。
8. 当未来真实产品表单选择供应商时，表单应使用 `QsDictionarySelect dictionaryCode="service_provider.supplier"`；该表单不属于本期交付。

### Requirement 13 - 占位操作

#### Acceptance Criteria

1. 当用户点击页头“新增产品”时，系统应通过 `QsToast.info` 提示“新增产品功能将在后续版本开放”，不得导航或发起请求。
2. 当用户点击操作列“查看”时，系统应提示“产品详情功能将在后续版本开放”，不得打开详情或发起请求。
3. 当用户点击操作列“编辑”时，系统应提示“产品编辑功能将在后续版本开放”，不得打开表单或发起请求。
4. 当本期操作均无写副作用时，系统不应新增 `products:update` 权限；真实编辑功能设计时再扩展权限目录。

### Requirement 14 - 响应式、主题与无障碍

#### Acceptance Criteria

1. 当视口宽度至少为 `768px` 时，页面应使用桌面表格、固定列和页头右侧操作区。
2. 当视口宽度小于 `768px` 时，`QsGenericTable` 应使用其既有结构化卡片表现，并保留同一组业务数据与底部操作区。
3. 当视口宽度小于 `640px` 时，按钮、筛选项、弹窗操作和媒体入口的触控目标应至少为 `44px`。
4. 当系统处于暗色主题时，表格、固定列、Tag、弹窗、图片、视频、错误和空态应保持可读对比度。
5. 当用户仅使用键盘时，应能提交/清空搜索、操作列设置、供应商筛选、图片预览、属性弹窗、视频弹窗和占位按钮，不得形成焦点陷阱。
6. 当用户启用 Reduced Motion 时，页面与复用组件应停止非必要持续动画。
7. 当界面展示图标时，系统应使用项目现有 Lucide/FaIcon，不得使用 Emoji。

### Requirement 15 - 安全、测试与交付

#### Acceptance Criteria

1. 当产品列表 API 返回数据时，应使用私有 `no-store` 缓存策略，不得把受保护产品数据写入公共缓存。
2. 当页面或 Server 处理失败时，日志、Toast、Alert 和测试输出不得包含 Token、Cookie、连接字符串、完整敏感请求体或不可信响应内容。
3. 当实现 Schema、API 或页面逻辑时，开发应先建立失败测试，再完成最小实现和重构。
4. 当 OpenAPI 发生变化时，开发应通过根 `contract:sync` 生成 Server/Web snapshot 与 Web types，不得手工编辑生成产物。
5. 当数据库 Schema 实施时，应使用新的 forward migration 并在隔离 PostgreSQL 中完成空库重放、约束和权限验证，不得修改既有 migration。
6. 当本期交付验收时，Schema、Server 单元测试、API E2E、Web API/View 测试、真实 Browser 回归、OpenAPI 契约、构建、根治理和 `git diff --check` 应全部通过。
7. 当任一验证失败时，维护者应如实报告，不得跳过失败后声称完成。

## 7. UI Design Specification

```text
Purpose Statement:
  为产品运营人员提供高密度但可辨认的产品资料总览，让编号、供应商、媒体、价格、
  属性和审计信息在同一工作区内可扫描、可筛选、可预览。

Aesthetic Direction:
  Industrial/utilitarian。

Color Palette:
  #FFFFFF（light background）、#09090B（foreground）、#F4F4F5（muted）、
  #E4E4E7（border）、#15803D（primary anchor）；实现仅使用现有语义 Token，
  继续适配用户选择的主题和暗色模式。

Typography:
  页面与普通中文内容使用 Noto Sans SC；产品编号、金额和技术 raw value 使用
  Noto Sans Mono 或项目既有数据语义类。

Layout Strategy:
  使用非居中的全宽管理工作区：页头标题与右侧新增动作形成不对称重心，主体由
  可横向滚动的高密度表格占据；窄屏转换为纵向卡片，不引入装饰性 Hero、渐变或
  第二套卡片系统。
```

## 8. 明确不做

- 不实现产品新增、详情、编辑、启用、停用或删除 API。
- 不实现真实新增、查看或编辑界面。
- 不引入 `products:update`、`products:enable`、`products:disable` 或 `products:delete` 权限。
- 不实现 SPU、SKU、规格变体、库存、仓库、品牌、分类、渠道或供应链关系。
- 不恢复独立 Supplier Model、API、Store、路由、权限或编号规则。
- 不创建 Supplier 专用下拉组件；未来表单复用 `QsDictionarySelect`。
- 不实现媒体上传、转码、对象存储签名、封面抽帧或视频编辑。
- 不实现价格换算、汇率快照、税价或多币种汇总。
- 不引入 PostgreSQL 全文检索、拼音/分词搜索、状态筛选、批量操作、导入导出或列设置服务端持久化。
- 不插入演示产品，不从已删除的历史产品方案恢复任何数据或代码。
- 不修改或删除既有 migration，不手工编辑 OpenAPI 生成产物。
- 不自动 push、创建 PR、merge、部署或对非本地数据库执行 migration。

## 9. Phase 1 冻结结论

本文件第 4 节的前八项业务决策以及首期 Acceptance Criteria 已于 2026-08-12 确认；同日另行确认第九项名称/编号搜索增量。若技术设计需要新增真实写接口、扩大权限、改变供应商存储口径、改变金额协议、删除现有路由或扩展 Product 领域模型，必须重新确认。

## 10. Phase 4 验收结论

本规格的首期只读切片及搜索增量已于 2026-08-12 在 `feat/admin-product-management` 完成本地实现与自动化验收：Product Schema、带 `keyword`/`supplierValue` 的 `GET /api/products`、供应商历史解析、OpenAPI/Web generated contract、正式列表、响应式卡片、媒体/金额/属性展示、名称/编号搜索、供应商筛选和占位动作均已落地。最终验证覆盖隔离 PostgreSQL migration/API E2E、Server/Web 全量检查、production build、根治理和真实 Chrome。

Gate D2 已获得单独授权，`20260812090000_product_list_schema` 已成功应用到 `qianshu-dms-dev-postgres`，迁移后 Prisma 状态、表、枚举、约束、索引、触发器、函数和健康检查均通过。Gate E 未授权；本地结果没有 push、PR、merge 或部署。
