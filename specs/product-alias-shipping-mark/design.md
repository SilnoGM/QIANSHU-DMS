# 产品别名与唛头拼接技术设计

## 1. 文档状态

- 状态：本地实施完成，待页面级验收
- 定稿日期：2026-11-17
- 适用范围：`server/`、`web/apps/qsmds-arco`
- 实施分支：`产品别名与唛头拼接`
- 基线提交：`86060738`（`main`）
- 需求文档：[requirements.md](requirements.md)
- 实施记录：[implementation.md](implementation.md)
- 文档效力：本文档与需求文档共同构成实施口径；冲突时先更新需求文档，再同步本文档。

## 2. 当前真相源与现状

### 2.1 唛头后缀现状

- 后缀规则集中在 [shipping-mark-label.ts](../../server/src/modules/purchase-orders/shipping-mark-label.ts)，当前为订单级 `出单前缀-客户名`，STOCK 固定 `公司囤货采购`。
- 文件头明确要求：采购单图片、前端复制文案、应付对账单三处贴标后缀必须逐字一致。
- 当前有三处各自拼接：
  - 采购单图片快照：[purchase-order-image-snapshot.ts](../../server/src/modules/purchase-orders/order-images/purchase-order-image-snapshot.ts)
  - 应付/对账单：[purchase-payable-query.service.ts](../../server/src/modules/purchase-orders/payables/purchase-payable-query.service.ts)
  - 前端复制文案：[purchase-order-copy.logic.ts](../../web/apps/qsmds-arco/src/views/operations/purchase-orders/purchase-order-copy.logic.ts)
- 采购单图片快照模板版本当前为 `5`。
- 采购单详情已返回每个货件的 `items`（含 `lineNumber`、`quantity`），并按采购行号排序；采购行已返回 `productId` 和产品名快照。
- 采购单图片快照中的货件 `items` 当前按 `purchaseOrderLineId` 排序，需要改为按 `lineNumber` 排序。

### 2.2 产品页面与权限现状

- 产品列表与详情 API 均要求 `products:read`；产品媒体内容要求 `product-media:read`。
- 管理员产品列表页已经覆盖产品全部信息、图片/视频、属性、详情抽屉和审计信息。
- 运营产品库不复用管理员表格形态，采用左图右信息的横向长方形卡片库；只复用底层展示组件、产品 DTO 适配和详情能力。
- 当前产品图片情况：220 个产品中已有 94 张主图，单个有图产品 1 张，84% 接近正方形；视频和属性当前均为 0。页面按“90%+ 产品有图”的目标设计，未上传的少量产品使用统一占位。
- 运营角色当前没有 `products:read`、`product-media:read`，也没有产品别名权限。
- 结账/货币目录和字典目录只要求登录 Session，运营可直接使用。
- 运营工作台当前第一个菜单是“看机预约”，路由位于 [operations.workbench.ts](../../web/apps/qsmds-arco/src/router/modules/operations.workbench.ts)。

### 2.3 生产数据口径

生产只读核对结果见 [requirements.md](requirements.md) 第 6 节。关键事实：

- 客户名最长 15 字符，限制 24 不截断存量。
- 货件唛头最长 26 字符，限制 30 不截断存量。
- 当前没有同一产品多行，但服务端和数据库没有硬约束。
- 采购行会拆到多个货件，货件项数量必须取分配量。
- 单货件最多 10 个产品条目。

这些是当前数据观察，不是永久不变量；实现不能依赖“同一产品不会多行”。

## 3. 设计结论

