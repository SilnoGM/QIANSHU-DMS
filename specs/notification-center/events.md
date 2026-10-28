# 通知中心首批事件规格

## 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档状态 | 设计稿，触发点已核对代码；待业务确认文案与字段 |
| 关联文档 | [落地设计](./design.md)、[接口契约](./api.md)、[数据模型](./data-model.md) |
| 适用范围 | 阶段 1 的 3 个事件；阶段 2 的 4 个候选事件只列触发方向 |
| 最后更新 | 2026-10-28 |

## 1. 通用规则

- 事件在**业务事务内**调用 `SystemNotificationService.publish(command, { transaction })`；业务回滚时通知一起回滚。
- 发布位置统一放在业务状态变更与审计写入之后、事务提交之前。
- `publish()` 不抛业务异常：模板缺失、变量缺失、收件人为空只落失败/跳过记录，不阻断业务。
- 每个事件必须有唯一 `dedupeKey`；重复触发返回原通知，不重复发送。
- 阶段 1 的 3 个事件都允许金额与客户名称；1:1 只发给 `verifiedAt` 非空的绑定，群只发给 `internalOnly = true` 的目标。
- 文案中的 `{变量}` 对应模板白名单；金额与客户名称标记 `sensitive`。

## 2. `PURCHASE_REVIEW_PENDING`

### 2.1 触发点

| 项目 | 内容 |
| --- | --- |
| 文件 | `server/src/modules/purchase-orders/purchase-order-command.service.ts` |
| 方法 | `PurchaseOrderCommandService.create()` |
| 位置 | 创建采购单、写入明细/货件、写 `PURCHASE_ORDER_CREATED` 审计之后，事务提交之前 |
| 状态依据 | 采购单以 `orderStatus = 'PENDING_REVIEW'` 创建 |
| 事务 | 该方法使用 `Serializable` 事务，`publish` 必须传同一个 `transaction` |

注意：

- 创建是幂等接口；重复请求会走已存在订单的恢复分支，不会重复创建订单。`publish` 的 `dedupeKey` 再兜一层。
- 如果一次业务动作产生多张采购单，每张单各发一条；聚合留到阶段 2 的摘要能力。

### 2.2 收件人

| 项目 | 内容 |
| --- | --- |
| 渠道 | `ASSISTANT` |
| 目标模式 | `COMMAND_TARGET` |
| 命令目标 | `{ kind: 'PERMISSION', permissionCode: 'purchase-orders:review' }` |
| 1:1 条件 | 绑定 `status = 'ACTIVE'` 且 `verifiedAt` 非空 |
| 未绑定 | 该收件人落 `SKIPPED`，原因 `NOT_BOUND`；阶段 1 没有群兜底 |

风险提示：如果审核人尚未绑定，采购审核提醒会全部跳过。上线前必须先完成审核人的管理员绑定与测试消息确认。

### 2.3 变量

| 变量 | 来源 | 敏感 | 说明 |
| --- | --- | --- | --- |
| `orderNo` | `issuance.number` | 否 | 采购单号 |
| `vendorName` | 采购单的供货方字段：自定义名称或字典值解析后的显示名 | 否 | 模板变量名固定为 `vendorName`，不直接暴露内部字段名 |
| `totalAmount` | `command.purchaseTotalAmount` | 是 | 采购总额 |
| `currencyCode` | `command.currencyCode` | 否 | 币种 |
| `lineCount` | `effective.lines.length` | 否 | 明细行数 |
| `partCount` | `persistedParts.length` | 否 | 货件数 |
| `customerName` | 关联销售单的客户名称；仅 `salesLinked` 时有值 | 是 | 需要额外查询，查不到时渲染为空并记录 warning |

金额格式化：模板层只做字符串拼接，格式化由发布前的变量准备完成，例如 `1,234.56`；不要在校验层做本地化。

### 2.4 文案（阶段 1，纯文本）

```text
【千树小助理】采购单 {orderNo} 待审核
客户：{customerName}
金额：{currencyCode} {totalAmount}
明细：{lineCount} 行 / {partCount} 个货件
请进入千树 DMS 处理。
```

### 2.5 策略

