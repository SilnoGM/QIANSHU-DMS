# 采购订单待办分类技术设计

## 1. 数据与迁移

- Prisma `PurchaseOrderFulfillmentStatus` 删除 `PENDING_ORDER`，`PurchaseOrder.fulfillmentStatus` 默认值改为 `ORDERED`。
- 新增 append-only migration：锁定 `purchase_orders`，将历史 `PENDING_ORDER` 更新为 `ORDERED`，通过替换 PostgreSQL enum 删除旧值，并恢复 `ORDERED` 默认值。
- `purchase_order_status_history` 使用字符串快照保存状态编码；迁移同步把履约维度中的 `PENDING_ORDER` 改为 `ORDERED`，不创建虚假的业务流转记录。
- `audit_events.metadata` 中的采购履约 `fromStatus` / `toStatus` 同步改写，保证审计查询不残留失效编码。

## 2. 服务端契约

`GET /api/purchase-orders` 新增可选查询参数：

```text
pendingTask = AWAITING_SHIPMENT | AWAITING_WAREHOUSE | AWAITING_PAYMENT
```

- `pendingTask` 仅在 `view=pending` 时产生任务谓词。
- 未传 `pendingTask` 时保留既有待办总集合语义，避免通用调用方失去完整待办能力。
- 任务谓词与关键词、供应商、日期等筛选统一在 Prisma `where` 中组合，分页总数与列表使用同一条件。

## 3. 前端交互

- 待办采购在表格上方渲染 `QsStatusSwitchToolbar`。
- 页面通过 URL 查询参数 `task` 持久化当前任务；无效值和缺省值归一化为 `AWAITING_SHIPMENT`。
- 切换任务后回到第一页并重新请求服务端。
- 待办页面按任务渲染占位操作；全部采购继续使用原详情抽屉的真实履约与付款操作。
- 占位操作调用全局 `useQsToast().info()`，不调用采购 mutation API。

## 4. 测试策略

- Schema 测试锁定 enum、默认值和迁移不变量。
- 状态机测试锁定新起点和合法流转。
- Query Service 测试分别断言三个任务谓词。
- Web 纯逻辑测试锁定任务归一化、查询参数和操作集合。
- 页面源码契约测试锁定工具栏、轻提示以及全部采购原操作不回归。