1. 新增 `user_product_aliases` 表，按“用户 + 产品”保存别名，一个用户对一个产品最多一条。
2. 新增自我作用域的 `product-aliases` API，只允许读写当前登录用户自己的别名。
3. 新增权限 `product-aliases:manage`；运营补 `products:read`、`product-media:read`，系统管理员补别名权限。
4. 新增别名设置/清除审计事件。
5. 重写唛头后缀生成器：一次调用同时产出别名块、数量、前缀/客户名括号，图片、复制文案、对账单统一使用。
6. 后缀从订单级改为**货件级**：每个货件根据自己的产品集合和分配数量生成。
7. SALES_LINKED 按销售单出单人取别名；STOCK 只用产品名。
8. 目录产品按 `productId` 在货件内聚合数量；自定义行按行独立。
9. 格式固定：`【唛头】展示名[×数量]+展示名[×数量]（出单前缀-客户名）`；STOCK 为 `【唛头】产品名[×数量]+产品名（公司囤货采购）`。
10. 长度固定：唛头 30、客户名 24、别名 36、别名块 438、完整唛头 500；超长按整项截断加 `…`。
11. 采购单图片模板版本升级为 6；历史草稿失效，待审核订单需重新出图。
12. 运营产品库使用独立的横向长方形卡片页面（左图右信息），不复用管理员产品列表的表格形态；只复用底层展示组件与产品 DTO 适配。
13. 本期不新增服务端重复产品校验或数据库唯一约束。

## 4. 数据模型与迁移

### 4.1 `user_product_aliases`

```prisma
model UserProductAlias {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  productId String   @map("product_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  alias     String   @db.VarChar(36)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  product Product @relation(fields: [productId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  user    User    @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Restrict)

  @@unique([productId, userId], map: "user_product_aliases_product_id_user_id_key")
  @@index([userId], map: "user_product_aliases_user_idx")
  @@map("user_product_aliases")
}
```

同时在 `Product` 和 `User` 上增加反向关系。

数据库约束：

- `UNIQUE(product_id, user_id)`。
- `INDEX(user_id)`。
- `CHECK (alias = btrim(alias))`。
- `CHECK (char_length(alias) BETWEEN 1 AND 36)`。
- 控制字符/换行由 API 校验；数据库可选追加 `alias !~ '[[:cntrl:]]'`。
- `alias` 不允许包含 `×`；数据库可选追加 `strpos(alias, '×') = 0`，API 必须校验。
- 外键 `ON DELETE RESTRICT ON UPDATE RESTRICT`。

不新增 `version` 字段：单人单字段，last-write-wins 可接受；需要并发保护时再单独设计。

### 4.2 迁移

建议一条 additive migration，命名参考 `20261117130000_user_product_aliases`（实际时间戳以实施时最新迁移之后为准），包含：

1. `CREATE TABLE user_product_aliases`、唯一约束、索引、CHECK、外键。
2. `ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'PRODUCT_ALIAS_UPDATED'`、`'PRODUCT_ALIAS_CLEARED'`。
3. 插入权限 `product-aliases:manage`。
4. 授予 `system_admin` 新权限；授予 `operations_staff` `products:read`、`product-media:read`、`product-aliases:manage`。
5. 末尾 `DO` 块自检表、约束、权限和授权是否完整，任一缺失整体回滚。

迁移只新增空表和权限/枚举，不回填别名，不修改既有业务数据。实施后需同步：

- `server/prisma/schema.prisma`
- `server/src/modules/access-control/permission.constants.ts`
- `server/src/cli/seed/seed.dataset.ts` 的 `operations_staff`
- `server/test/seed.e2e-spec.ts` 的运营权限计数（28 → 31）
- `auth-api.e2e-spec.ts` / `auth-schema.e2e-spec.ts` 的权限清单
- 迁移规范文档及根治理计数

## 5. API 设计

### 5.1 路由

