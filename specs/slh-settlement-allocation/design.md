# SLH 结算分摊 技术设计

## 1. 范围

- 后端：`server/src/modules/slh-reconciliation-batches/`、`server/src/modules/fund-accounts/`、`server/src/modules/slh-bills/`
- 前端：`web/apps/qsmds-arco/src/views/workbenches/slh-reconciliation/`
- 迁移：`20261101120000_settlement_allocation_split`、`20261101130000_company_fee_allocation`

## 2. 数据模型

### 2.1 `slh_reconciliation_settlements.allocation_snapshot`

新增 `JSONB` 列，保存结算当时的完整分摊快照：

```json
{
  "items": [{ "key": "CHARGE:{chargeId}", "sourceType": "BILL_CHARGE", "target": "ORIGIN_ORDER", "signedContributionCny": "-50", "overridden": false, "reason": null }],
  "parties": [{ "target": "ORIGIN_ORDER", "salesOrderId": "...", "settlementAmountCny": "-70.00", "paymentFeeAmountCny": null }],
  "parent": { "settlementAmountCny": "-110.00", "paymentFeeAmountCny": "7.00" }
}
```

- 历史结算没有快照，读回 `null`，按旧口径入账。
- 快照比较用稳定序列化（对象键排序），避免 JSONB 重排键导致「相同结算」被误判为变化。
- `settlements.salesOrder_id` 从「采购单原销售单」改为「当前销售单」；旧记录保持原值，完成时按无快照路径处理。

### 2.2 费用枚举

`slh_bill_charge_type` 增加 `PORT_FEE`，备注解析关键词为「港口费 / 港口費」。

### 2.3 公司入账类型

| 项 | 值 |
| --- | --- |
| 场景 | 业务类型 | 类别 | 规则 | 来源 / consumer |
| --- | --- | --- | --- | --- |
| 结算金额归公司 | `SLH_BILL_COMPANY_ALLOCATION` | `REVENUE` | 单腿 `COMPANY` / `FULL_AMOUNT` / `FOLLOW_AMOUNT_SIGN` | `SLH_BILL_FINANCE_SETTLEMENT_COMPANY` / `.ALLOCATION` |
| 金流费归公司 | `SLH_BILL_COMPANY_FEE_ALLOCATION` | `COST` | 单腿 `COMPANY` / `FULL_AMOUNT` / `DEBIT` | `SLH_BILL_FINANCE_SETTLEMENT_COMPANY_FEE` / `.FEE` |

两者都是 `requires_user = false`，批次形状为 `kind = BUSINESS`、`user_id IS NULL`、两个比例快照均为 `NULL`；迁移分别加 `fund_posting_batches_company_settlement_shape_check` 与 `..._company_fee_settlement_shape_check`。金流费是成本，不能复用收入类别的公司分摊类型。

迁移同时把两个类型加入 `INITIAL_FUND_POSTING_RULES`，保持「迁移种子与运行时校验同一真相源」。

## 3. 分摊算法

`server/src/modules/slh-reconciliation-batches/slh-reconciliation-allocation.logic.ts`：

1. 费用项：
   - `CHARGE:{chargeId}`：备注费用，key 用费用行稳定 id，不用数组下标；
   - `FREIGHT`、`COD_HANDLING`、`COD`、`PAYMENT_FEE`。
2. 默认目标：二派/转派/寄仓 → 甲；其余、COD、金流费 → 乙。
3. 贡献额（人民币）：
   - CNY 费用：`-amount`；
   - TWD 费用：`-amount ÷ rate`；
   - COD：`+amount ÷ rate`；
   - 金流费：`-amount`。
4. 目标合计：结算金额**不含金流费**（金流费是独立资金动作），单独给 `paymentFeeAmountCny`。
5. 尾差：各目标取整后与原结算公式的差额并入乙（没有乙则第一个目标），父级六金额不变。
6. 校验：
   - CNY 费用合计 = `surchargeAmountCny`，TWD 费用合计 = `ntdSurchargeAmountTwd`；
   - 未知/重复 key、COD 改目标、改目标无原因均拒绝。

## 4. 接口契约

- `POST /slh-reconciliation-batches/{id}/settlements` 新增可选 `allocationTargets: [{ key, target, reason? }]`；提交标识指纹包含该字段（格式升到 `v2`）。
- 结算记录与核对记录返回 `allocations`、`allocationParties`。
- 批次详情的成员行返回 `currentSalesOrder`，和原 `salesOrder` 并列。
- 账单行费用明细返回稳定 `id`（导入预览为 `null`）。

## 5. 资金入账

`postCompletedMembers` 按快照逐目标生成资金动作：

