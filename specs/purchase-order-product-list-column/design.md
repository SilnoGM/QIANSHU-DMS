# 采购订单列表产品列技术设计

## 1. 设计目标

在不修改数据库 schema、不追加 Web 逐单详情请求的前提下，为“全部采购”和“待办采购”共享列表增加“产品”列。列表通过服务端摘要契约取得产品名称快照与当前可用主图，Web 复用销售订单列表已经验证的 `ImageGroup + QsGoodTooltipContent` 组合。

## 2. 当前真相源

### 2.1 销售订单参考实现

- `server/src/modules/sales-orders/sales-order-query.service.ts`
  - `SALES_ORDER_LIST_SELECT` 在分页列表查询中一次性选择订单明细、目录产品和当前 READY 主图。
  - `mapLineSummary()` 返回完整 `previews`，由 Web 根据有图项计算图片组折叠数量。
- `server/src/modules/sales-orders/sales-orders.controller.ts`
  - 销售列表主图使用独立的 `sales-orders:read` GET / HEAD 端点。
- `web/apps/qsmds-arco/src/views/operations/sales-orders/index.vue`
  - “产品”列最小宽度为 `160px`。
  - `ImageGroup` 使用 `max-count=3`、`size=40`、`radius=md`。
  - 每个可见图片槽位通过稳定的明细 ID 反查 preview，并用 `QsGoodTooltipContent` 展示对应产品信息。

### 2.2 采购订单现状

- `PurchaseOrderListItemDto` 尚未提供产品摘要。
- `PURCHASE_ORDER_LIST_SELECT` 尚未选择采购明细和产品媒体。
- 现有采购图片端点均属于录单场景并要求 `purchase-orders:create`：
  - 产品候选主图端点；
  - 来源销售订单明细主图端点。
- 采购列表是“全部采购”和“待办采购”的共享页面，因此只需改造一套列表查询与展示。

## 3. 服务端设计

### 3.1 OpenAPI 响应契约

在 `purchase-order-response.dto.ts` 新增以下只读 DTO：

```ts
export class PurchaseOrderListImageDto {
  readonly id!: string
  readonly contentUrl!: string
}

export class PurchaseOrderLinePreviewDto {
  readonly lineId!: string
  readonly productName!: string
  readonly mainImage!: PurchaseOrderListImageDto | null
}

export class PurchaseOrderLineSummaryDto {
  readonly lineCount!: number
  readonly totalQuantity!: number
  readonly previews!: readonly PurchaseOrderLinePreviewDto[]
}
```

`PurchaseOrderListItemDto` 新增必返字段：

```ts
readonly lineSummary!: PurchaseOrderLineSummaryDto
```

字段语义：

- `lineCount`：采购明细行数，包含 `CATALOG` 与 `CUSTOM`。
- `totalQuantity`：全部采购明细 `quantity` 之和。
- `previews`：按照 `lineNumber ASC, id ASC` 返回全部采购明细，不能只返回前三条；前端需要完整数组计算有图产品的折叠数量。
- `productName`：读取 `productNameSnapshot`，确保列表展示订单保存时的采购产品语义。
- `mainImage`：仅 `CATALOG` 且目录产品存在当前 READY 主图时返回；`CUSTOM` 或无图产品返回 `null`。

### 3.2 列表查询

扩展 `PURCHASE_ORDER_LIST_SELECT.lines`：

```ts
lines: {
  orderBy: [{ lineNumber: 'asc' }, { id: 'asc' }],
  select: {
    id: true,
    lineType: true,
    productId: true,
    productNameSnapshot: true,
    quantity: true,
    product: {
      select: {
        media: {
          where: {
            kind: 'IMAGE',
            isPrimary: true,
            detachedAt: null,
            mediaAsset: { is: { status: 'READY' } },
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: 1,
          select: { id: true },
        },
      },
    },
  },
}
```

列表映射新增 `mapLineSummary(row)`。主图 URL 固定生成：

```text
/api/purchase-orders/{purchaseOrderId}/lines/{lineId}/main-image/{productMediaId}/content
```

该查询仍是单次分页列表查询，不引入 Web N+1，也不增加数据库往返次数。关系选择可能增加单页查询负载，因此测试覆盖明细完整性，并在浏览器验收时检查列表只发起一个 JSON 列表请求；图片内容请求由浏览器按可见资源独立加载。

### 3.3 列表主图读取端点

新增参数 DTO `PurchaseOrderLineProductImageParamDto`，包含三个 UUID：

- `purchaseOrderId`
- `lineId`
- `productMediaId`

新增端点：

```text
HEAD /api/purchase-orders/:purchaseOrderId/lines/:lineId/main-image/:productMediaId/content
GET  /api/purchase-orders/:purchaseOrderId/lines/:lineId/main-image/:productMediaId/content
```

端点约束：

- 权限：`purchase-orders:read`。
- OpenAPI 契约：复用 `ApiProductMediaContentContract`。
- operationId：
  - `purchase_orders_head_product_preview_main_image`
  - `purchase_orders_get_product_preview_main_image`