建议独立 controller，避免污染产品目录 API：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/product-aliases/mine` | 读取当前用户别名；可选 `productIds` 过滤 |
| `PUT` | `/api/product-aliases/mine/:productId` | 设置或修改当前用户别名 |
| `DELETE` | `/api/product-aliases/mine/:productId` | 清除当前用户别名 |

`productIds` 最多 100 个 UUID，避免无界查询。页面按当前页产品 ID 批量读取；不提供按别名搜索。

### 5.2 权限与作用域

- 三条接口都要求 `product-aliases:manage`。
- 用户 ID 只从 `getRequestAuthContext(request).userId` 获取；路径、query、body 都不接收用户 ID。
- 产品不存在返回 `404 PRODUCT_NOT_FOUND`。
- 产品可以处于任意状态；已停用产品仍允许维护别名。
- 不要求 `products:read` 才能读写自己的别名；页面本身由 `products:read` 控制。

### 5.3 请求与响应

`PUT` body：

```json
{ "alias": "破碎机" }
```

- `alias` 为字符串，trim 后必须为 1–36 字符。
- 服务端统一去除首尾空白、折叠内部空白。
- 拒绝控制字符/换行和 `×`。
- 空字符串视为清除（也可以只允许 `DELETE`；建议统一支持空字符串清除）。
- 相同值重复保存返回当前记录，不写审计。

响应：

```json
{ "productId": "uuid", "alias": "破碎机", "updatedAt": "2026-11-17T..." }
```

### 5.4 审计

- `PUT` 新增或变更：`PRODUCT_ALIAS_UPDATED`。
- `PUT` 空值或 `DELETE`：`PRODUCT_ALIAS_CLEARED`。
- `targetType: 'PRODUCT_ALIAS'`，`targetId: productId`。
- metadata：`productNo`、`productName`、`previousAlias`、`alias`。
- 别名写入与审计在同一事务；审计失败回滚别名变更。
- 审计页 [presentation.ts](../../web/apps/qsmds-arco/src/views/system/audit/presentation.ts) 补中文标签。

### 5.5 契约

- 三个 operationId 建议：`product_aliases_list_mine`、`product_aliases_upsert_mine`、`product_aliases_clear_mine`。
- `session: 'required'`、`authorization: true`、`privateNoStore: true`、validation 与标准 403/404/422 错误。
- 通过根 `contract:sync` 更新 `server/openapi/openapi.json` 和 Web generated types；不手工编辑生成物。

## 6. 权限与审计

### 6.1 权限

- 新增 `PRODUCT_ALIAS_PERMISSION_CODES = ['product-aliases:manage']`，并加入 `MANAGEMENT_PERMISSION_CODES`。
- 稳定 UUID 建议使用当前权限最大编号的下一个；实施前必须核对避免冲突。
- `systemOnly: false`，允许角色配置。
- `system_admin` 通过迁移获得；`operations_staff` 通过迁移和 `SEED_ROLES` 获得。
- 运营角色新增三个权限：`products:read`、`product-media:read`、`product-aliases:manage`。
- 自定义角色不会自动获得权限，需要管理员在角色权限页手工授予。
- 权限变更后用户需重新登录才能刷新权限上下文。

### 6.2 审计

- 新枚举值必须通过迁移追加，不能只改 Prisma schema。
- 审计标签、图标/展示映射需要同步。
- 不在审计 metadata 中记录完整请求或其他用户别名。

## 7. 唛头格式与算法

### 7.1 类型

```ts
interface ShippingMarkProduct {
  lineNumber: number
  productId: string | null
  productName: string
  quantity: number
}

interface ShippingMarkLabelSource {
  purchaseType: 'SALES_LINKED' | 'STOCK'
  issuerPrefix: string | null
  customerName: string | null
  products: readonly ShippingMarkProduct[]
  aliases: ReadonlyMap<string, string> // productId -> alias；STOCK 传空 Map
}
```

### 7.2 归一步骤

1. 规范化 `issuerPrefix`、`customerName`、`productName`、`alias`：trim、折叠内部空白、过滤空值。
2. 过滤 `quantity <= 0` 的异常项（正常数据不应存在）。
3. 按 `lineNumber` 升序排列。
4. 目录产品（`productId != null`）按 `productId` 聚合：
   - 数量求和。
   - 位置取第一次出现的 `lineNumber`。
   - 展示名：该产品在别名 Map 中存在则用别名，否则用第一次出现的 `productName`。
5. 自定义行（`productId == null`）每行独立：
   - 数量取该行在该货件的分配量。
   - 展示名取该行的自定义产品名。
   - 同名多行不合并，允许 `AAA×2+AAA×3` 或 `AAA+AAA`。
6. 按聚合后的首次 `lineNumber` 升序输出条目。

### 7.3 条目与分隔

```text
entry = displayName + (quantity > 1 ? "×" + quantity : "")
aliasBlock = entries.join("+")
```

- 数量分隔符固定 U+00D7 `×`。
- 数量为 1 不输出。
- 产品之间固定 `+`。
- 不使用 ASCII `*` 作为数量分隔符。

### 7.4 后缀

SALES_LINKED：

```text
parenthetical = prefix 和 customer 都为空
  ? ""
  : `（${[prefix, customer].filter(Boolean).join('-')}）`

