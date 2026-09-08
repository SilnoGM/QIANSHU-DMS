# 采购订单接入销售订单选择弹窗技术设计

## 总体方案

保留采购域专用接口 `/api/purchase-orders/source-sales-orders` 作为权限和业务边界，在该接口上补齐公共选择器需要的只读摘要字段。采购页面不直接调用 `/api/sales-orders`，因此仅具备 `purchase-orders:create` 的用户仍可完成采购来源选择。

## 服务端设计

### 来源订单列表

扩展 `PurchaseOrderSourceSalesOrderListItemDto`：

- `issuer`
- `orderStatus`
- `fulfillmentStatus`
- `paymentStatus`
- `lineSummary.lineCount`
- `lineSummary.totalQuantity`
- `lineSummary.previews[]`

来源查询继续固定 `orderStatus = CONFIRMED`。列表一次性读取订单明细和当前有效产品主图，`CUSTOM` 行或无主图行返回 `mainImage = null`。

### 来源产品主图

新增 `GET` 和 `HEAD`：

`/api/purchase-orders/source-sales-orders/{salesOrderId}/lines/{lineId}/main-image/{productMediaId}/content`

端点要求 `purchase-orders:create`，并重新校验销售订单、销售明细、目录产品和当前有效主图之间的关系。内容输出继续复用 `ProductMediaContentService`。

### 契约同步

更新 Nest DTO 和 OpenAPI 契约后，使用仓库既有生成脚本同步 Web generated client。无数据库 schema 或 migration 变更。

## Web 设计

保留 `purchase-source-sales-order-selector.vue` 作为采购域适配器：

- 负责请求生命周期、AbortSignal、搜索与分页状态；
- 将采购来源 DTO 传给 `QsSalesOrderSelectorModal`；
- 将弹窗确认结果回传给采购创建页；
- 取消时不覆盖当前已选销售订单。

采购创建页继续调用 `selectSourceSalesOrder()` 加载剩余可采购明细，第二步同步逻辑保持不变。

## 视觉与响应式

- 风格：Industrial / utilitarian，沿用运营工作台现有视觉系统。
- 颜色：沿用主题变量，基准为 `#009A44`、`#FFFFFF`、`#F5F7F6`、`#D7DED9`、`#111827`。
- 字体：`Noto Sans SC` 与 `Noto Sans Mono`。
- 布局：采购页仍为左侧分步表单和右侧实时详情；公共弹窗使用既有桌面端和移动端布局。

## 测试策略

1. 服务测试覆盖 DTO 映射、固定 `CONFIRMED` 筛选、主图 URL 和无图产品。
2. 控制器契约测试覆盖新 GET/HEAD 路由、权限与 OpenAPI operation id。
3. 图片服务测试覆盖合法关系、关系失效和媒体读取失败。
4. Web 契约测试覆盖公共组件接入、显式确认、取消、搜索、分页和 AbortSignal。
5. 执行 Server/Web 类型检查、Lint、生产构建以及 1440px/390px 浏览器验收。
