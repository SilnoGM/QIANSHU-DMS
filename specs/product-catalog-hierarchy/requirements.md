# 产品分类与产品头改造：勘察结果与需求方案

## 1. 文档状态

- 状态：**历史勘察稿**；最终口径与实施结果见 `implementation.md`
- 编写日期：2026-10-18
- 实施分支：`feat/product-catalog-hierarchy`
- 适用范围：`server/`、`web/apps/qsmds-arco`

> **2026-10-18 最终口径**：分类/产品头已升级为独立目录实体
> （供应商 → 分类 → 产品头 → 产品），分类按 `(supplier_value, name)` 唯一、产品头按
> `(category_id, name)` 唯一；所有产品供应商必填；产品状态只保留 `ACTIVE/INACTIVE`，
> 新建默认启用、列表操作列启停；选品删除“全部供应商”并要求先选供应商；产品表单/选品显示
> 空分类与空产品头。本文件下方关于“两个文本字段、无独立字典表、2xl 弹窗、全部供应商”的
> 描述已被最终实现取代，仅作为勘察记录保留。

## 2. 目标与边界

### 2.1 目标

1. 在 Product 上增加「分类」与「产品头」两个文本字段，形成 `分类 → 产品头 → 产品名` 的三层展示关系。
2. 新增/编辑产品时，分类与产品头使用「可选择已有值 + 可新建」的下拉控件。
3. 销售订单「选择数据库产品」弹窗增加左侧分类列，产品卡片按产品头分组，并支持主图点击放大。
4. 存量产品没有分类与产品头，需要给出可执行的兼容与补录方案。

### 2.2 明确不做

- 不新建分类表、产品头表或字典类型；分类与产品头只存在于 `products` 表的两个文本列。
- 不引入 SPU/SKU/变体模型，不改变产品编号、价格、媒体、属性等既有语义。
- 不修改销售订单明细的产品快照结构；分类与产品头只作为产品目录的查询与展示元数据。
- 本次不执行 migration、不改 `schema.prisma`、不生成 OpenAPI、不改任何业务代码。

## 3. 勘察结果

### 3.1 Product 表结构

真相源：`server/prisma/schema.prisma:850`，迁移：`server/prisma/migrations/20260812090000_product_list_schema/migration.sql`。

| 列 | 类型 | 可空 | 说明 |
| --- | --- | --- | --- |
| `id` | `uuid` | 否 | 主键，`gen_random_uuid()` |
| `name` | `varchar(128)` | 否 | 产品名称 |
| `product_no` | `varchar(64)` | 否 | 唯一产品编号，`PRODUCT` 规则派发 |
| `status` | `product_status` | 否 | `DRAFT / ACTIVE / INACTIVE`，默认 `DRAFT` |
| `supplier_value` | `varchar(64)` | 是 | 供应商字典 `service_provider.supplier` 的 stable value |
| `twd_sale_price_amount` | `numeric(30,4)` | 是 | 台币销售价，空为 `NULL` |
| `twd_sale_price_currency` | `char(3)` | 否 | 固定 `TWD` |
| `myr_sale_price_amount` | `numeric(30,4)` | 是 | 马币销售价 |
| `myr_sale_price_currency` | `char(3)` | 否 | 固定 `MYR` |
| `purchase_cost_amount` | `numeric(30,4)` | 是 | 采购成本价 |
| `purchase_cost_currency` | `char(3)` | 否 | 默认 `CNY` |
| `attributes` | `jsonb` | 否 | 有序 `{ title, value }[]`，默认 `[]` |
| `created_by_user_id` | `uuid` | 是 | 创建人 |
| `updated_by_user_id` | `uuid` | 是 | 更新人 |
| `version` | `integer` | 否 | 乐观锁版本，默认 1 |
| `created_at` | `timestamptz(6)` | 否 | 创建时间 |
| `updated_at` | `timestamptz(6)` | 否 | 更新时间 |

现有约束与索引（开发库核对）：