suffix = aliasBlock + parenthetical
```

STOCK：

```text
suffix = aliasBlock + `（${STOCK_SHIPPING_MARK_SUFFIX}）`
```

- `STOCK_SHIPPING_MARK_SUFFIX` 保持 `公司囤货采购`。
- STOCK 不使用别名，`displayName` 始终为产品名。
- STOCK 的旧格式 `【唛头】公司囤货采购` 被替换为新格式。

最终：

```text
【${shippingMarkText}】${suffix}
```

`formatShippingMark` 保持 `【mark】suffix` 的职责，但 suffix 现在由上述算法生成。

### 7.5 438 截断算法

```ts
function buildAliasBlock(entries: readonly string[], max = 438): string {
  const included: string[] = []
  let length = 0
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const separator = included.length === 0 ? 0 : 1
    const remaining = entries.length - index - 1
    const reserveEllipsis = remaining > 0 ? 1 : 0
    const nextLength = length + separator + entry.length
    if (nextLength + reserveEllipsis > max) {
      if (included.length === 0) {
        // 正常数据不会发生：单个别名最长 36，产品名最长 128，都远小于 438。
        return entry.slice(0, max - 1) + '…'
      }
      return `${included.join('+')}…`
    }
    included.push(entry)
    length = nextLength
  }
  return included.join('+')
}
```

注意：

- 438 包含 `×数量` 和 `+`。
- 截断只发生在整项边界；不截断 `×数量` 或产品名中间。
- `…` 占 1 字符，必须计入 438。
- 完整标签生成后仍应断言 `length <= 500`；正常数据下 438 + 固定开销不会超过 500。

### 7.6 示例

```text
SALES_LINKED，目录产品聚合：
  两行同一产品，货件内数量 2 + 3 → 破碎机×5
  另一产品数量 1 → 木桌
  【MARK】破碎机×5+木桌（李华-赖文寿）

SALES_LINKED，自定义同名多行：
  【MARK】定制架×2+定制架×3（李华-赖文寿）

STOCK：
  【MARK】破碎机×2+木桌（公司囤货采购）

无别名：
  【MARK】木桌×4（李华-赖文寿）

前缀/客户名都为空：
  【MARK】木桌×4
