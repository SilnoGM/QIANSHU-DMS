# 产品分类与产品头改造：技术设计（待确认）

## 1. 文档状态

- 状态：方案设计，未实施
- 编写日期：2026-10-18
- 关联需求：`requirements.md`
- 原型：`prototype.html`
- 分支：`feat/product-catalog-hierarchy`

本设计只覆盖到“可实施”的边界，不包含实际代码改动。所有字段名、接口名、交互口径都可以在确认阶段调整。

## 2. 设计摘要

| 决策 | 方案 |
| --- | --- |
| 存储 | `products` 表增加 `category_name`、`product_head_name` 两个 `varchar(64) NULL` |
| 层级约束 | 应用层 + DB CHECK：两列要么都空，要么都有值 |
| 下拉来源 | 从 `products` 去重读取；不建分类/产品头表 |
| 新建值写入 | 只随产品 `POST/PATCH` 写入；没有独立“创建分类”接口 |
| 存量 | 保持 `NULL`，UI 显示「未分类 / 未填写产品头」，后续补录 |
| 选品分类列 | 产品选项接口增加分类查询参数与分类 facet；前端三列布局 |
| 分组 | 前端按 `(category, head)` 对已加载 items 分组；服务端排序保证连续 |
| 图片放大 | 复用 `useFaImagePreview()`，传原图 URL，放大按钮与卡片选择按钮为兄弟节点 |
| 弹窗尺寸 | `QsGenericModal size="2xl"`，删除 `sm:!max-w-[68rem]` 私有覆盖 |

## 3. 数据模型

### 3.1 Prisma schema 草案

```prisma
model Product {
  // ...existing fields
  categoryName      String? @map("category_name")      @db.VarChar(64)
  productHeadName   String? @map("product_head_name")   @db.VarChar(64)

  @@index([categoryName, productHeadName, name], map: "products_category_head_name_idx")
}
```

说明：

- 不增加 relation；分类/产品头不是独立实体。
- 命名使用 `categoryName` / `productHeadName`，明确是标签文本，不是 `categoryId` / `headId`。
- `@@index` 的列顺序服务两类查询：按分类去重（leftmost prefix）与按分类/产品头/名称分组排序。

### 3.2 迁移与回滚

- 新迁移目录：`server/prisma/migrations/<timestamp>_product_category_head/migration.sql`。
- 内容：`ADD COLUMN` ×2、三条 CHECK、一条索引；无 UPDATE、无默认值、无触发器改动。
- 回滚：删除索引、约束、两列即可；因为迁移不改存量业务值，回滚不会丢业务数据（但会丢已录入的分类/产品头，需先备份）。
- 应用顺序：隔离库 deploy 两次 → `prisma:drift:check` → 开发库（单独授权）→ 测试环境 → 生产（按发布流程）。
- 同步登记：`docs/后端文档/数据库迁移规范.md` 的迁移总数、清单与说明；`schema.prisma` 与迁移必须一致。

### 3.3 规范化与校验

服务端新增纯函数（可复用现有 `normalizeText` 风格）：

```text
normalizeTaxonomyText(value, field, max=64): string | null
- null -> null
- string -> trim().normalize('NFC')
- code point length 1..64
- 非空白
```

产品命令规范化：

- `CreateProductRequestDto`：`categoryName`、`productHeadName` 均为 `string`（非空）时，进入 `NormalizedProductCreateCommand`；若产品策略选择允许草稿留空，则改为 `string | null`。
- `UpdateProductRequestDto`：两个字段都可选；服务端合并当前行后校验 pair 关系：
  - 当前两列都空 + 本次都未提交 → 允许；
  - 当前两列都空 + 本次只提交一个 → 422 `VALIDATION_FAILED`；
  - 当前两列都有值 + 本次只提交一个（改分类或改产品头）→ 允许，但最终仍需两列都有值；
  - 任一路径最终一空一非空 → 422。
- 产品头是否属于分类：由于没有字典表，服务端只能校验“该 `(categoryName, productHeadName)` 组合是否已存在于产品表”，或者在创建时允许新组合（新产品头本来就可能第一次出现）。因此：
  - 新增产品时，组合可以不存在，视为新组合；
  - 编辑产品时，若改了分类但产品头仍是旧分类下的值，前端应清空；服务端不做“产品头必须已存在于该分类”的强校验，否则无法先建分类再建产品头。是否强制见待确认。