| 项目 | 值 |
| --- | --- |
| `templateKey` | `purchase.review.pending` |
| 优先级 | `HIGH`（突破静默时段） |
| 站外 TTL | 24 小时 |
| `dedupeKey` | `purchase-review:{purchaseOrderId}` |
| `source` | `{ type: 'PURCHASE_ORDER', id: purchaseOrderId }` |
| 渠道 | `ASSISTANT`；`IN_APP` 阶段 3 再启用 |

## 3. `SLH_RECONCILIATION_COMPLETED`

### 3.1 触发点

| 项目 | 内容 |
| --- | --- |
| 文件 | `server/src/modules/slh-reconciliation-batches/slh-reconciliation-batch.service.ts` |
| 方法 | `SlhReconciliationBatchService.complete()` |
| 位置 | 批次 `completedAt` 更新、销售履约推进、`SLH_RECONCILIATION_BATCH_COMPLETED` 审计之后，事务提交之前 |
| 事务 | 该方法使用交互式事务；`publish` 必须传同一个 `transaction` |

注意：

- `complete()` 有多条拒绝分支（未核对完、代收超收等），只有成功更新批次并写审计后才发布。
- 批次完成后不能再次完成，`dedupeKey` 是第二层保护。

### 3.2 收件人

| 项目 | 内容 |
| --- | --- |
| 渠道 | `ASSISTANT` |
| 目标模式 | `GROUP` |
| 目标 | 群目标 key `finance` |
| 群要求 | `internalOnly = true`、`enabled = true`；群成员均为有权查看金额的内部员工 |
| 群不可用 | 落 `SKIPPED`，原因 `TARGET_DISABLED` 或 `NO_RECIPIENT`；阶段 1 没有 1:1 兜底 |

### 3.3 变量

| 变量 | 来源 | 敏感 | 说明 |
| --- | --- | --- | --- |
| `batchNo` | `batch.batchNo` | 否 | 对账批次号 |
| `slhBillNo` | `batch.bill.slhBillNo` | 否 | 账单号 |
| `memberCount` | `batch.members.length` | 否 | 明细行数 |
| `reconciledMemberCount` | 已核对成员数 | 否 | 完成时等于 `memberCount` |
| `settlementTotalCny` | `settlements` 的 `settlementAmountCny` 求和 | 是 | 结算金额合计，CNY |
| `fundPostingCount` | `postingBatchIds.length` | 否 | 资金入账批次数 |

金额合计在事务内由已加载的 `settlements` 计算，不额外查询；没有结算记录时渲染为 `0.00`。

### 3.4 文案（阶段 1，纯文本）

```text
【千树小助理】顺联航对账批次 {batchNo} 已完成
账单：{slhBillNo}
明细：{reconciledMemberCount}/{memberCount} 行
结算金额：¥{settlementTotalCny}
资金批次：{fundPostingCount} 笔
请进入千树 DMS 查看。
```

### 3.5 策略

| 项目 | 值 |
| --- | --- |
| `templateKey` | `slh.reconciliation.completed` |
| 优先级 | `NORMAL` |
| 站外 TTL | 8 小时 |
| `dedupeKey` | `slh-reconciliation-completed:{batchId}` |
| `source` | `{ type: 'SLH_RECONCILIATION_BATCH', id: batchId }` |
| 渠道 | `ASSISTANT`；`IN_APP` 阶段 3 再启用 |

## 4. `SHIPMENT_ARRIVED`

### 4.1 触发点

| 项目 | 内容 |
| --- | --- |
| 文件 | `server/src/modules/purchase-orders/warehouse-receipts/purchase-order-warehouse-receipt.service.ts` |
| 方法 | `PurchaseOrderWarehouseReceiptService.applyReceiptInTransaction()` |
| 位置 | 货件 `warehouseReceivedAt` 更新、采购单履约状态更新、`PURCHASE_SHIPMENT_WAREHOUSE_RECEIVED` 审计之后，事务提交之前 |
| 覆盖入口 | 单采购单入仓与销售级批量入仓都复用该方法；发布一次即可覆盖两个入口 |
| 事务 | 调用方已开启事务；`publish` 必须传同一个 `transaction` |

注意：

- 一次入仓可能选多个货件；一条通知按「一次入仓动作 + 一张采购单」发送，`partNumbers` 列出本次到仓的货件。
- 销售级批量入仓可能涉及多张采购单；每张采购单各发一条，阶段 2 再做聚合。
- 同一批货件不能重复入仓；不同批次到仓会产生新的 `dedupeKey`，属于新的到仓事件。