```

## 8. 长度与校验

### 8.1 固定上限

| 项 | 上限 |
| --- | --- |
| 货件唛头文本（`【】` 内） | 30 字符 |
| 客户名 | 24 字符 |
| 出单前缀 | 3 字符（现有结构） |
| 单个别名 | 36 字符 |
| 别名块 | 438 字符（含 `×数量` 与 `+`） |
| 完整唛头 | 500 字符 |
| 对账单单条唛头校验 | 500（允许等于） |

计算：

```text
【】2 + 唛头30 + 别名块438 + （）2 + 前缀3 + -1 + 客户名24 = 500
STOCK：2 + 30 + 438 + 2 + 6 = 478
```

### 8.2 写入边界

- 销售单客户名写入/更新时校验最长 24 字符；现有生产最大 15，无历史冲突。
- 采购货件唛头写入/生成时校验最长 30 字符；现有生产最大 26，无历史冲突。
- 建议同时在数据库加 CHECK 或继续由应用层保证；若只做应用层，直接 DB 写入仍可能产生超限数据，读取侧必须有防御。
- 读取侧遇到超限历史数据时，不得让对账单生成失败；可按上限截断并记录告警，或失败关闭由人工修复。推荐“截断 + 告警”，保证财务可出单。

### 8.3 字符单位

- 对账单校验使用 JavaScript `string.length`（UTF-16 code unit）。
- PostgreSQL `char_length` 使用字符数。
- 纯中文/ASCII 下一致；若允许 emoji 等增补平面字符，需统一按 code unit 计数或在别名校验中拒绝增补平面字符。
- `×` 是 U+00D7，长度为 1。

## 9. 三处消费者改造

### 9.1 采购详情

在 [purchase-order-query.service.ts](../../server/src/modules/purchase-orders/purchase-order-query.service.ts) 中：

- 查询销售单出单人的用户 ID（内部使用，不必暴露给前端）。
- 取采购行的 `productId`、`productNameSnapshot`；货件 `items` 已含 `lineNumber` 和 `quantity`。
- SALES_LINKED 时批量读取该出单人名下相关产品的别名；STOCK 不查别名。
- 使用共享生成器为每个货件计算 `shippingMarkSuffix`，添加到 DTO 的 `parts[]`。
- 不发生别名查询的情况：STOCK、无产品 ID、空货件。

DTO 增量字段（additive）：

```ts
parts[].shippingMarkSuffix: string
```

前端复制文案直接使用该字段，不再本地拼 `labelSuffix`。

### 9.2 采购单图片

- `createPurchaseOrderImageSnapshot` 从订单级 `shippingMarkSuffix` 改为每个货件自己的后缀。
- 优先使用详情已经计算好的 `parts[].shippingMarkSuffix`；保持快照纯函数，不在快照内部查库。
- 渲染器使用 `part.shippingMarkSuffix`。
- `PURCHASE_ORDER_IMAGE_TEMPLATE_VERSION` 从 `5` 升到 `6`。
- 货件 `items` 排序从 `purchaseOrderLineId` 改为 `lineNumber`，与别名块和复制文案一致。
- 旧草稿保留可查看，但 `isCurrent=false`；审核前需要重新生成。

### 9.3 应付/对账单

在 [purchase-payable-query.service.ts](../../server/src/modules/purchase-orders/payables/purchase-payable-query.service.ts) 中：

- `salesOrder` 选择增加出单人用户 ID。
- `parts` 选择增加 `items`：`quantity`、`line.productId`、`line.productNameSnapshot`，按 `lineNumber` 排序；仍只取前 6 个有效货件。
- 批量收集所有订单的 `(issuerUserId, productId)`，一次查询别名，禁止 N+1。
- 每个货件生成自己的后缀和 `shippingMarks` 字符串。
- `shippingMarkSuffix` 公共字段保留为销售级 `prefix-customer` 兼容字段，更新描述；渲染以 `shippingMarks` 为准。若外部消费者需要每货件后缀，再新增并行数组。
- 对账单图片 `MAX_SHIPPING_MARK_LENGTH` 从 300 改为 500；测试 500 边界。

### 9.4 前端复制文案

- [purchase-order-copy.logic.ts](../../web/apps/qsmds-arco/src/views/operations/purchase-orders/purchase-order-copy.logic.ts) 删除本地 `labelSuffix` 拼接。
- 使用 `part.shippingMarkSuffix` 生成 `【mark】suffix`。
- 货件内产品名列表的展示保持不变；它只用于复制文案正文，不参与后缀。

## 10. 产品库页面设计

### 10.1 路由与菜单

在 [operations.workbench.ts](../../web/apps/qsmds-arco/src/router/modules/operations.workbench.ts) 数组最前面新增：

```ts
{
  path: '/qs-operations/products',
  name: 'qsOperationsProducts',
  component: () => import('@/views/operations/product-library/index.vue'),
  meta: {
    title: '产品库',
    icon: 'qs-products',
    singleMenu: true,
    auth: 'products:read',
  },
}
```

当前“看机预约”路由随之后移；更新路由顺序测试。

### 10.2 页面定位与形态

- 管理员“产品管理”回答的是“维护产品主数据”：表格、分类树、编辑、启停、批量图片。
- 运营“产品库”回答的是“找产品、看完整资料、设自定义名称”：横向长方形卡片（左图右信息）、顶部筛选、详情抽屉、别名弹窗。
- 运营页**不复用管理员产品列表页组件**，只复用 `ProductListItem` 适配、`ImageGroup`、`AmountDisplay`、`QsPersonDisplay`、`QsGenericDrawer`、`FaPagination`、`FaCard` 等底层组件。
- 图片依据：生产当前 220 个产品已有 94 张主图，单个有图产品 1 张，84% 接近正方形；按“90%+ 产品有图”的目标设计。未上传或加载失败的产品使用统一占位。
- 视频和产品属性当前均为 0；卡片不放视频/属性入口，详情按“有则显示”处理。

### 10.3 页面结构

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 产品库                                            共 220 个产品  [刷新] │
│ 浏览产品资料，维护你的唛头别名                                        │
├──────────────────────────────────────────────────────────────────────┤
│ [搜索名称/编号] [供应商▾] [分类▾] [产品头▾] [启用|全部|停用] [重置]   │
├──────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────┐ ┌────────────────────────────────┐ │
│ │ ┌──────────┐ 破碎机              │ │ ┌──────────┐ 木桌               │ │
│ │ │  产品主图 │ 自定义名称：破碎机  │ │ │  无图占位 │ 自定义名称：使用产品名 │ │
│ │ │         ● │ 台币 12,000        │ │ │         ● │ 台币 3,200          │ │
│ │ └──────────┘ 马币 1,800          │ │ └──────────┘ 马币 480            │ │
│ │              成本 8,000          │ │              成本 1,900          │ │
│ │                        [查看详情]│ │                        [查看详情] │ │
│ └────────────────────────────────┘ └────────────────────────────────┘ │
│ ...                                                                  │
│ [< 1 2 3 ... >]  每页 24                                             │
└──────────────────────────────────────────────────────────────────────┘
```