- 创建指纹：`PRODUCT_CREATE_FINGERPRINT_VERSION` 升为 `product.create.v2`，payload 增加两个字段；旧 v1 记录不重放、不迁移。
- 审计：沿用 `PRODUCT_CREATED` / `PRODUCT_UPDATED`，不新增事件类型；`changedFields` 增加两个字段名，审计元数据只记录字段名，不记录文本内容（与现有“不记录金额/属性内容”口径一致）。

## 4. 后端查询与接口

### 4.1 产品读取

`PRODUCT_RESPONSE_SELECT` 增加两列，`ProductQueryRow`、`ProductListItem`、`ProductListItemDto` 同步增加：

```ts
categoryName: string | null
productHeadName: string | null
```

影响面：

- `product-query.mapper.ts`、`dto/product-response.dto.ts`
- `product-command.persistence.ts` 的 create select（复用 `PRODUCT_RESPONSE_SELECT`，自动生效）
- `product-update.persistence.ts` 的 lock record / update record / response
- Web `ProductListItemDto` generated type 与列表 view model

### 4.2 分类/产品头选项接口

建议新增：

```http
GET /api/products/taxonomy-options
```

响应：

```json
{
  "categories": [
    { "name": "微耕机", "productHeads": ["水旱两用", "旱地履带", "四驱四轮"] },
    { "name": "发电机", "productHeads": ["汽油发电机", "柴油发电机"] }
  ]
}
```

实现要点：

- 读取所有产品的非空 `category_name` / `product_head_name`；可用 `findMany({ where: { categoryName: { not: null } }, select, distinct })` 或 `groupBy`，均走 Prisma 参数绑定。
- 排序：分类按 `name`，产品头按 `name`；是否使用中文 locale 排序由数据库 `ORDER BY` 决定，前端不再二次打乱。
- 权限：`products:read`。若产品维护角色只有 `products:create`，前端捕获 403 后降级为自由输入，不阻塞提交；是否补专用接口见待确认。
- 缓存：不需要服务端缓存；前端在页面打开时拉一次，产品保存成功后重新拉取。

### 4.3 销售/采购产品选项

三条接口共享同一套变更：

```text
GET /api/sales-orders/product-options
GET /api/sales-orders/:salesOrderId/product-edit-options
GET /api/purchase-orders/product-options
```

新增查询参数：

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `categoryName` | `string?` | 精确匹配分类；trim + 1..64 |
| `unclassified` | `boolean?` | 只看 `category_name IS NULL`；与 `categoryName` 互斥 |

新增响应字段：

```ts
// item
categoryName: string | null
productHeadName: string | null

// page
categories: Array<{ name: string; count: number }> // 当前供应商/有效性条件下的分类及数量
unclassifiedCount: number                          // 未分类产品数量，0 表示不显示该桶
```

分类 facet 使用同一 base（`status` + `supplierValue` + 采购侧成本条件）做 `groupBy`，但**忽略** `keyword`、`categoryName`、`unclassified`；这样左侧分类列在搜索时保持稳定，数量也不会被当前页截断。

Where 构造（以销售为例）：

```ts
const where: Prisma.ProductWhereInput = {
  status: 'ACTIVE',
  ...(supplierValue ? { supplierValue } : {}),
  ...(categoryName ? { categoryName } : {}),
  ...(unclassified ? { categoryName: null } : {}),
  ...(keyword ? { OR: [...] } : {}),
}
```

分类 facet 查询使用同一 base（`status` + `supplierValue` + 采购侧成本条件），但**忽略** `keyword`、`categoryName`、`unclassified`，这样左侧分类列在搜索时保持稳定。

排序：

```ts
orderBy: [
  { categoryName: 'asc' },      // PostgreSQL ASC 默认 NULLS LAST
  { productHeadName: 'asc' },
  { name: 'asc' },
  { id: 'asc' },
]
```

注意：现有销售/采购选品按 `updatedAt DESC` 排序，改为按目录层级排序会改变默认顺序；如果业务希望“最近更新优先”，需要另加排序开关，不能同时满足分组连续与最近更新优先。

### 4.4 DTO 校验

