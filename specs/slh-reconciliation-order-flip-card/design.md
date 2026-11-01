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
    lines: Array<{
      lineNumber: number
      productName: string
      quantity: number
      productMatchMode: string | null
    }>
    changes: Array<{
      lineNumber: number
      shippingMark: string | null
      containerBatchName: string | null
      recipientChanged: boolean
      codChanged: boolean
      beforeRecipientName: string | null
      afterRecipientName: string | null
      beforeRecipientPhone: string | null
      afterRecipientPhone: string | null
      beforeRecipientAddress: string | null
      afterRecipientAddress: string | null
      beforeCodAmountTwd: string | null
      afterCodAmountTwd: string | null
    }>
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
- 同一逻辑新增 `readTransferClaimLines` 读取认领产品行（跳过空产品名/非正数量），`readTransferChangeItems` 读取完整收件人/电话/地址/COD 前后值，只保留 `recipientChanged` 或 `codChanged` 的条目；
- 唛头优先用账单明细行的 `shippingMarkText`（如 `J-030549-01`），避免误取采购基础唛头（`FSL/...`）；
- 未找到对应记录 → `transferRecord = null`，前端显示「无寄仓调货记录」。

关键点：一个货件可能经历多次认领/修正，不能取最新一条无关记录；必须匹配当前乙单。

## 3. 前端结构

### 3.1 组件

| 文件 | 职责 |
| --- | --- |
| `slh-order-section.vue` | 从详情页抽出的销售/采购区块，供普通行和翻转卡两面复用；`beam` 由模型决定 |
| `slh-order-flip-card.vue` | 顶部面标题 + 翻转按钮 + 双面 grid + 底部完整寄仓入口 |
| `slh-transfer-record.vue` | 调货记录标题+状态+仓库、货件/柜号/唛头内联行、来源→当前、认领行数 Tooltip、成本总额、变更摘要+info Tooltip |

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

### 3.5 调货卡交互与信息密度

- **仓库胶囊**：`w-60` 固定宽度、`truncate` 省略，`title` 给完整「位置 · 仓名」；移动端 `max-w-full` 不溢出。
- **货件段**：标签与三个值放在同一 `flex-wrap` 行，用 `·` 分隔，去掉外层容器和三个白底盒子；值 `break-all` 且 `title` 可看全。
- **来源单可点击**：来源单号渲染为 `<button>`，`@click` 抛 `flip` 事件；`SlhOrderFlipCard` 用 `@flip="toggle"` 与右上角翻转按钮共用同一 `toggle`，因此点击等价翻转。
- **认领行数**：去掉 `bg-muted` 底色，文字 `cursor-pointer`，外层 `FaTooltip` 在 hover/focus 时列出 `lines` 的「产品名 × 数量」；没有明细时显示「暂无产品明细」。
- **变更摘要**：摘要文本后跟 `i-lucide:info` 图标（小手指 + hover 底色），Tooltip 逐条展示 `changes`：唛头/柜号标题、姓名/电话/地址/COD 的完整前后值；仅展示真的发生变化的字段，`recipientChanged` 但三字段均无差异时给兜底文案。
- Tooltip 内容用 `text-background` 与气泡深色底匹配；长地址允许换行，变更列表 `max-h-64 overflow-auto`。

## 4. 演示批次

`SRB/20261101-001`：

- 正面乙 `SO/20261030-00413`，调货记录卡面按设计稿展示：状态“已认领”、仓库“海外 · 瑞锋-林口仓”、货件/柜号/唛头一行内联、来源甲→当前乙、1 行/1 件（Tooltip 1 个产品）、成本 2,600.00、收件人 3 项/代收 0 项（info Tooltip 3 条完整前后值）；寄仓/申请/审批/认领时间不在卡面。
- 实测 `lines=1`、`changes=3`，变更含姓名 `鄭家銘 → 测试AA`、电话 `973216146 → 222222`、地址 `龜山鄉大湖路68巷37號 → 中国台湾台湾南投縣222`。
- 背面甲 `SO/20261022-00013` + 采购 `PO/20261022-00009`。
- 焦点显示乙尾款 325,000。

## 5. 测试

| 层 | 覆盖 |
| --- | --- |
| 后端单测 | 变更计数、认领产品行与完整变更前后值、认领汇总、成本读取、当前乙记录选择 |
| 后端 e2e | 批次详情与新字段不回归；现有 41 条全量通过 |
| web 单测 | 正面乙/背面甲、焦点乙、翻转卡/入口/成本/变更 source 断言、紧凑布局/固定仓库/来源点击/两个 Tooltip 断言、三语键对齐 |
| 接口实测 | 用编译后的查询服务读取演示批次，确认 `lines/changes` 与完整前后值真实下发 |
| 手工 | 演示批次翻转、键盘、减少动效、完整寄仓记录入口、普通行不翻转 |

## 6. 风险与边界

- 调货记录取当前乙对应的 CLAIMED 寄仓记录；历史认领/修正不进入卡片，完整记录页可查。
- 卡面按设计稿只保留关系、行数、成本和变更摘要；寄仓时间/调货申请/审批/调货时间字段已从卡面删除，DTO 仍保留给完整记录使用。
- 成本只展示总额，个人/公司分摊和认领/释放拆分放完整记录。
- 变更 Tooltip 按方案 B 展示完整姓名/电话/地址/COD 前后值，不做遮蔽；这些信息本就可由有权限的财务在寄仓详情查看，Tooltip 只是减少跳转。完整留痕仍以寄仓记录为准。
- 完整寄仓入口依赖 `shipment-storage:read`；对账角色无该权限时禁用。
- 焦点改为乙后，演示批次会从甲的 40,000 变为乙的 325,000；与账单代收 40,000 的差异是预期的部分收款。
- 3D 翻转在移动端和减少动效下需实测。