- `products_product_no_key` 唯一索引；`products_identity_immutable_trigger` 只允许 `id` 与 `product_no` 在 INSERT 后保持不变。
- `products_active_supplier_required_check`：`ACTIVE` 必须有 `supplier_value`。
- 名称、编号、供应商非空白 CHECK；三组金额非负 CHECK；属性必须是 JSON 数组。
- 查询索引：`(status, updated_at DESC, id DESC)`、`(supplier_value, updated_at DESC, id DESC)`、`(updated_at DESC, id DESC)`。
- 当前表**没有**分类、产品头、SPU/SKU 或任何层级字段。

结论：新增两个独立文本列是 additive 变更，不会触碰编号不可变触发器、金额约束或现有查询索引。

### 3.2 产品相关查询与接口

| 用途 | 接口 | 位置 | 现状 |
| --- | --- | --- | --- |
| 产品管理列表 | `GET /api/products` | `server/src/modules/products/products.controller.ts` | 按 `keyword`（名称/编号）、`supplierValue`、`status` 分页；按 `updatedAt DESC` 排序 |
| 产品详情 | `GET /api/products/:productId` | 同上 | 返回 `ProductListItemDto` |
| 新增产品 | `POST /api/products` | 同上 | `Idempotency-Key` + `PRODUCT` 编号，创建审计 |
| 编辑产品 | `PATCH /api/products/:productId` | 同上 | `expectedVersion` 乐观锁，只允许白名单字段 |
| 销售订单创建选品 | `GET /api/sales-orders/product-options` | `server/src/modules/sales-orders/sales-orders.controller.ts:193` | 仅 `ACTIVE`，支持 `currencyCode`、`keyword`、`supplierValue`、分页 |
| 销售订单编辑选品 | `GET /api/sales-orders/:salesOrderId/product-edit-options` | 同上 `:308` | 仅 `ACTIVE`，支持 `keyword`、分页 |
| 采购订单选品 | `GET /api/purchase-orders/product-options` | `server/src/modules/purchase-orders/purchase-orders.controller.ts:189` | 仅 `ACTIVE` + 指定供应商 + `purchaseCostCurrency='CNY'` |
| 产品选项主图 | 三条 `.../main-image/.../content` | 各控制器 | 返回主图内容，支持 `variant=thumb/poster` |

写路径与读路径的关键点：

- 创建与编辑共用 `normalizeProductCreateCommand`（`server/src/modules/products/product-command.normalizer.ts`），新增字段必须进入该规范化器、创建指纹和 update 白名单，否则会被全局 whitelist 拒绝。
- 创建幂等指纹当前版本是 `product.create.v1`（`server/src/modules/products/product-create-fingerprint.ts`）。新增字段进入 payload 后应升为 `product.create.v2`，避免旧 key 的等价性判断漂移。
- 产品列表、销售/采购选品都通过 Prisma `where` 构造查询，天然使用参数绑定。若分类去重使用 `$queryRaw`，必须使用 `Prisma.sql` + `${}` 占位符，禁止字符串拼接。

### 3.3 前端位置

- 产品管理页面：`web/apps/qsmds-arco/src/views/admin/product-management/`
  - 列表：`list/index.vue` + `list/product-list.logic.ts`
  - 新增：`create/index.vue` + `create/product-create.logic.ts`
  - 编辑：`edit/index.vue` + `edit/product-edit.logic.ts`
  - 表单：`form/product-form.vue` + `form/product-form.logic.ts`
  - 详情：`list/product-detail-drawer.vue`
- 产品选择器：`web/apps/qsmds-arco/src/components/business/QsProductSelector/`
  - 弹窗标题固定为「选择数据库产品」（`index.vue:347`）。
  - 当前尺寸为 `size="xl"` 加 `class="sm:!max-w-[68rem]"`（`index.vue:349-350`）。`QsGenericModal` 的标准档位中 `2xl` 就是 `68rem`（`QsGenericModal/logic.ts:12-20`），因此本次应改为 `size="2xl"` 并删除 class 覆盖。
  - 当前左列是产品检索结果，右列是「已选择的产品」，每页 20，滚动加载；产品卡片为单列横向行卡（`index.vue:423-479`）。