- `categoryName`：`@IsOptional() @IsString() @IsUnicodeCodePointLength(1,64) @Matches(/\S/u)`；是否 trim 取决于是否要求精确匹配。建议查询参数不 trim（与 `supplierValue` 一致），但前端只发送规范化后的值。
- `unclassified`：`@IsOptional() @IsBoolean()` + `@Transform` 把 `'true'/'false'` 转为 boolean；与 `categoryName` 同时出现时 422。
- 所有新增字段进入 OpenAPI 后，需执行 `node --run contract:sync` 更新 `server/openapi/openapi.json` 与 Web generated types；`contract:check` 必须零 diff。

### 4.5 参数绑定约束

- 列表、计数、facet 查询全部走 Prisma `where`，由 Prisma 生成参数化 SQL。
- 如确实需要 `$queryRaw`（例如 `SELECT DISTINCT` 配合复杂条件），必须使用 `Prisma.sql` 模板和 `${value}` 占位符；禁止 `Prisma.raw` 拼接用户输入、禁止模板字符串拼 SQL、禁止 `format()`/`f-string` 风格的字符串组装。
- `categoryName`、`unclassified`、`keyword`、`supplierValue` 都属于外部输入，必须经过 DTO 校验后才进入查询。

## 5. 前端：新增/编辑产品

### 5.1 组件结构

新增业务组件：

```text
components/business/QsTaxonomySelect/
  index.vue     // FaCombobox 包装：选项 + 新建态
  types.ts
  logic.ts      // 纯函数：去重、匹配、校验、按分类过滤
  README.md
```

使用方：`views/admin/product-management/form/product-form.vue`。

表单模型增加：

```ts
categoryName: string | null
productHeadName: string | null
```

字段位置：基础资料卡片，产品名称之前。

### 5.2 交互状态机

```text
closed
  -> open(list)                    点击字段
open(list)
  -> open(create)                  点击「＋ 新建」
  -> selected(value)               点击已有项 / 输入精确匹配项
open(create)
  -> open(list)                    取消
  -> selected(normalizedValue)     确定 / Enter
selected(value)
  -> open(list)                    再次点击字段
```

关键规则：

- `open(create)` 的输入框自动聚焦；Esc 先退出 create 态，再 Esc 关闭整个下拉。
- 确定时执行 `trim + NFC`；空值、超长显示字段错误，不关闭 create 态。
- 若规范化后命中已有项，直接选中已有项，不追加本地新项。
- 新值加入本地 options（乐观），并设置表单值；不调用写入接口。
- 产品头组件接收 `categoryName`，options 只显示该分类下的产品头；分类为空时禁用。
- 分类变更时，如果当前产品头不在新分类的 options 中，父表单清空产品头。

### 5.3 提交与错误映射

- `buildProductFormRequest` 增加两个字段，先做前端校验，再交给服务端。
- 服务端字段错误路径 `categoryName` / `productHeadName` 必须进入 `SIMPLE_FIELD_ORDER` 和 `isAllowedFieldPath`，否则会降级为表单级错误。
- 创建成功后，产品创建页刷新 taxonomy options；编辑成功后同样刷新，保证新值立刻出现在下拉中。
- `hasProductFormChanges` 增加两个字段，避免只改分类/产品头时被判定为“未修改”而拦截离开确认。

## 6. 前端：选择数据库产品弹窗

### 6.1 组件边界

`QsProductSelector` 仍是业务中立组件，只依赖 `loadProducts`：

```ts
interface ProductSelectorQuery {
  currencyCode: 'CNY' | 'MYR' | 'TWD'
  keyword?: string
  supplierValue?: string
  categoryName?: string
  unclassified?: boolean
  page: number
  pageSize: number
}

interface ProductSelectorPage {
  items: ProductSelectorItem[]
  categories: Array<{ name: string; count: number }>
  unclassifiedCount: number
  page: number
  pageSize: number
  total: number
}

interface ProductSelectorItem {
  // ...existing
  categoryName: string | null
  productHeadName: string | null
}
```

调用方 loader 负责把各自 API 的响应适配成上述结构；分类 facet 由 API 返回，组件不猜测。

### 6.2 布局

- `QsGenericModal`：`size="2xl"`，删除 `class="sm:!max-w-[68rem]"`。
- 内容区：

```html
<div class="grid gap-4 lg:grid-cols-[10rem_minmax(0,1fr)_18rem]">
  <aside>分类列</aside>
  <section>产品区（分组 + 卡片网格）</section>
  <aside>已选择的产品</aside>
</div>
```

