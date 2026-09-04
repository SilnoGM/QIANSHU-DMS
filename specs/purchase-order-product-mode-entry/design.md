# 采购产品类型前置选择与销售来源过滤技术设计

## 1. 文档状态

- 状态：待确认
- 编写日期：2026-09-04
- 需求规格：[`requirements.md`](./requirements.md)
- 当前分支：`feat/purchase-order-domain`
- 本文只定义技术方案，不授权实现、生成 migration、修改公共 API 或写数据库。

## 2. 结论

采用“采购来源类型 + 产品采购类型”双维度设计：

- 保留 `PurchaseOrderType.SALES_LINKED/STOCK` 表示是否关联销售订单；
- 新增 `PurchaseOrderProductMode.CATALOG/CUSTOM/MIXED` 表示订单明细构成；
- 新创建接口只接受 `CATALOG/CUSTOM`，`MIXED` 只承载历史事实；
- `CATALOG` 使用字典 `supplierValue`；
- `CUSTOM` 新订单使用自由文本 `customSupplierName`；
- 来源销售订单列表与明细接口同时接受 `productMode`，`CATALOG` 额外接受 `supplierValue`，并在服务端按目标剩余明细过滤。

该方案需要 append-only migration、Prisma Schema、公共 OpenAPI、Server 和 Web 同步变更，不能作为纯前端弹窗实现。

## 3. 当前实现差距

| 当前事实 | 目标变化 |
| --- | --- |
| `purchaseType` 只有 `SALES_LINKED/STOCK` | 新增独立 `productMode`，不污染现有含义 |
| `PurchaseOrder.supplierValue` 非空且必须是有效字典值 | 新 `CUSTOM` 订单改存自由文本供应商名称 |
| 来源销售订单查询只有 `view/keyword/page/pageSize` | 增加按 `productMode` 与 `supplierValue` 的服务端过滤 |
| 来源明细接口返回订单全部未删除行 | 只返回目标类型、供应商和剩余数量范围内的明细及相关已采购事实 |
| 同步时 Web 读取所选供应商全部产品再与来源行求交集 | Server 先过滤来源，Web 仍使用产品选项补充当前成本和主图，提交端再次校验 |
| 供应商读取逻辑假定 `supplierValue` 永远存在 | 列表、详情、发货等下游统一适配字典或自由文本供应商 |

2026-09-04 对本地开发库执行只读统计：5 张存在明细的采购单中，3 张仅 `CATALOG`，2 张为 `CATALOG + CUSTOM`，0 张仅 `CUSTOM`。该结果只代表本地开发库，证明迁移不能假定历史订单都能回填为单一新建模式；任何其他环境执行迁移前必须重新统计。

## 4. 数据模型设计

### 4.1 新枚举

```prisma
enum PurchaseOrderProductMode {
  CATALOG
  CUSTOM
  MIXED
}
```

`MIXED` 只用于历史读取和响应。创建 DTO 使用单独的允许值集合 `CATALOG/CUSTOM`，不得直接用完整 Prisma 枚举放开新建 `MIXED`。

### 4.2 `PurchaseOrder` 字段

```prisma
model PurchaseOrder {
  // existing fields omitted
  productMode        PurchaseOrderProductMode @map("product_mode")
  supplierValue      String?                  @map("supplier_value") @db.VarChar(64)
  customSupplierName String?                  @map("custom_supplier_name") @db.VarChar(128)
}
```

数据库增加订单级供应商来源互斥约束：

```sql
CHECK (
  (supplier_value IS NOT NULL AND custom_supplier_name IS NULL)
  OR
  (supplier_value IS NULL AND custom_supplier_name IS NOT NULL)
)
```

同时保留两列各自的非空白约束。这里不把 `productMode` 与供应商列做绝对数据库绑定，因为历史 `CUSTOM/MIXED` 订单使用字典供应商；新建组合由服务端强制校验：

| 新建 `productMode` | `supplierValue` | `customSupplierName` | 明细类型 |
| --- | --- | --- | --- |
| `CATALOG` | 必填且有效 | 禁止 | 全部 `CATALOG` |
| `CUSTOM` | 禁止 | 必填 | 全部 `CUSTOM` |
| `MIXED` | 不允许新建 | 不允许新建 | 仅历史读取 |

### 4.3 历史回填

迁移在增加 `productMode NOT NULL` 前按每张采购单的明细类型回填：

```sql
CASE
  WHEN has_catalog AND has_custom THEN 'MIXED'
  WHEN has_custom THEN 'CUSTOM'
  ELSE 'CATALOG'
END
```