布局规则：

- 顶部 `FaPageHeader` + 筛选条；页面主体 `FaPageMain`。
- 卡片网格：移动端/窄屏 1 列，`xl` 2 列；每张卡片是横向长方形。
- 分页使用 `FaPagination`，默认每页 24，可选 24/48/96。
- 不做分类树、不做管理工具栏、不做批量选择。

### 10.4 卡片设计

- 横向结构：左侧固定方形图片区，右侧信息区；移动端图片约 112px，桌面约 160px。
- 图片区使用 `object-contain` + 浅中性背景，避免裁切工业设备边缘；使用媒体接口 `variant=thumb` 缩略图，`loading=”lazy”`、`decoding=”async”`。
- 无图或加载失败：同尺寸占位，展示产品分类图标或产品名首字，不能出现破图。
- 状态不使用文字标签：在图片右下角显示绿色（启用）/红色（停用）小圆点，带 `title` 与 `aria-label`。
- 信息区只展示：
  - 产品名称：使用 `qs-type-compact-title`（14px）并允许完整换行，确保 36 字符的现有最长标题不被截断。
  - 自定义名称（别名）：有别名显示别名，无别名显示“使用产品名”，可点击打开别名弹窗；无 `product-aliases:manage` 时隐藏该行。
  - 价格区：台币销售价、马币销售价、采购成本价，三行紧凑展示；成本使用中性色。
- **产品编号、分类、产品头、供应商不在卡片上展示**，统一在详情抽屉中查看。
- 无 `product-media:read` 时图片占位显示“无图片权限”，避免看似破图。
- 卡片底部放“查看详情”按钮；整卡也可点击打开详情。
- 点击自定义名称必须 `@click.stop`，不能同时打开详情。

### 10.5 详情抽屉

- 使用 `QsGenericDrawer`，桌面 `xl`，移动端全屏。
- 顶部：大图/图集、产品名称、产品编号、状态、别名标签。
- 价格：台币、马币、成本三张卡。
- 基础资料：分类、产品头、供应商、状态、备注。
- 产品属性/视频：有数据时显示，为空时隐藏对应区块。
- 审计信息：默认折叠（创建人/时间、更新人/时间、版本），避免运营页像管理页。
- 底部主操作：“设置别名”；不显示“编辑产品”。
- 详情使用 `GET /products/:id` 读取最新数据；别名从当前页映射读取，保存后同步更新。

### 10.6 筛选、分页与数据