| 目标 | 来源 / consumer | 类型 | userId | businessId | 幂等键 |
| --- | --- | --- | --- | --- | --- |
| 甲 / 乙（结算） | `SLH_BILL_FINANCE_SETTLEMENT` / `.RECONCILE` | `ORDER_SETTLEMENT` | 目标订单出单人 | 结算记录 id | `{settlementId}:RECONCILE:{target}` |
| 公司（结算） | `SLH_BILL_FINANCE_SETTLEMENT_COMPANY` / `.ALLOCATION` | `SLH_BILL_COMPANY_ALLOCATION` | 无 | 结算记录 id | `{settlementId}:RECONCILE:COMPANY` |
| 金流费（甲/乙） | `SLH_BILL_FINANCE_SETTLEMENT` / `.FEE` | `FULL_FLOW_PAYMENT_FEE` | 承担订单出单人 | 当前销售单 id | `{currentOrderId}:FEE` |
| 金流费（公司） | 公司费用来源 / `.FEE` | `SLH_BILL_COMPANY_FEE_ALLOCATION`（COST） | 无 | 当前销售单 id | `{currentOrderId}:FEE` |

要点：

- 金流费按**当前销售单**去重，businessId 固定为当前销售单；即使费用改由甲或公司承担，也不会因目标变化重复收费。
- COD 恒归乙，回填 `sales_order_payments` 只写当前销售单；资金批次绑定乙的 RECONCILE 批次。
- 甲只入资金账，不改订单状态、不重算付款状态、不锁订单行。
- 完成前预检甲出单人资金账户，缺失时给业务错误而不是资金层内部错误。
- 历史结算（无快照）仍只入一笔当前单 RECONCILE，幂等键沿用旧值。

## 6. 与调货的边界

存在 ACTIVE 结算记录的装柜明细，其货件不能再调货：`ShipmentStorageService` 在 `createClaimRequest` 与 `claim`（直接认领与审批共用）内查 `slhReconciliationSettlements` 的 `status = ACTIVE` + `loadingItemId` 对应货件，命中即返回 `SHIPMENT_STORAGE_CLAIM_SETTLED`。结算快照已经按当时的当前销售单分摊，继续改归属会让已入账资金与货件事实不符。

## 7. 前端

- 结算弹窗第二步新增「入账分摊」：
  - 每个费用项显示金额、默认目标、目标下拉；COD 只读显示「固定归乙」；
  - 改目标后展开原因输入，未填原因禁用「确定结算」；
  - 费用明细对不上时显示阻断提示并禁用确认；
  - 目标合计卡按甲/乙/公司自适应列数（只有甲/乙时两列铺满，出现公司才三列）；卡头「甲 · 原销售单」「乙 · 调货后销售单」「公司账户」，单号第二行；
  - 卡内「结算金额」+ 符号标签（应入账/应转出）；分隔线后「金流费」，无费用显示占位符；
  - 卡片下方合计结算金额与合计金流费，并与顶部结算金额比对（一致/不一致）；负数说明放在缩短后的说明文案里。
- 调货行（甲 ≠ 乙）的销售金额、订单币种、金流费统一取 `currentSalesOrder`（乙）；甲只是费用承担方，不能用甲的销售额计算金流费，否则界面值会与服务端重算不一致。
- 「本行核对正确」门禁对调货行只检查乙未取消且已签收；甲的状态与甲的采购单不参与，和「甲已终止/取消仍可扣费」保持一致。
- 核对记录新增「入账分摊」信息组：逐项金额 → 目标、各目标结算合计；历史无快照的记录不渲染该组。

## 8. 测试

| 层 | 覆盖 |
| --- | --- |
| 单测 | 默认目标、贡献额、尾差、甲=乙、COD 限制、原因必填、费用明细阻断、快照稳定比较 |
| 资金单测 | 公司来源预览/入账、比例快照为 null、拒绝 userId 与错配类型 |
| e2e | 甲/乙不同订单的分摊与回填、公司目标资金批次、甲已取消仍可扣费、费用跨行/跨批次去重 |
| web | 分摊预览、目标切换与原因、COD 只读、确认按钮阻断、目标合计/方向/合计校验、记录卡片分摊组 |

## 9. 迁移与运维

- 新增枚举值、快照列、两个公司资金类型/规则/来源/形状约束；已在 dev 库应用，测试机与生产待发布。
- 迁移可重跑：枚举 `IF NOT EXISTS`、列 `IF NOT EXISTS`、规则先草稿后发布、约束先删后加。
- 发布后旧结算仍可完成；新结算开始写快照。
- 费用明细与账单杂费不一致的存量账单会阻断结算，需要先修正账单费用明细（不自动猜）。