- 所有历史订单保留原 `supplierValue`；
- 不拆分采购单，不修改 `orderNo`、金额、状态、来源关系和审计历史；
- 不根据字典标签伪造 `customSupplierName`；
- 迁移加入前后计数断言，并在未知明细类型或无明细采购单存在时失败；
- migration 不使用 `CASCADE`，不改写既有 migration。

### 4.4 索引

- 保留现有 `supplierValue + orderDate + id` 索引，允许新自定义订单在该索引中取 `NULL`；
- 新增 `customSupplierName + orderDate + id` 普通索引只服务精确/前缀运维查询；
- 关键字包含查询首期不额外引入 PostgreSQL 扩展或 trigram 索引，待真实数据量证明需要后再优化。

## 5. 公共 API 设计

### 5.1 创建采购订单

扩展 `CreatePurchaseOrderRequestDto`：

```ts
interface CreatePurchaseOrderRequestDto {
  purchaseType: 'SALES_LINKED' | 'STOCK'
  productMode: 'CATALOG' | 'CUSTOM'
  supplierValue?: string
  customSupplierName?: string
  // existing fields omitted
}
```

规范化顺序：

1. 收窄 `purchaseType/productMode`；
2. 根据 `productMode` 验证供应商字段互斥；
3. `CUSTOM` 名称执行 NFKC、trim 和 1–128 code points；
4. 验证所有请求行 `lineType === productMode`；
5. 执行现有金额、来源、数量、字典、权限和发号前校验；
6. 将 `productMode` 和对应供应商字段纳入创建请求指纹。

新增稳定错误码建议：

- `PURCHASE_ORDER_PRODUCT_MODE_INVALID`
- `PURCHASE_ORDER_LINE_MODE_MISMATCH`
- `PURCHASE_ORDER_SUPPLIER_SOURCE_INVALID`
- `PURCHASE_ORDER_CUSTOM_SUPPLIER_INVALID`

### 5.2 来源销售订单列表

扩展：

```http
GET /api/purchase-orders/source-sales-orders
  ?view=UNPURCHASED|PARTIALLY_PURCHASED
  &productMode=CATALOG|CUSTOM
  &supplierValue=...
  &keyword=...
  &page=1
  &pageSize=20
```

- `CATALOG` 必须携带有效 `supplierValue`；
- `CUSTOM` 禁止携带 `supplierValue`，也不传 `customSupplierName`；
- 可选增加 `salesOrderId` 作为销售订单快捷入口的精确资格校验参数，必须是 UUID，不能取代现有 keyword 搜索；
- 返回的 `counts/total/items/lineSummary` 必须基于同一目标明细集合。

### 5.3 来源销售明细

扩展：

```http
GET /api/purchase-orders/source-sales-orders/{salesOrderId}/lines
  ?productMode=CATALOG|CUSTOM
  &supplierValue=...
```

该接口只返回符合目标条件的来源行；每行继续返回原始数量、有效已采购数量、剩余数量和历史采购行。服务端不得返回其他供应商或其他产品类型的无关行供 Web 自行决定。

### 5.4 采购列表与详情响应

采购列表和详情增加：

- `productMode`；
- `supplier.source = DICTIONARY | CUSTOM_TEXT`；
- `supplier.value: string | null`；
- `supplier.label: string`；
- 字典专属 `tone/known/effectiveEnabled` 改为可空，仅 `DICTIONARY` 有语义。

Web 使用 `supplier.source` 决定历史状态样式，不得把自由文本供应商渲染成未知字典值。关键字查询增加 `customSupplierName`。

### 5.5 OpenAPI 同步

Controller DTO 与 decorators 是契约真相源。实现时通过根 `contract:sync` 同步 Server snapshot、Web snapshot 和 generated client，禁止手改生成文件。

## 6. 服务端查询设计

### 6.1 目标来源行 CTE

在现有 `sourceSalesOrderFactsSql()` 中先建立 `eligible_source_lines`：

- 公共条件：`removed_at IS NULL`；
- `CATALOG`：`line_type = CATALOG`、关联当前 `Product`、`Product.supplier_value = supplierValue`；
- `CUSTOM`：`line_type = CUSTOM`；
- 按 `source_sales_order_line_id` 汇总所有未取消的 `SALES_LINKED` 采购数量；
- 只保留 `sales_quantity - active_purchased_quantity > 0` 的目标行。

### 6.2 订单候选分类

订单级资格继续要求：

- `orderStatus = CONFIRMED`；
- `fulfillmentStatus` 位于 `PENDING/PREPARING/LAND_TRANSIT/WAREHOUSE_ARRIVED`；
- 至少存在一条目标剩余来源行。