- 选择器调用链：
  - `QsOrderProductLineEditor`（`components/business/QsOrderProductLineEditor/index.vue:741`）渲染选择器。
  - 销售订单创建：`views/operations/sales-orders/create.vue:531` 的 `loadSalesOrderProducts`。
  - 销售订单编辑：`views/operations/sales-orders/index.vue:564` 的 `loadProductEditProducts`。
  - 采购订单创建：`views/operations/purchase-orders/create.vue:309` 的 `loadPurchaseProducts`。
  - 组件库示例：`views/component_library/business/components/ProductSelectorShowcase.vue`，使用 `fixtures/order-product.fixture.ts`。
- 图片预览：项目已有 `useFaImagePreview()`（`@fantastic-admin/components`），`ImageGroup` 也复用它。它支持多图、0.5x–3x 缩放、旋转、拖拽、Esc/点击遮罩关闭。选品卡片应直接使用它，而不是新写 lightbox。

### 3.4 现有数据现状

2026-10-18 对开发库 `qianshu_dms_dev` 的只读核对：

- `products` 共 **1 行**：`PROD/00001`，名称「测试」，状态 `ACTIVE`，供应商非空。
- `attributes` 只有 `[{"title":"马力","value":"25HP"}]`，没有任何分类、产品头或同类语义。
- 因为字段尚不存在，**所有环境存量产品的分类与产品头都必然为空**；这不是某一条数据的缺失，而是全量缺省。
- 未连接生产库；生产数据量未在本轮核对。实施前如需评估补录工作量，应另做一次只读盘点（按 `status`、供应商、名称前缀分组计数）。

## 4. 术语与数据口径

### 4.1 分类（categoryName）

产品所属的一级业务分类，例如「微耕机」「发电机」「水泵」。自由文本，不引用字典或外键。

### 4.2 产品头（productHeadName）

分类下的产品系列/型号族，例如「旱地履带」「四驱四轮」「水旱两用」。自由文本，不引用字典或外键。

### 4.3 层级

```text
分类（categoryName）
  └── 产品头（productHeadName）
        └── 产品（Product.name）
```

- 产品是唯一持久化实体；分类与产品头只是产品上的两个标签。
- 产品头必须归属于某个分类；同名产品头允许出现在不同分类下，因此分组键必须是 `(categoryName, productHeadName)`，不能只用产品头。
- 不做大小写折叠或同义词合并；写入时统一 `trim()` + NFC，去重按规范化后的精确字符串。

## 5. 数据结构方案

### 5.1 字段定义

| 字段 | DB 列 | 类型 | 可空 | 默认 | 约束 |
| --- | --- | --- | --- | --- | --- |
| `categoryName` | `category_name` | `varchar(64)` | 是 | `NULL` | trim + NFC 后 1..64 Unicode code points；非空白 |
| `productHeadName` | `product_head_name` | `varchar(64)` | 是 | `NULL` | trim + NFC 后 1..64 Unicode code points；非空白 |

长度取 64 的依据：与现有 `supplierValue` 的 64 长度一致，足以覆盖中文分类/系列名；不与产品名 `128` 混用，避免把长名称塞进层级标签。

### 5.2 数据库约束

建议新增三条约束：

1. `products_category_name_nonblank_check`：`category_name IS NULL OR btrim(category_name) <> ''`
2. `products_product_head_name_nonblank_check`：`product_head_name IS NULL OR btrim(product_head_name) <> ''`
3. `products_taxonomy_pair_check`：`(category_name IS NULL) = (product_head_name IS NULL)`

第 3 条保证「要么都空、要么都有值」，避免出现只有产品头没有分类的半层级数据。存量两列均为空，天然满足。

建议索引：

```sql
CREATE INDEX "products_category_head_name_idx"
  ON "products" ("category_name", "product_head_name", "name");
```

用途：分类去重、按分类/产品头分组排序。若后续分类过滤查询量明显增大，再评估 `(status, supplier_value, category_name, product_head_name, name)` 组合索引；当前产品量级不建议一次加太多索引。