### 4.2 收件人

| 项目 | 内容 |
| --- | --- |
| 渠道 | `ASSISTANT` |
| 目标模式 | `GROUP` |
| 目标 | 群目标 key `operations` |
| 群要求 | `internalOnly = true`、`enabled = true` |
| 群不可用 | 落 `SKIPPED`；阶段 1 没有 1:1 兜底 |

### 4.3 变量

| 变量 | 来源 | 敏感 | 说明 |
| --- | --- | --- | --- |
| `orderNo` | `WarehouseOrder.orderNo` | 否 | 采购单号 |
| `partNumbers` | 本次 `partIds` 对应货件的 `partNumber`，按数字升序格式化为 `01、02` | 否 | 到仓货件 |
| `receivedPartCount` | `partIds.length` | 否 | 本次到仓件数 |
| `receivedAt` | `input.receivedAt ?? recordedAt`，按 `Asia/Shanghai` 格式化 | 否 | 到仓时间 |
| `customerName` | 关联销售单的客户名称；查不到时为空 | 是 | 需要额外查询 |

### 4.4 文案（阶段 1，纯文本）

```text
【千树小助理】采购单 {orderNo} 货件到仓
货件：{partNumbers}
到仓时间：{receivedAt}
客户：{customerName}
请进入千树 DMS 处理。
```

### 4.5 策略

| 项目 | 值 |
| --- | --- |
| `templateKey` | `shipment.arrived` |
| 优先级 | `NORMAL` |
| 站外 TTL | 8 小时 |
| `dedupeKey` | `shipment-arrived:{purchaseOrderId}:{sortedPartIds.join(',')}` |
| `source` | `{ type: 'PURCHASE_SHIPMENT', id: purchaseOrderId }` |
| 渠道 | `ASSISTANT`；`IN_APP` 阶段 3 再启用 |

## 5. 阶段 2 候选事件

以下只列触发方向，具体触发点与文案在阶段 2 前补齐。

| 事件 | 触发方向 | 默认目标 | 备注 |
| --- | --- | --- | --- |
| `FUND_WITHDRAWAL_REVIEW_PENDING` | 提现申请提交/进入待审 | 权限 `fund-withdrawals:review`，1:1 | 资金类，`HIGH` |
| `INVOICE_REQUEST_REVIEW_PENDING` | 开票申请提交/进入待审 | 权限 `invoice-requests:review`，1:1 | 开票时效 |
| `PACKAGING_COST_PAYMENT_PENDING` | 包装成本进入待付款 | 权限 `packaging-costs:pay`，1:1 | 建议按日汇总，避免逐单 |
| `PURCHASE_PAYABLE_DUE` | 应付到期扫描 | 应付负责人，1:1 | **仓库没有调度器**，需要 CLI + systemd timer 或复用 worker 的日扫描；先定扫描频率与逾期口径 |

## 6. 测试与验收

每个事件至少覆盖：

1. **事务回滚**：业务抛错时，`notifications`、`assistant_deliveries` 都不存在。
2. **模板缺失**：业务提交成功，通知落 `FAILED`，`failureCode = TEMPLATE_NOT_FOUND`。
3. **变量缺失**：通知落 `FAILED`，业务不回滚。
4. **收件人未绑定**：1:1 交付落 `SKIPPED`，原因 `NOT_BOUND`。
5. **群目标不可用**：群交付落 `SKIPPED`，原因 `TARGET_DISABLED`。
6. **敏感内容**：`allowSensitive = true` 时金额/客户名称进入渲染内容；`false` 时被替换为 `***`。
7. **幂等**：同一 `dedupeKey` 重复发布只产生一条通知与一组交付。
8. **阶段 1 无回调**：不依赖任何回调即可完成发送与记录。

## 7. 事件契约规则

- `eventType` 只追加，不重命名、不复用已删除的值。
- 每个事件在每个启用渠道上必须有模板与策略；缺失时该渠道跳过，不影响其他渠道。
- 文案修改走模板版本，不改 `eventType` 语义。
- 新增事件前先确认收件人、变量、敏感标记、TTL 与文案；不要先写代码再补口径。
