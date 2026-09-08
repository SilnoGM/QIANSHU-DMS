# 销售订单采购覆盖进度联动需求

## 1. 文档状态

- 状态：已确认
- 编写日期：2026-09-01
- 依赖规格：[销售订单履约状态扩展需求](../sales-order-fulfillment-status/requirements.md)
- 关联规格：[采购订单域需求](../purchase-order-domain/requirements.md)

## 2. 需求简介

销售关联采购订单提交成功后，系统需要根据该销售订单下全部有效采购订单的累计采购数量，判断销售产品是否已经全部采购。全部覆盖时，销售订单履约状态从 `PENDING` 自动推进为 `PREPARING`；尚未全部覆盖时保持 `PENDING`。

当前销售待办工具栏将 `PENDING` 展示为“待采购”任务，将 `PREPARING` 展示为“待发货”任务。因此本需求所述“订单进度改为待发货”的技术含义是把 `fulfillmentStatus` 从 `PENDING` 更新为 `PREPARING`。本需求不调整列表、详情或选择弹窗中的既有状态文案。

## 3. 当前数据事实

1. 一个销售订单可以关联多个采购订单；销售关联采购通过 `PurchaseOrder.salesOrderId` 记录销售来源。
2. 每条销售关联采购明细通过 `PurchaseOrderLine.sourceSalesOrderLineId` 指向唯一的 `SalesOrderLine.id`。
3. 数据库产品和 `CUSTOM` 产品均具有销售明细 ID，因此覆盖判断不依赖 `productId`、产品名称或产品描述。
4. 现有采购创建规则已按销售明细累计非取消采购数量，并禁止累计采购数量超过销售数量。
5. 销售订单履约状态机只允许 `PENDING -> PREPARING`，不得跳级或倒退。

## 4. 术语与计算口径

### 4.1 有效采购订单

有效采购订单是满足以下全部条件的采购订单：

- `purchaseType = SALES_LINKED`；
- `salesOrderId` 等于当前销售订单 ID；
- `orderStatus != CANCELLED`。

备货采购不具备销售来源，不参与任何销售订单的覆盖计算。

### 4.2 销售明细已采购数量

对每一条 `SalesOrderLine`，按其 `id` 汇总所有有效采购明细的 `quantity`：

```text
purchasedQuantity(salesOrderLineId)
  = SUM(PurchaseOrderLine.quantity)
    WHERE sourceSalesOrderLineId = SalesOrderLine.id
      AND PurchaseOrder.orderStatus != CANCELLED
```

本次刚创建的采购明细必须包含在同一次计算中。

### 4.3 全部覆盖

当销售订单的每一条销售明细都满足以下条件时，视为全部覆盖：

```text
purchasedQuantity(salesOrderLineId) >= SalesOrderLine.quantity
```

判断单位是销售明细行而不是产品：相同数据库产品出现在多条销售明细时分别计算；多个 `CUSTOM` 行也分别计算。采购金额、采购定价、产品名称和描述不参与覆盖判断。

## 5. 需求与验收标准

### R1 - 提交后累计计算采购覆盖

**User Story：** 作为销售订单运营人员，我希望系统在采购订单提交后自动识别销售产品是否已经采购齐全，以便订单进入正确的后续待办。

#### Acceptance Criteria

1. 当销售关联采购订单成功写入采购订单及明细时，系统应在同一数据库事务中重新读取该销售订单的全部销售明细和全部有效采购明细。
2. 当同一销售订单由多张采购订单拆分采购时，系统应累计所有有效采购订单的采购数量。
3. 当销售订单包含数据库产品或 `CUSTOM` 产品时，系统应统一按 `sourceSalesOrderLineId` 和数量计算覆盖。
4. 当一张采购订单没有覆盖全部销售明细时，系统应保持销售订单 `fulfillmentStatus = PENDING`。
5. 当后续采购订单补齐最后一条或最后一部分销售数量时，系统应判定该销售订单已经全部覆盖。

### R2 - 自动推进销售订单履约状态

**User Story：** 作为销售订单运营人员，我希望采购齐全的订单自动离开“待采购”并进入“待发货”任务，以避免人工重复确认。

#### Acceptance Criteria