### 5.3 写入规则（推荐默认值）

- **新增产品**：分类与产品头必填；产品头选项按当前分类过滤。
- **编辑产品**：
  - 历史产品（两列均为 `NULL`）允许继续留空保存，不阻塞价格、供应商等字段的日常修改。
  - 一旦填写，必须同时填写两者；保存后不允许单独清空其中一个。
  - 是否允许把两者一起清空回 `NULL`：推荐不允许（保持“已分类”事实），如需纠错就改选其他分类/产品头。
- **分类变更**：清空当前产品头，要求重新选择；若新产品头恰好属于新分类，可在一次 PATCH 中同时提交。
- **去重语义**：精确匹配（trim + NFC 后）；「微耕机」与「微耕机 」视为同一值；大小写不同的拉丁文本视为不同值，由 UI 的已有选项约束减少分裂。

### 5.4 迁移草案（仅方案，不执行）

```sql
ALTER TABLE "products"
  ADD COLUMN "category_name" varchar(64),
  ADD COLUMN "product_head_name" varchar(64);

ALTER TABLE "products"
  ADD CONSTRAINT "products_category_name_nonblank_check"
    CHECK ("category_name" IS NULL OR btrim("category_name") <> ''),
  ADD CONSTRAINT "products_product_head_name_nonblank_check"
    CHECK ("product_head_name" IS NULL OR btrim("product_head_name") <> ''),
  ADD CONSTRAINT "products_taxonomy_pair_check"
    CHECK (("category_name" IS NULL) = ("product_head_name" IS NULL));

CREATE INDEX "products_category_head_name_idx"
  ON "products" ("category_name", "product_head_name", "name");
```

迁移特性：

- 纯 additive，不扫描/重写业务行，不修改触发器，不需要停机。
- 存量行两列保持 `NULL`，满足 pair check。
- 不写默认值，不创建任何分类/产品头记录。
- 实施时需同步 `schema.prisma`、登记《数据库迁移规范》的迁移清单与说明，并走 `migrate deploy` 到隔离库验证后，再单独申请业务库应用授权。

### 5.5 API 契约变更概要

1. `ProductListItemDto` 增加：
   - `categoryName: string | null`
   - `productHeadName: string | null`
2. `CreateProductRequestDto` / `UpdateProductRequestDto` 增加同名字段；规范化规则为 `trim + NFC`、1..64 code points、`null` 或非空白。
3. 新增分类/产品头选项读取接口（用于新增/编辑页下拉）：
   - `GET /api/products/taxonomy-options`
   - 返回 `{ categories: [{ name, productHeads: string[] }] }`
   - 来源：所有产品的非空 `category_name` / `product_head_name` 去重；按名称稳定排序。
   - 权限建议 `products:read`；仅有 `products:create` 的账号如果拿不到选项，表单降级为「可自由输入新值」，不阻塞创建。若要求这类账号也能看到历史选项，需要再补一个 `products:create` 口径的读取接口或调整权限装饰器（见待确认）。
4. 三条产品选项接口的 item 增加 `categoryName` / `productHeadName`（可空）。
5. 三条产品选项接口的查询增加 `categoryName?: string` 与 `unclassified?: boolean`（互斥），并返回 `categories: [{ name: string, count: number }]` + `unclassifiedCount: number`，供左侧分类列及其数量使用。分类列表忽略 `keyword` 与当前 `categoryName`，但仍受供应商及有效性条件约束。
6. 产品选项排序从 `updatedAt DESC` 改为 `category_name ASC, product_head_name ASC, name ASC, id ASC`（`NULLS LAST`），保证分组连续；这会影响选品弹窗的默认顺序，需要在验收中确认。

## 6. 存量数据处理

### 6.1 可选方案