- 关键字：产品名称/编号，300ms 防抖，重置到第 1 页。
- 供应商：5 个选项。
- 分类：32 个分类，按供应商联动；单分类最多 24 个产品。
- 产品头：按分类联动；未选分类时禁用或只显示“全部产品头”。
- 状态：启用 / 全部 / 停用，默认“启用”。
- 重置：清空关键字、供应商、分类、产品头，状态回到默认。
- 数据来源：
  - 产品列表：`GET /products`，沿用 `keyword/status/supplierValue/categoryId/productHeadId/page/pageSize`。
  - 分类/产品头计数：`GET /products/taxonomy-tree`（`products:read`）。
  - 供应商标签：字典目录 `service_provider.supplier`（Session-only）。
  - 我的别名：`GET /product-aliases/mine?productIds=...`，只查当前页 24 个产品。
  - 详情：`GET /products/:id`。
- 不新增产品查询接口，不提供按别名搜索，不新增别名筛选。

### 10.7 别名 UI

- 新 API 模块 `api/modules/product-aliases.ts`。
- 页面组合式逻辑/子组件负责：
  - 按当前页产品 ID 批量读取本人别名。
  - 维护 `Map<productId, alias>`。
  - 打开设置别名弹窗；保存/清除后局部更新卡片和详情。
  - 请求取消、auth epoch、错误提示沿用现有列表页模式。
- 卡片别名标签和详情抽屉“我的别名”卡片共用同一个弹窗。
- 弹窗：
  - 输入最长 36，显示字符计数。
  - 允许 `*`；禁止 `×`、控制字符、换行。
  - 留空/清除 → 回退产品名。
  - 提示修改会影响历史单据的唛头。
  - 相同值重复保存不写审计。
- 不提供按别名搜索。

### 10.8 权限与媒体

- 页面读取：`products:read`。
- 媒体内容：`product-media:read`。
- 别名读写：`product-aliases:manage`。
- 采购成本价直接显示。
- 页面测试覆盖三种权限组合：只读产品、可看媒体、可维护别名。
- 无媒体权限时卡片使用占位、详情显示“无权读取媒体内容”；无别名权限时隐藏别名标签和弹窗入口。

### 10.9 状态与性能

- 加载态：8 个骨架卡片，`aria-busy`。
- 空态：图标 + “没有匹配的产品” + 重置筛选。
- 错误态：`FaAlert` + 重试；有 requestId 时展示。
- 图片加载失败：回退占位，不影响卡片布局。
- 卡片图只加载 `thumb`，原图仅在详情加载；避免一次列表请求 24 张原图。
- 列表请求、别名请求和详情请求均支持 AbortController 与 auth epoch 校验。
- 打开详情抽屉不重置列表筛选和页码；返回列表保持当前位置。

## 11. 兼容性与影响

### 11.1 历史行为

- 所有 SALES_LINKED 目录货件上线后立即使用新格式；没有别名的产品显示产品名。
- STOCK 也从 `【唛头】公司囤货采购` 变为 `【唛头】产品名…（公司囤货采购）`。
- 历史采购单图片草稿因模板版本 6 全部失效；待审核订单需要重新生成。
- 历史应付对账单重新生成时标签会变化；这是“实时解析”的已确认结果。
- 采购单列表、货件列表等位置的原始唛头文本不变。

### 11.2 公共契约

- 新增三个别名接口。
- 采购详情新增 `parts[].shippingMarkSuffix`（additive）。
- 应付 DTO 的 `shippingMarkSuffix` 保留兼容语义，`shippingMarks` 为权威输出。
- 需要执行契约同步和一致性检查；不得手改生成类型。

### 11.3 权限与登录

- 迁移授权后用户需重新登录。
- 自定义角色需手工授予三个权限。
- 若生产运营角色不是内置 `operations_staff`，迁移不会自动授权，需要角色管理补授权。

### 11.4 性能

- 采购详情增加一次别名批量查询（仅 SALES_LINKED）。
- 应付批量查询增加货件项→采购行数据；单订单最多取 6 个货件，但每个货件可能有多行，需用批量查询并评估最坏情况。
- 500 字符标签会增加对账单图片/采购单图片高度；需要验证 `MAX_HEIGHT` 边界。
- 产品库卡片图使用 `variant=thumb` 并懒加载，原图只在详情加载；单页 24 张缩略图不得退化为 24 张原图。

## 12. 验证计划