1. 当销售订单全部覆盖且当前 `fulfillmentStatus = PENDING` 时，系统应在采购创建事务中把 `fulfillmentStatus` 更新为 `PREPARING`。
2. 当销售订单尚未全部覆盖且当前 `fulfillmentStatus = PENDING` 时，系统应保持状态不变。
3. 当销售订单当前 `fulfillmentStatus != PENDING` 时，系统不得覆盖、倒退或跳转其履约状态。
4. 当销售订单从 `PENDING` 自动进入 `PREPARING` 时，现有销售待办查询应自然将其从“待采购”移入“待发货”。
5. 当状态未发生变化时，系统不得增加销售订单版本、状态历史或状态审计事件。

### R3 - 状态历史与审计

**User Story：** 作为审计人员，我希望自动推进仍然完整记录操作来源，以便追溯销售订单为何进入下一进度。

#### Acceptance Criteria

1. 当履约状态自动变化时，系统应新增一条 `dimension = FULFILLMENT` 的销售订单状态历史，记录 `fromStatus = PENDING`、`toStatus = PREPARING`。
2. 当履约状态自动变化时，系统应复用现有 `SALES_ORDER_FULFILLMENT_STATUS_CHANGED` 审计事件。
3. 当写入状态历史和审计事件时，系统应使用本次采购提交的操作用户作为 `changedByUserId` 和审计操作人。
4. 当写入自动推进审计元数据时，系统应标记该变更由采购覆盖触发，并记录本次创建的采购订单 ID。
5. 当幂等重放命中既有采购订单时，系统不得重复写入状态历史或审计事件。

### R4 - 原子性与并发一致性

**User Story：** 作为系统维护人员，我希望采购创建与销售进度联动保持原子和可重试，避免并发拆单导致状态遗漏。

#### Acceptance Criteria

1. 当采购订单、采购明细或销售进度任一步骤写入失败时，系统应回滚整个采购创建事务。
2. 当多个采购订单并发提交到同一销售订单时，系统应串行化覆盖判定，使最终累计数量全部覆盖时销售订单必然进入 `PREPARING`。
3. 当并发事务遇到现有可重试状态冲突时，系统应沿用采购创建的既有状态变化错误语义，不返回部分成功结果。
4. 当同一幂等键和同一请求内容重复提交时，系统应返回既有采购订单，不重复推进状态。
5. 当不同请求竞争同一销售明细的剩余数量时，系统应继续禁止超量采购。

## 6. 非目标

- 不新增或修改公共 API、DTO、OpenAPI 契约或前端提交字段。
- 不修改 Prisma Schema，不新增 migration，不回填历史销售订单。
- 不修改销售订单列表、详情、选择弹窗或状态中文文案。
- 不修改销售订单履约状态集合和既有顺序状态机。
- 不修改采购订单取消流程；取消采购订单后不自动把销售订单从 `PREPARING` 回退到 `PENDING`。
- 不修改销售订单产品的编辑规则，也不在本需求中处理销售明细变更后的反向重算。
- 不影响备货采购、采购付款、采购履约和采购自动完成规则。

## 7. 验收场景

| 场景 | 销售明细数量 | 提交前有效采购累计 | 本次采购 | 预期销售履约状态 |
| --- | ---: | ---: | ---: | --- |
| 单张完整采购 | A×2 | A×0 | A×2 | `PENDING -> PREPARING` |
| 单张部分采购 | A×2 | A×0 | A×1 | 保持 `PENDING` |
| 多张累计补齐 | A×2 | A×1 | A×1 | `PENDING -> PREPARING` |
| 多明细仅覆盖部分 | A×1、B×1 | A×0、B×0 | A×1 | 保持 `PENDING` |
| 多明细全部覆盖 | A×1、B×1 | A×1、B×0 | B×1 | `PENDING -> PREPARING` |
| 相同产品多销售行 | A 行1×1、A 行2×1 | 行1×1、行2×0 | 行2×1 | `PENDING -> PREPARING` |
| 包含 `CUSTOM` | A×1、CUSTOM×2 | A×1、CUSTOM×1 | CUSTOM×1 | `PENDING -> PREPARING` |
| 已进入后续物流状态 | A×1 | A×0 | A×1 | 保持当前后续状态 |
| 备货采购 | 无销售来源 | 不适用 | 任意 | 不修改任何销售订单 |
| 幂等重放 | A×1 | A×1 | 重放原请求 | 不新增状态历史或审计 |