| 方案 | 做法 | 优点 | 影响/风险 | 结论 |
| --- | --- | --- | --- | --- |
| A. 留空补录 | 两列保持 `NULL`；UI 显示「未分类 / 未填写产品头」；编辑时逐步补录 | 无数据改写、可回滚、不强迫业务立刻分类；保留“未处理”事实 | 分类列为空，选品分类列初期主要是「未分类」；报表/筛选需处理 `NULL` | **推荐** |
| B. 默认值 | 迁移时把存量统一写成「未分类 / 未填写产品头」 | 消灭 `NULL`，查询简单 | 污染下拉选项；把“未处理”伪装成真实分类；后续难区分；产品头默认值无业务含义 | 不推荐 |
| C. 名称/属性推断 | 从产品名或 `attributes` 自动推断分类/产品头 | 看似省人工 | 现有属性只有「马力」等，无法可靠推断；误分类比留空更难发现 | 不推荐自动执行 |
| D. 强制补录 | 存量产品下一次编辑必须补全两字段 | 可逐步清理 | 阻塞紧急价格/供应商修改；对老数据不友好 | 不推荐默认启用 |
| E. 一次性映射脚本 | 按 `productNo` 提供人工确认的 CSV 映射，dry-run 后批量写入 | 分类质量高、可审计 | 需要业务提供映射表；脚本需单独授权与备份 | 作为后续可选工具，不进首期 |

### 6.2 推荐方案：A + 可选 E

- migration 只加列，不做任何 UPDATE。
- 列表、详情、选品对 `NULL` 统一显示为「未分类」「未填写产品头」，不伪造业务值。
- 新增产品强制填写；编辑历史产品不强制，保存时只校验“两列同为 null 或同时有值”。
- 若需要批量补录，再单独开发 `products:backfill-taxonomy`：输入 CSV（`productNo,categoryName,productHeadName`），默认 dry-run 输出待更新清单，`--apply` 前要求数据库备份并在单事务内写入；不改其他字段、不递增业务版本之外的语义（是否递增 `version` 见待确认）。
- 补录完成并确认没有 `NULL` 后，可另起一条迁移把两列改为 `NOT NULL`；首期不做。

### 6.3 对现有功能的影响

- 产品列表、详情：新增两列/两个字段，旧行为不变；空值显示占位符。
- 新增/编辑产品：新增必填（新增）或可选（历史编辑）字段；旧请求不带字段时，编辑保持原值。
- 销售/采购选品：默认顺序改变；分类列在存量期主要显示「未分类」；旧产品仍可被选择。
- 契约与测试：OpenAPI 快照、Web generated types、销售/采购产品选项 e2e、组件库 fixture 都需要同步。
- 命名治理：分类与产品头是文本标签，没有稳定 ID；改名等于批量改所有引用产品，拼写差异会分裂出新的分类/产品头。首期接受这一约束，后续如需要统一改名/合并，再评估是否引入字典表。

## 7. 新增产品页改造方案

### 7.1 字段位置

在「基础资料」卡片内，按层级顺序放在产品名称之前：

```text
分类 *        [下拉：已有分类 | ＋ 新建分类]
产品头 *      [下拉：当前分类下的产品头 | ＋ 新建产品头]
产品名称 *    [文本输入]
产品编号      [只读，系统派发]
```

编辑页沿用同一表单组件，分类/产品头回填当前值；历史产品为空时显示占位符，不阻塞其他字段保存。

### 7.2 「新建」交互

推荐使用项目已有的 `FaCombobox` 交互模式（`QsDictionarySelect` 已经是包装范例），新增一个业务组件 `QsTaxonomySelect`：

1. 点击字段展开下拉，列表 = 已有值（按名称排序）+ 固定末项「＋ 新建分类」/「＋ 新建产品头」。
2. 选择「＋ 新建」后，下拉面板切换为内联输入态：
   - 自动聚焦输入框；
   - 占位文案「输入新分类名称」/「输入新产品头名称」；
   - 「取消」返回列表，「确定」提交当前文本。