现有视图语义保持：

- `UNPURCHASED`：`PENDING` 且订单不存在有效采购记录；
- `PARTIALLY_PURCHASED`：订单存在有效采购记录、累计已采购数量大于零且目标剩余数量大于零。

分类仍基于订单整体有效采购事实，候选资格与摘要基于当前目标行。这样同一销售订单先采购供应商 A、再采购供应商 B 时，会在供应商 B 的“部分采购订单”中出现。

### 6.3 事务兜底

`PurchaseOrderCreateDependencyService` 继续：

- 锁定所有来源销售行；
- 重算未取消采购数量；
- 校验来源行属于目标订单；
- `CATALOG` 重新读取当前产品供应商和采购成本；
- `CUSTOM` 不检查产品级供应商，但检查订单级自由文本供应商；
- 拒绝类型不一致、数量越界和已失效状态。

候选查询只改善用户体验，不取代提交事务的可信校验。

## 7. Web 组件与页面设计

### 7.1 前置弹窗组件

新增业务组件建议命名 `QsPurchaseStartModal`，基于 `QsGenericModal`：

```ts
interface PurchaseStartSelection {
  purchaseType: 'SALES_LINKED' | 'STOCK'
  productMode: 'CATALOG' | 'CUSTOM'
  supplierValue: string | null
  customSupplierName: string | null
  presetSalesOrder?: { id: string; orderNo: string }
}
```

组件职责：

- 渲染两个互斥面板和条件化供应商控件；
- 维护局部草稿、就地校验、加载和 Abort 生命周期；
- 对销售订单快捷入口执行目标订单资格校验；
- 只有合法时发出 `confirm`，不自行写订单或发号；
- 关闭时清除局部草稿。

组件不负责路由、采购权限决策或最终创建请求；入口页面处理这些职责。

### 7.2 入口接入

- 全部采购页与待办采购页：按钮传入各自 `purchaseType` 后打开弹窗；
- “新增备货采购”继续由 `canCreateStock` 控制；
- 销售订单“新增采购”：传入 `SALES_LINKED` 和目标销售订单上下文；
- 确认后入口页面构造规范单值 query 并导航创建页。

建议路由参数：

```text
type=SALES_LINKED|STOCK
productMode=CATALOG|CUSTOM
supplierValue=<dictionary-value>             # CATALOG only
customSupplierName=<normalized-text>          # CUSTOM only
salesOrderId=<uuid>                           # sales shortcut only
salesOrderNo=<canonical-order-number>         # sales shortcut only
```

自由文本供应商不是秘密，但路由仍必须限制长度和单值。它会进入浏览器历史；如果未来供应商名称被认定为敏感信息，再改为短期会话状态，不在本期提前引入状态服务。

### 7.3 创建页初始化与联动

创建页新增纯函数解析初始化上下文，只有完整合法组合才能挂载表单：

- `productMode` 进入页面后只读展示；
- `CATALOG` 显示现有字典供应商控件；
- `CUSTOM` 显示供应商名称文本控件；
- 修改供应商前若已有下游数据，复用现有二次确认/放弃编辑交互；
- 确认修改后清空绑定订单、来源行、可编辑行、只读行、来源映射、数量上限、定金和尾款；
- `STOCK` 根据模式只开放一个新增入口；
- `SALES_LINKED` 根据模式请求经过过滤的销售订单和来源明细。

### 7.4 选择器与同步

`PurchaseSourceSalesOrderSelector` 继续作为采购域 API 适配器，并向公共 `QsSalesOrderSelectorModal` 传递过滤后的 DTO。切换视图、搜索或分页时固定携带 `productMode/supplierValue`。

同步不再用“加载所选供应商全部产品”来判断来源行是否属于供应商；来源接口已经收窄。Web 仍可按返回的 `productId` 批量读取/复用产品选项来获得当前采购成本和主图，提交服务端再做最终校验。

## 8. UI 设计

- 弹窗参考销售订单币种弹窗的面板选择语义，但不复制其固定高度；供应商第二步需要自然展开。
- 桌面端两个面板等宽，移动端单列。
- 面板使用原生 radio 语义和可见 focus ring，整个面板可点击。
- 选中态使用现有 `primary` 主题 Token；不硬编码只适配亮色的颜色。
- 第二步在面板选择后出现，切换面板时清空旧值。
- Footer 固定展示“取消 / 开始采购”；提交中锁定关闭与重复点击。
- 错误优先就地显示；目标销售订单不符合条件时使用 Warning Toast，不使用持久页面错误块。

## 9. 状态与失败处理

