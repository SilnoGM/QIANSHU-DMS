# 对账详情调货翻转卡 技术设计

## 1. 范围

- 后端：`server/src/modules/slh-reconciliation-batches/`
- 前端：`web/apps/qsmds-arco/src/views/workbenches/slh-reconciliation/`
- 无数据库迁移；批次详情 DTO 只新增字段。

## 2. 接口与数据

### 2.1 `SlhReconciliationBatchMemberDto.transferRecord`

只在甲 ≠ 乙的成员行下发；没有寄仓记录时为 `null`。

```ts
transferRecord: {
  storageRecordId: string
  status: 'IN_STORAGE' | 'RESERVED' | 'CLAIMED' | 'VOIDED'
  locationScope: 'MAINLAND' | 'OVERSEAS'
  warehouseLabel: string
  warehouseValue: string
  shipmentNo: string | null
  shippingMark: string | null
  containerBatchName: string | null
  releasedAt: string | null
  releaseReason: string | null
  releasedBy: Person | null
  releaseNote: string | null
  claimRequest: {
    id: string
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'
    targetSalesOrderNo: string
    applicant: Person | null
    createdAt: string
    reviewedBy: Person | null
    reviewedAt: string | null
    rejectReason: string | null
    lineCount: number
    totalQuantity: number
    recipientChangeCount: number
    codChangeCount: number
    manualMatchCount: number
    costTotalCny: string
  } | null
  claimedAt: string | null
  claimedBy: Person | null
  cost: {
    totalCostCny: string
    claimAmountCny: string | null
    releaseAmountCny: string | null
  } | null
} | null
```

`Person = { id, displayName, avatarUrl }`。不返回原始 JSON、行级 ID、幂等键、哈希、资金批次 ID。

### 2.2 查询选择

`SlhReconciliationBatchQueryService.detail` 在主查询后批量取：

- `shipment_storage_records`：`shipmentId in (...)`、`status = CLAIMED`；
- 每个货件只选 `claimedSalesOrderId = currentSalesOrder.id` 的最新一条（`claimedAt desc, createdAt desc`）；
- 关联 `releaseBatch`（reason/actor/occurredAt/note）、最新 `APPROVED` 的 `claimRequests`、`claimLines`（quantity/productMatchMode）、`costEvents`（direction/amount）、`costSnapshot`；
- 人员通过 `PERSON_REFERENCE_SELECT` 批量查用户；
- JSON 计数由 `slh-reconciliation-transfer-record.logic.ts` 安全读取：改收件人/改代收计数、认领行数/数量/手工匹配数、成本总额；
- 未找到对应记录 → `transferRecord = null`，前端显示「无寄仓调货记录」。

关键点：一个货件可能经历多次认领/修正，不能取最新一条无关记录；必须匹配当前乙单。

## 3. 前端结构

### 3.1 组件

| 文件 | 职责 |
| --- | --- |
| `slh-order-section.vue` | 从详情页抽出的销售/采购区块，供普通行和翻转卡两面复用；`beam` 由模型决定 |
| `slh-order-flip-card.vue` | 顶部面标题 + 翻转按钮 + 双面 grid + 底部完整寄仓入口 |
| `slh-transfer-record.vue` | 调货记录字段、成本总额、变更摘要 |

### 3.2 详情页分支

- `currentSalesOrder` 存在且 id ≠ `salesOrder.id`：渲染 `SlhOrderFlipCard`。
- 否则：继续渲染原 `FaPageMain` + `orderSections`（销售+采购双区块）。
- 当前乙销售区块通过 `buildSlhReconciliationOrderSections({ ...member, salesOrder: current })` 复用现有构建器；背面甲销售/采购沿用原 `orderSections`，并去掉甲销售的核对焦点 `beam`。
- 切换成员时组件按成员重新挂载/重置到正面。

### 3.3 翻转与无障碍

- `perspective + preserve-3d + backface-visibility`，两面 `grid-area:1/1` 叠放，高度取最大。
- 右上角 `<button>`，`aria-label`/`aria-pressed`，图标 `i-mdi:flip-horizontal`。
- 非活动面 `inert` + `aria-hidden`；`aria-live` 播报当前面。
- `prefers-reduced-motion` 下取消过渡。
- 底部入口不参与翻转，正反面都可见；新标签页打开 `qsOperationsGoodsStorage?storageId=...`。
- 无 `shipment-storage:read` 时禁用并提示；无 `transferRecord` 时显示「无寄仓调货记录」。

### 3.4 核对焦点

`buildSlhReconciliationFocusValues` 的销售来源改为 `member.currentSalesOrder ?? member.salesOrder`；标签文案改为「当前销售单 · 尾款」。普通行乙=甲，值不变。

## 4. 演示批次

`SRB/20261101-001`：

- 正面乙 `SO/20261030-00413`，调货记录：`RF_LK`、2026-10-29 释放（CORRECTION 撤销误认领）、2026-10-30 申请/审批、1 行/1 件、成本 2,600.00、收件人 3 项/代收 0 项。
- 背面甲 `SO/20261022-00013` + 采购 `PO/20261022-00009`。
- 焦点显示乙尾款 325,000。

## 5. 测试

| 层 | 覆盖 |
| --- | --- |
| 后端单测 | 变更计数、认领汇总、成本读取、当前乙记录选择 |
| 后端 e2e | 批次详情与新字段不回归；现有 41 条全量通过 |
| web 单测 | 正面乙/背面甲、焦点乙、翻转卡/入口/成本/变更 source 断言、三语键对齐 |
| 手工 | 演示批次翻转、键盘、减少动效、完整寄仓记录入口、普通行不翻转 |

## 6. 风险与边界

- 调货记录取当前乙对应的 CLAIMED 寄仓记录；历史认领/修正不进入卡片，完整记录页可查。
- 成本只展示总额，个人/公司分摊和收件人前后值是敏感明细，放完整记录。
- 完整寄仓入口依赖 `shipment-storage:read`；对账角色无该权限时禁用。
- 焦点改为乙后，演示批次会从甲的 40,000 变为乙的 325,000；与账单代收 40,000 的差异是预期的部分收款。
- 3D 翻转在移动端和减少动效下需实测。