3. 也支持直接输入搜索：输入文本没有精确匹配时，列表底部出现「＋ 新建「xxx」」，按 Enter 或点击即选择该新值。两条路径效果一致。
4. 提交前做 `trim + NFC`、1..64 code points 校验；若规范化后与已有值完全相同，则直接选中已有值，不产生重复项。
5. 选中的新值立即进入表单模型，并在本地选项列表乐观追加；**不调用任何“创建分类”接口**。只有产品 `POST/PATCH` 成功后才随产品落库；取消/放弃表单时新值不会留下。
6. 产品头的选项按当前分类过滤；未选分类时产品头字段禁用，并提示「请先选择分类」。
7. 切换分类时，如果已选产品头不属于新分类，清空产品头并提示重新选择。

### 7.3 表单校验

- 新增：`categoryName`、`productHeadName` 均必填；产品头必须属于当前分类（以选项集合判断）。
- 编辑：历史为空可保持为空；若提交其中一个，另一个必须同时提交；不允许只清空一个。
- 服务端仍按同一规则校验，不能只依赖前端。

## 8. 选择数据库产品弹窗改造方案

### 8.1 尺寸与布局

- 使用 `QsGenericModal` 的 `size="2xl"`（`68rem`），删除当前 `xl + !max-w-[68rem]` 覆盖；这样用的是组件已有档位，而不是调用方私有宽度。
- 内容区三列：

```text
┌──────────────────────────────────────────────────────────────┐
│ 选择数据库产品                                        [关闭] │
│ [搜索产品名称或编号........]        [供应商下拉 ............] │
├──────────┬───────────────────────────────────┬───────────────┤
│ 分类     │ 微耕机 · 旱地履带  3 个           │ 已选择的产品  │
│ 全部 13  │ ┌─────────┐ ┌─────────┐           │ ...           │
│ 微耕机 6 │ │ 卡片    │ │ 卡片    │           │               │
│ 发电机 3 │ └─────────┘ └─────────┘           │               │
│ 水泵 3   │ 微耕机 · 四驱四轮  2 个           │               │
│ 未分类 1 │ ...                               │               │
├──────────┴───────────────────────────────────┴───────────────┤
│ 产品总数：共 N 个产品              [取消] [确认添加]          │
└──────────────────────────────────────────────────────────────┘
```

- 供应商下拉保持在顶部筛选条，不移动到分类列或内容区。
- 分类列宽约 `10rem`，独立纵向滚动；产品区独立纵向滚动；右侧已选面板保持现状。
- 窄屏：
  - `<lg`：分类列改为顶部横向滚动 chips；
  - `<md`：已选面板移到产品区下方，避免三列挤压。

### 8.2 分类列

- 固定首项「全部」。
- 其余项来自当前目录（`ACTIVE` + 当前供应商约束）的去重分类；末尾提供「未分类」桶（当存在 `category_name IS NULL` 的产品时显示）。
- 点击分类立即按 `categoryName` 重新查询（服务端过滤，不在当前页做本地筛选）；分页重置到第 1 页。
- 分类列显示该分类在当前供应商约束下的产品数量；数量由服务端 facet 查询返回，不使用当前页 items 冒充总数。
- 当前选中分类高亮（主色左边条/底色）；键盘可聚焦，Enter/Space 切换。

### 8.3 产品头分组

- 产品区按 `(categoryName, productHeadName)` 分组，组头显示：
  - 「全部」视图：`分类 · 产品头`，避免不同分类下同名产品头被合并；
  - 已选分类：仅显示产品头；
  - 空值：`未填写产品头`。
- 组内卡片按产品名称排序；服务端排序需保证同一分组连续。
- 卡片改为响应式网格（建议 2 列，窄屏 1 列），每张卡片包含：
  - 主图（16:10，点击放大）；
  - 产品名称；
  - 产品编号（mono）；
  - 选择状态/「选择产品」提示。
- 主图区域点击 = 放大预览；名称、编号与「选择产品」操作区点击 = 选择/增加数量。两者是同一卡片内的两个独立按钮，避免一次点击同时触发两个动作。
- 卡片信息区整体点击 = 选择/增加数量，沿用现有会话变更逻辑；主图按钮与信息区按钮是兄弟节点，不存在按钮嵌套。