| 场景 | 行为 |
| --- | --- |
| 供应商字典尚未加载 | 禁用开始按钮，保留重试能力 |
| `CATALOG` 供应商失效 | 就地错误；服务端最终返回稳定业务错误 |
| `CUSTOM` 名称只有空白 | 规范化后视为空并阻止继续 |
| 销售快捷订单无目标剩余行 | 保留弹窗，Warning Toast 告知当前类型/供应商不可采购 |
| 创建页供应商变化 | 用户确认后清空全部依赖数据并重新选择订单 |
| 订单在弹窗后被其他请求采购 | 提交事务拒绝越界，页面保留可恢复编辑状态 |
| 登录身份变化或组件卸载 | Abort 请求，不回写过期状态 |
| 非法直接 URL | 返回安全列表入口并轻提示 |
| 未知提交结果 | 延续现有原幂等键重放机制 |

## 10. Migration 设计

实现阶段单独生成 append-only migration，顺序为：

1. 创建 `purchase_order_product_mode` enum；
2. 增加可空 `product_mode` 与 `custom_supplier_name`；
3. 统计并回填所有历史采购单；
4. 断言每张采购单至少一行且回填结果非空；
5. 将 `product_mode` 设为 `NOT NULL`；
6. 将 `supplier_value` 改为 nullable；
7. 增加供应商两列互斥、非空白约束；
8. 增加必要索引；
9. 复核订单数、明细数、金额和状态未变化。

应用任何数据库前必须再次只读统计目标环境的 `CATALOG/CUSTOM/MIXED` 分布。生成 migration 与应用 migration 都属于独立确认门，本设计确认不代表允许执行。

## 11. TDD 与验证策略

### 11.1 RED - Server

- DTO：产品模式、供应商字段互斥、长度和非法 `MIXED`；
- Normalizer：NFKC、trim、请求指纹；
- 来源查询：两种模式、供应商、多供应商订单、取消订单、剩余数量、计数和分页；
- Dependency：类型一致、供应商重校验、并发数量；
- Query：字典与自由文本供应商映射；
- Migration：空库重放、历史纯类型和混合类型回填、未知状态回滚；
- OpenAPI：新增 query/body/response 与错误码。

### 11.2 RED - Web

- 前置弹窗纯逻辑：面板切换清值、供应商校验、确认模型；
- 三类入口：全部采购、待办采购、销售快捷入口；
- 路由解析：合法组合、数组、缺失、超长和非法组合；
- 创建页：初始化、只读模式、供应商修改清空下游；
- 来源选择器：固定携带过滤条件、计数/搜索/分页、Abort；
- 产品编辑器：`STOCK` 只开放当前模式；
- 提交：请求字段和现有幂等未知结果恢复。

### 11.3 浏览器验收矩阵

至少覆盖：

1. 全部采购 -> `SALES_LINKED + CATALOG` -> 字典供应商 -> 过滤并同步匹配产品；
2. 全部采购 -> `SALES_LINKED + CUSTOM` -> 文本供应商 -> 只显示 CUSTOM 来源；
3. 管理员 -> `STOCK + CATALOG` -> 只能新增所选供应商产品；
4. 管理员 -> `STOCK + CUSTOM` -> 只能新增自定义产品；
5. 销售待采购快捷入口 -> 不符合条件时留在弹窗，符合时自动绑定；
6. 切换供应商 -> 清空绑定订单、产品和付款约定；
7. 390px 与 1440px 下的弹窗、键盘导航和创建页；
8. 历史 `MIXED` 采购单列表、详情和发货读取不回归。

### 11.4 验证命令

```bash
pnpm -C server prisma:validate
pnpm -C server typecheck
pnpm -C server lint
pnpm -C server test
pnpm -C web typecheck
pnpm -C web lint
pnpm -C web test
pnpm -C web build
node --run contract:check
node --run check
git diff --check
```

涉及真实浏览器测试时，先按项目既有脚本启动 3000/9000，再执行采购订单定向 Browser E2E；不得用静态页面断言替代真实 HTTP 流程。

## 12. 建议实施切片

设计确认后再进入 Phase 3 拆分，建议按以下独立提交边界规划：

1. `docs: 定义采购产品类型前置选择方案`
2. `feat: 增加采购产品类型与供应商来源模型`
3. `feat: 支持按产品类型过滤销售来源订单`
4. `feat: 新增采购开始选择弹窗`
5. `feat: 接入采购入口与创建页初始化`
6. `test: 补充采购产品类型端到端验收`

不推送远端、不创建 PR、不部署；数据库 migration 的生成和应用分别等待用户明确确认。
