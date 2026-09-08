# 采购订单待办分类需求

## 1. 背景与目标

采购订单提交后已经完成下单事实确认，不再经过“待下单”状态。待办采购页面需要按实际处理任务拆分订单，让采购人员从同一页面进入待发货、待入仓和待付款工作队列。

## 2. 业务规则

1. 删除采购履约状态 `PENDING_ORDER`，历史 `PENDING_ORDER` 数据迁移为 `ORDERED`。
2. 新采购订单正式提交后，履约状态直接为 `ORDERED`。
3. 履约状态只允许 `ORDERED -> PREPARING -> SHIPPED -> SIGNED` 顺序流转。
4. 待办采购提供以下任务筛选：
   - `AWAITING_SHIPMENT`（待发货）：`orderStatus != CANCELLED` 且 `fulfillmentStatus IN (ORDERED, PREPARING)`。
   - `AWAITING_WAREHOUSE`（待入仓）：`orderStatus != CANCELLED` 且 `fulfillmentStatus = SHIPPED`。
   - `AWAITING_PAYMENT`（待付款）：`orderStatus != CANCELLED` 且 `paymentStatus IN (UNPAID, PARTIALLY_PAID)`。
5. 三类任务允许重叠；例如备货中且未付款的订单同时属于待发货与待付款。
6. 首期行操作仅提供轻提示，不修改订单状态或付款数据：
   - 待发货：发货、付款。
   - 待入仓：到仓、付款。
   - 待付款：付款。
7. 全部采购页面保留现有详情、履约和付款能力。

## 3. 非目标

- 不实现发货、到仓和付款按钮对应的业务写入。
- 不新增采购履约状态。
- 不修改销售订单状态模型。
- 不改变订单、履约和付款三个状态维度独立维护的原则。

## 4. 验收标准

1. 数据库和公开契约均不再暴露 `PENDING_ORDER`。
2. 新采购订单以 `ORDERED` 保存，历史 `PENDING_ORDER` 数据无损迁移为 `ORDERED`。
3. 待办采购使用 `QsStatusSwitchToolbar`，默认展示待发货。
4. 三类筛选由服务端执行，翻页、搜索和日期筛选后语义保持一致。
5. 待办行操作与当前分类一致，点击只展示轻提示且不发起 mutation。
6. 全部采购的现有操作不受影响。