### 8.4 图片放大交互

- 使用项目已有 `useFaImagePreview()`，不要新写 lightbox。
- 点击卡片主图区域（含右上角放大图标）时，调用 `imagePreview.open(originalContentUrl, 0)`：
  - 传入**原图** `mainImage.contentUrl`，不传 `thumb` 变体；缩略图仍使用 `mediaThumbnailUrl(contentUrl)`。
  - 支持 0.5x–3x 缩放、旋转、拖拽、Esc/遮罩关闭，均为组件内置能力。
- DOM 结构：主图区域是一个独立的按钮，卡片信息区（名称/编号/操作）是另一个按钮，两者是兄弟节点；点击主图只打开预览，不触发选择或数量 +1。
- 图片加载失败时显示占位图标并隐藏放大入口；无主图的产品同样不显示放大入口。
- 键盘：主图按钮可通过 Tab 聚焦，Enter/Space 打开；打开后焦点由预览组件管理。

### 8.5 分页与分组的关系

- 服务端仍按产品分页（建议保持 20/页），前端把已加载的 items 按 `(category, head)` 合并分组；跨页的同一分组会自然合并。
- 组头数量若显示，应为“已加载数量”，滚动加载后累加；不要把它当作服务端总数。
- 切分类、改供应商、改关键词时清空 items 并回到第 1 页，避免旧分组残留。
- 若产品量很小，可评估把 `pageSize` 提高到 50；不要在首期改为一次性全量加载。

## 9. 验收标准（实施阶段）

1. migration 在隔离库可重复 deploy；存量行两列为 `NULL`；`products_taxonomy_pair_check` 拒绝半填数据。
2. 新增产品必须选择或新建分类与产品头；新值随产品保存后才出现在下次选项查询中。
3. 编辑历史产品可先不改分类；一旦填写必须两者同时有值。
4. 产品列表/详情正确显示分类与产品头，空值显示「未分类」「未填写产品头」。
5. 选品弹窗使用 `2xl` 档位；供应商仍在顶部；分类列可筛选；卡片按产品头分组；跨页分组不重复、不丢项。
6. 点击卡片图片打开原图预览，且不触发产品选择/数量增加；无图或加载失败时无放大入口。
7. 销售创建、销售编辑、采购创建三个入口的选品行为一致；类型检查与组件库 fixture 同步。
8. 所有新增查询参数使用 Prisma/参数绑定；新增 DTO 校验拒绝空白、超长、`categoryName` 与 `unclassified` 同时出现。
9. `contract:check`、Server 单元/e2e、Web check、相关浏览器 e2e 通过。

## 10. 待确认问题

1. **新产品是否必填分类与产品头？** 推荐必填；历史产品编辑不强制，但填写时必须两者同时有值。
2. **产品头是否必须隶属于当前分类？** 推荐是，产品头下拉按分类过滤；同名产品头允许跨分类存在，分组用复合键。
3. **存量是否采用「留空补录」？** 推荐是；是否需要一次性 CSV 映射补录工具？
4. **弹窗改造是否同时覆盖采购订单与销售订单编辑？** 推荐在 `QsProductSelector` 组件层统一改造，三个入口一致；若只想改销售创建，需要加开关。
5. **分类列是否显示数量？** 推荐显示，数量按当前供应商约束 `groupBy` 返回（忽略关键词与当前分类）；若希望减少一次 facet 查询，可去掉数字。
6. **弹窗宽度用 `2xl` 还是 `3xl`？** 推荐 `2xl`（68rem，等同当前视觉宽度，去掉私有覆盖）；`3xl` 为 80rem，可容纳更宽的卡片网格。
7. **产品管理列表是否新增分类/产品头列与筛选项？** 推荐先加两列展示，不加筛选，避免首期扩大范围。
8. **仅有 `products:create` 的账号如何获得选项？** 推荐选项接口要求 `products:read`，create-only 账号降级为自由输入；若必须看到历史选项，需补专用读取接口或调整权限机制。