- 关系无效统一返回 `404 / PURCHASE_ORDER_PRODUCT_IMAGE_NOT_FOUND`。
- 支持现有产品媒体内容服务的 `If-None-Match`、Range、GET 与 HEAD 行为。

### 3.4 图片关系重新校验

在 `PurchaseOrderProductImageService` 新增 `resolveListPreview()`。每次内容请求必须同时验证：

1. 采购明细 ID 属于 URL 中的采购订单；
2. 明细类型为 `CATALOG` 且 `productId` 非空；
3. 明细指向的目录产品仍拥有请求的媒体关系；
4. 媒体为 `IMAGE`、`isPrimary=true`、`detachedAt=null`；
5. 媒体资产状态为 `READY`。

历史采购订单读取不重新要求产品处于 ACTIVE、仍有供应商或仍具备有效采购成本。那些条件属于创建采购候选资格，不应使已经保存的采购订单列表因为产品档案后续停用而失去图片读取能力。

## 4. Web 设计

### 4.1 契约同步

服务端 OpenAPI 更新后执行仓库既有契约同步命令，使用生成的：

- `PurchaseOrderListItemDto.lineSummary`
- `PurchaseOrderLinePreviewDto`

Web 不手写与服务端重复的接口类型。

### 4.2 产品列位置与宽度

在采购列表列定义中，将“产品”列放在“供应商”之后、“采购金额”之前：

```ts
{
  accessorFn: item => item.lineSummary.lineCount,
  id: 'productSummary',
  minWidth: 160,
  title: '产品',
}
```

理由：采购订单、销售来源、供应商共同描述订单来源；产品摘要紧邻这些识别信息；金额及付款字段继续成组排列。

### 4.3 图片组与 Tooltip

新增两个局部辅助函数，与销售列表保持同一契约：

- `productImageItems(row)`：过滤 `mainImage === null` 的 preview，以 `lineId` 作为稳定 key。
- `resolveProductPreview(row, item)`：按 `lineId` 反查 Tooltip 对应的产品快照，避免折叠或重排后串项。

桌面单元格配置：

```vue
<ImageGroup
  :items="productImageItems(row.original)"
  :max-count="3"
  :size="40"
  radius="md"
/>
```

`max-count=3` 沿用现有 `ImageGroup` 行为：

- 1 至 3 张有图产品：显示对应实图；
- 超过 3 张：显示 2 张实图和 1 个 `+N` 折叠槽位；
- 超出部分不在图片组之外追加渲染。

每个可见图片槽位的 Tooltip 使用 `QsGoodTooltipContent`，标题为“采购产品”，展示当前有图产品在图片集合中的序号与产品名称。无可用主图时沿用 `ImageGroup` 标准空态。

### 4.4 移动端

在采购订单移动卡片的“供应商”之后增加跨两列“产品”项，复用同一 `productImageItems()` 和 Tooltip 解析函数。移动端不新增独立卡片、不展示价格或产品文字清单，也不引入新的横向滚动容器。

## 5. 测试设计

按 TDD 顺序实施。

### 5.1 服务端失败测试

1. `purchase-order-query.service.spec.ts`
   - 列表映射返回完整 `lineSummary`；
   - `CATALOG` 有图生成采购列表图片 URL；
   - `CUSTOM` 与无图目录产品返回 `mainImage: null`；
   - `lineCount` 与 `totalQuantity` 统计全部明细；
   - 超过三条 preview 时服务端仍返回完整数组。
2. `purchase-order-product-image.service.spec.ts`
   - 合法历史采购明细可读取主图；
   - 订单、明细、产品或媒体关系不匹配时返回稳定 404；
   - 不要求产品继续满足创建候选资格。
3. `purchase-orders.controller.spec.ts`
   - OpenAPI 同时暴露 GET / HEAD 路径；
   - 两个端点要求 `purchase-orders:read`；
   - operationId 和错误码稳定。

### 5.2 Web 失败测试

采购列表页面测试覆盖：

- 新增“产品”列及 `160px` 最小宽度；
- 桌面和移动端都传入 `max-count=3`、`size=40`、`radius=md`；
- 有图项按 `lineId` 与 Tooltip 内容对应；
- 无图项不进入图片数组；
- “全部采购”和“待办采购”继续复用同一页面实现。

### 5.3 回归与运行时验收

- 运行受影响 Server 单元测试与 Web 单元测试。
- 执行 OpenAPI 生成 / 契约一致性检查。
- 执行 `node --run check`。
- 浏览器分别验证“全部采购”和“待办采购”：图片尺寸、折叠槽位、Tooltip、空态、移动布局及无额外详情 JSON 请求。

## 6. 非变更项与风险控制

- 不修改数据库 schema 或数据。
- 不修改销售订单列表实现。
- 不复用 `purchase-orders:create` 的图片读取端点。
- 不修改 `ImageGroup` 或 `QsGoodTooltipContent` 的公共 API。
- 不新增依赖、主题 Token、动画或产品详情交互。
- 不改变采购列表现有筛选、分页、待办状态或处理按钮逻辑。
