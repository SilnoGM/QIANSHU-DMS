# 采购订单列表汇总行技术设计

## 1. 设计目标

参考销售订单列表的服务端全量聚合与前端汇总矩阵，为采购订单共享列表增加固定 `CNY` 汇总。汇总使用与分页列表相同的 `where` 谓词，避免客户端按当前页求和造成口径错误。

## 2. 服务端设计

### 2.1 响应契约

新增 `PurchaseOrderCurrencySummaryDto`：

```ts
interface PurchaseOrderCurrencySummaryDto {
  currencyCode: 'CNY'
  orderCount: number
  referenceSubtotalAmount: string
  purchaseTotalAmount: string
  depositDueAmount: string
  balanceDueAmount: string
  paidAmount: string
  outstandingAmount: string
}
```

`PurchaseOrderPageDto` 增加 `summariesByCurrency`。采购币种当前固定为 `CNY`，因此有数据时数组只包含一行，空结果时为空数组；字段命名与销售列表保持一致，便于两个列表形成同构契约。

### 2.2 聚合查询

`PurchaseOrderQueryService.list()` 在同一个 Prisma transaction 中执行：

1. 当前筛选结果总数；
2. 当前分页订单；
3. 订单金额聚合；
4. 匹配订单的采购明细采购定价与数量；
5. 匹配订单的有效付款聚合。

采购定价总计使用现有定点金额工具计算：

```text
referenceSubtotalAmount = Σ(referencePurchaseUnitPriceAmount × quantity)
outstandingAmount = purchaseTotalAmount - paidAmount
```

分页行的付款明细仍按当前页订单 ID 聚合，避免改变既有列表字段含义。

## 3. Web 设计

- `index.vue` 保存 `summariesByCurrency`，每次列表请求成功时替换，失败或身份变化时清空。
- 使用 `QsGenericTable` 的 `summary` 插槽复刻销售订单汇总矩阵。
- 桌面端分组：
  - 采购价：本单采购、采购定价；
  - 付款约定：定金、尾款；
  - 付款：已付、待付。
- 移动端按同样顺序使用两列定义列表。
- 金额格式化复用 `AmountDisplay` 的底层精确格式化函数，并在币种行中去掉重复的末尾 `CNY`。

## 4. 测试策略

- Server 单元测试：固定全量筛选谓词、六项金额、空结果和有效付款口径。
- Web 逻辑测试：固定汇总金额格式化，不引入浮点数。
- Web 页面契约测试：固定响应接入、桌面矩阵、移动汇总与共享列表结构。
- 契约检查：重新生成并同步 Server/Web OpenAPI snapshot。
- 浏览器验收：验证全部采购、待办采购、筛选后汇总联动和移动布局。

## 5. 安全与边界

- 不修改数据库 schema。
- 不信任客户端汇总。
- 不记录付款明细或敏感请求体。
- 不增加逐行 HTTP 请求或数据库 N+1 查询。