### 12.1 共享生成器单测

- 有别名/无别名回退产品名。
- 数量 1 / 大于 1；`×` 显示。
- 目录产品同货件多行聚合；跨货件不聚合。
- 自定义同名多行保留多个条目。
- 按 `lineNumber` 排序；聚合条目位置取首次行号。
- 前缀/客户名缺一/全空。
- STOCK 只显示产品名 + `（公司囤货采购）`。
- 438 截断、`…`、不截断 `×数量`。
- 完整长度不超过 500。
- 别名/产品名规范化。

### 12.2 Server 测试

- 别名 CRUD：本人可读写、他人不可见/不可写、404、422、36 字符、控制字符/换行/`×` 拒绝。
- 唯一约束和相同值无审计。
- 审计事件与事务回滚。
- 权限迁移、seed 计数、auth 权限清单。
- 采购详情 `shippingMarkSuffix` 字段。
- 图片快照/渲染器模板版本 6 和货件项排序。
- 应付查询每货件后缀、批量别名查询、6 条上限。
- 对账单 500 边界。

### 12.3 Web 测试

- 路由顺序：产品库在看机预约之前。
- 产品库：横向长方形卡片、左图右侧产品名/自定义名称/价格区、图片右下角状态圆点、响应式 1/2 列。
- 卡片摘要和详情抽屉完整信息、采购成本、媒体。
- 无管理动作；三种权限组合。
- 别名标签“使用产品名”、卡片/详情设置与清除、36 字符校验。
- 筛选：供应商/分类/产品头联动、状态默认启用、重置回第 1 页。
- 分页：24/48/96，打开详情不重置筛选和页码。
- 图片加载失败回退占位；无媒体权限占位提示。
- 复制文案使用服务端后缀，逐字一致。
- 对账单图片 500 边界。

### 12.4 真实渲染

- 亮色/暗色采购单图片各一张，包含长别名、数量、多个货件。
- 对账单图片包含 500 字符边界标签、6 条唛头。
- 大数量/10 个产品条目/拆货件场景。
- 图片和对账单 `MAX_HEIGHT` 边界；必要时记录容量上限。

### 12.5 契约与迁移

- `contract:sync` / `contract:check`。
- 迁移在隔离 PostgreSQL 重放、二次 deploy 无待执行项、自检通过。
- 开发库应用需单独确认；生产迁移/发布不在本文档授权范围。

## 13. 实施顺序

1. **阶段 1：产品库与别名**
   - 迁移、表、权限、seed、审计事件。
   - 别名 API、审计、测试。
   - 运营产品库路由、横向长方形卡片页面、详情抽屉、自定义名称/弹窗、测试。
2. **阶段 2：唛头格式与消费者**
   - 共享生成器与单元测试。
   - 采购详情每货件后缀。
   - 图片快照/渲染器、模板版本 6、货件项排序。
   - 应付查询与对账单 500 边界。
   - 复制文案切换。
3. 两部分建议同一发布批次上线，避免“别名可见但唛头不生效”。
4. 上线前准备发布说明，明确历史标签变化、图片草稿失效、权限需重新登录。

## 14. 风险与边界

- **历史标签变化**：所有销售关联采购单的图片、复制文案、对账单都会变化；已确认接受。
- **图片草稿**：模板版本升级导致历史草稿失效；待审核订单必须重新出图。
- **对账单高度**：500 字符标签可能增加对账单/采购单图片高度，需真实渲染验证。
- **公共字段语义**：应付 `shippingMarkSuffix` 保留兼容语义，渲染以 `shippingMarks` 为准；修改或删除该字段需单独确认。
- **无数据库唯一约束**：同一产品多行依赖生成器按 `productId` 聚合兜底；自定义同名多行按不同产品保留。
- **`×` 视觉歧义**：别名禁止 `×`，但产品名可能包含 `×`，系统不解析标签，只做展示。
- **权限未刷新**：迁移授权后需重新登录；自定义角色需手工授权。
- **容量**：单货件最多 10 个产品条目是当前数据观察，不是结构上限；438 截断是最终保护。
- **未实施**：本文档不包含代码、迁移、数据变更或部署动作。