- 顶部筛选条横跨产品区与分类列上方，保持供应商下拉位置不变。
- 三列各自滚动；产品区高度与分类列一致，避免整页滚动。
- 窄屏改为：
  - `lg` 以下：分类列变成横向 chips；
  - `md` 以下：已选面板移到产品区下方。

### 6.3 分组计算

```ts
type ProductGroup = {
  key: string                 // `${category ?? ''}\u0000${head ?? ''}`
  categoryName: string | null
  productHeadName: string | null
  items: ProductSelectorItem[]
}

function groupItems(items: readonly ProductSelectorItem[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>()
  for (const item of items) {
    const key = `${item.categoryName ?? ''}\u0000${item.productHeadName ?? ''}`
    // append，保持服务端顺序
  }
  return [...groups.values()]
}
```

- 使用 Map 保持首次出现顺序；服务端已按分类/产品头排序，因此同一组连续。
- 跨页追加时重新分组，天然合并被页边界切开的组。
- 组头标签：
  - 全部视图：`分类名 · 产品头名`；
  - 单分类视图：`产品头名`；
  - 空值：`未分类` / `未填写产品头`。
- 组头数量（如显示）只统计已加载 items，不冒充服务端总数。

### 6.4 分类列

- 数据源：`result.categories` + `result.unclassifiedCount`；「全部」数量为两者之和。
- 固定「全部」；末尾「未分类」。
- 点击分类：
  - 设置 `categoryName` 或 `unclassified`；
  - 清空 items、page、total，调用 `loadPage(1, true)`；
  - 保留 keyword 与 supplier。
- 切换供应商：
  - 重置分类为「全部」（避免选中一个在新供应商下不存在的分类）；
  - 重新加载。
- 分类列不参与本地过滤，避免“当前页筛选”造成总数与列表不一致。

### 6.5 卡片与选择

- 卡片网格：`grid gap-3 sm:grid-cols-2`，窄屏 1 列。
- 卡片内部拆成两个并列按钮，避免 `<button>` 嵌套：
  - 主图按钮：点击打开原图预览；
  - 信息区按钮：点击选择/增加数量。

```html
<article class="product-card">
  <button type="button" class="product-card__media" @click="openImage(item)">
    <img ... />
    <span class="zoom-hint" aria-hidden="true">放大图标</span>
  </button>
  <div class="product-card__body">
    <button type="button" @click="selectProduct(item)">
      名称 / 编号 / 选择状态
    </button>
  </div>
</article>
```

- 选择/加量/移除逻辑完全复用 `logic.ts`，不因布局变化重写会话状态。
- 现有 `FaPopover` 以整卡按钮为触发点。拆分后把触发点收敛到信息区按钮：主图按钮 `@click.stop`，避免一次点击同时打开图片预览与加量气泡；若 `FaPopover` 无法直接承载双按钮结构，则改为受控 `:open` + 外层容器，不嵌套交互元素。
- 已选卡片加主色边框和 `aria-pressed`；右侧已选列表保持现有投影逻辑。
- 图片加载失败：隐藏放大入口，显示占位图标。
- 交互取舍：主图不再承担“选择”动作，避免一次点击同时打开预览和选中产品；如果需要整卡选择，应改为“单击选择、双击预览”等明确规则，但这会与需求中的“点击图片放大”冲突，因此不采用。

### 6.6 图片放大

```ts
const imagePreview = useFaImagePreview()

function openImage(item: ProductSelectorItem): void {
  if (!item.mainImage) return
  // 原图，不是 thumb 变体
  imagePreview.open(item.mainImage.contentUrl, 0)
}
```

- `useFaImagePreview` 已在 `@fantastic-admin/components` 中提供，`ImageGroup` 是现成用法参考。
- 预览打开后由组件处理缩放/旋转/拖拽/Esc；选品弹窗不再叠加自己的键盘处理。
- 缩略图 URL：`mediaThumbnailUrl(item.mainImage.contentUrl) ?? item.mainImage.contentUrl`；预览 URL：`item.mainImage.contentUrl`。

### 6.7 分页

- 保留 20/页与滚动加载；分类/供应商/关键词变化时重置。
- 服务端排序改为目录顺序后，分页稳定；同一产品头的卡片在相邻页时通过重新分组合并。
- `createProductSelectorQueryKey` 增加 `categoryName`、`unclassified`，否则请求竞态保护会把两个分类的响应混在一起。

## 7. 前端：产品管理列表与详情

- 列表列新增「分类」「产品头」，位置放在「产品名称」之后；空值显示 `—` 或「未分类」。
- 详情抽屉新增一个「分类与产品头」信息块，展示两个值；空值明确显示「未分类」「未填写产品头」。
- 列表暂不新增筛选，避免首期扩大范围；如后续需要，可按分类/产品头增加 `QsGenericTable` filter，服务端增加对应查询参数。
- 产品列表 view model / adapter 增加两个字段；fixture 与测试同步。

## 8. 测试与验证计划

### 8.1 Server

- 纯函数单测：分类/产品头规范化、pair 校验、创建指纹 v2。
- 产品创建/编辑 API e2e：
  - 新增带分类/产品头成功；
  - 只填一个 422；
  - 历史产品（两列 null）只改价格成功；
  - 产品头跨分类同名允许；
  - 空白/超长 422。
- 产品选项 API e2e：
  - `categoryName` 精确过滤；
  - `unclassified=true` 过滤；
  - 两者同时出现 422；
  - `categories` facet 在供应商过滤下正确，数量与 `groupBy` 一致；
  - 排序为分类/产品头/名称；
  - 响应包含两个新字段。
- 契约：OpenAPI snapshot、operationId、DTO schema 同步；`contract:check` 零 diff。
- 迁移：隔离库 deploy 两次、drift check、约束正反例。

### 8.2 Web

- `QsTaxonomySelect` 纯逻辑单测：去重、精确匹配、分类过滤、新建值校验。
- 产品表单单测：请求构建、字段错误映射、dirty 判断。
- 选择器组件测试：查询 key 包含分类、分类切换重置分页、分组键、跨页合并、图片按钮不触发选择。
- 组件库示例：fixture 增加分类/产品头，`ProductSelectorShowcase` 可验收新布局。
- 浏览器 e2e：
  - 销售创建打开弹窗，左侧分类筛选，产品头分组；
  - 点击图片打开预览，点击卡片选择；
  - 关闭预览后选择状态不变；
  - 销售编辑、采购创建入口复用同一布局。

### 8.3 门禁

- `node --run check:server`
- `node --run check:web`
- `node --run contract:check`
- 相关浏览器套件与全量 e2e（按发布前流程）

## 9. 风险与取舍

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 存量全为空 | 上线初期分类列几乎全是「未分类」 | 接受；提供补录工具与列表空缺提示 |
| 同名产品头跨分类 | 只用产品头分组会错误合并 | 分组键包含分类；全部视图组头带分类名 |
| 目录排序改变 | 选品默认顺序从“最近更新”变为“分类/名称” | 验收确认；必要时增加排序切换 |
| 分页切组 | 组头数量可能只反映已加载项 | 不显示总数或标注“已加载” |
| 新建值拼写分裂 | 自由文本容易出现“微耕机/微耕机 ” | 写入 trim + NFC；精确匹配复用；后续可加名称相似提示 |
| 无字典表改名 | 分类/产品头没有稳定 ID，改名需批量更新所有产品；拼写差异会分裂分组 | 接受首期约束；如出现治理需求，再评估字典表与迁移路径 |
| 权限边界 | `products:create` 无 `products:read` 时拿不到选项 | 降级自由输入；或补专用选项接口 |
| 迁移回滚 | 回滚删除列会丢失已录入分类 | 回滚前备份；迁移本身不改存量，风险可控 |
| 图片按钮嵌套 | `<button>` 内再放 `<button>` 是非法 HTML，会破坏键盘与点击 | 放大按钮与卡片按钮做兄弟节点 |

## 10. 实施顺序建议

1. 需求确认（本文档第 10 节问题）。
2. migration + schema + 后端 DTO/规范化/查询 + 契约同步 + Server 测试。
3. 产品新增/编辑表单与 `QsTaxonomySelect` + 产品列表/详情 + Web 测试。
4. `QsProductSelector` 三列布局 + 分组 + 分类查询 + 图片预览 + 三个 loader 适配。
5. 组件库 fixture 与示例更新。
6. 浏览器 e2e 与全量门禁。
7. 存量补录工具（如确认需要）。
