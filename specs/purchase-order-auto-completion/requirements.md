# 采购订单自动完成状态需求

## 1. 需求简介

采购订单当前的订单状态只有 `CONFIRMED`（已确认）与 `CANCELLED`（已取消），履约“已签收”由 `fulfillmentStatus = SIGNED` 表示，付款“已付清”由 `paymentStatus = PAID` 表示。本需求新增 `orderStatus = COMPLETED`（已完成），并将其定义为由履约和付款事实自动派生的状态，而不是人工操作状态。

## 2. 业务规则

### 2.1 新增已完成状态

**用户故事：** 作为采购运营人员，我希望订单在履约与付款均结束后自动标记为已完成，以便快速识别已闭环采购单。

#### 验收标准

1. 当采购订单的 `fulfillmentStatus` 为 `SIGNED` 且 `paymentStatus` 为 `PAID` 时，系统应将 `orderStatus` 自动设置为 `COMPLETED`。
2. 当采购订单仅满足 `SIGNED` 或仅满足 `PAID` 时，系统应保持 `orderStatus = CONFIRMED`。
3. 当采购订单为 `CANCELLED` 时，系统不应将其自动设置为 `COMPLETED`。
4. 当系统重复校验同一组状态事实时，系统应保持结果幂等，不重复生成状态历史或审计事件。

### 2.2 与操作顺序无关的自动推进

**用户故事：** 作为采购运营人员，我希望无论先完成付款还是先完成签收，系统都能在第二个条件满足时完成订单。

#### 验收标准

1. 当已付清采购订单从 `SHIPPED` 流转至 `SIGNED` 时，系统应在同一数据库事务中将 `orderStatus` 设置为 `COMPLETED`。
2. 当已签收采购订单的有效付款累计金额使 `paymentStatus` 变为 `PAID` 时，系统应在同一数据库事务中将 `orderStatus` 设置为 `COMPLETED`。
3. 当并发请求更新同一采购订单时，系统应继续使用采购订单行锁串行化状态写入，避免遗漏完成或产生重复历史。

### 2.3 付款作废后的自动回退

**用户故事：** 作为采购运营人员，我希望付款事实被作废后订单状态与实际付款保持一致，避免已完成订单继续显示为已闭环。

#### 验收标准

1. 当 `COMPLETED` 采购订单的有效付款被作废，且重新计算后的 `paymentStatus` 不再为 `PAID` 时，系统应在同一事务中将 `orderStatus` 自动回退为 `CONFIRMED`。
2. 当付款作废后采购订单仍为 `PAID` 时，系统应保持 `orderStatus = COMPLETED`。
3. 当系统执行自动回退时，系统应记录一次订单状态历史和一次订单状态审计事件。

### 2.4 状态历史与审计

**用户故事：** 作为审计人员，我希望自动完成和自动回退均有可追溯记录，以便还原状态变化原因。

#### 验收标准

1. 当订单从 `CONFIRMED` 自动进入 `COMPLETED` 时，系统应新增 `dimension = ORDER` 的状态历史，`fromStatus = CONFIRMED`、`toStatus = COMPLETED`。
2. 当订单从 `COMPLETED` 自动回退至 `CONFIRMED` 时，系统应新增对应的反向状态历史。
3. 当自动状态变化发生时，系统应复用 `PURCHASE_ORDER_ORDER_STATUS_CHANGED` 审计事件，并在元数据中标记自动派生及触发来源。
4. 当状态未发生变化时，系统不应新增订单状态历史或订单状态审计事件。

### 2.5 数据库迁移与既有数据

**用户故事：** 作为系统维护人员，我希望上线迁移后既有数据与新状态规则一致，并由数据库约束阻止无效完成状态。

#### 验收标准

1. 当 migration 执行时，系统应为 `purchase_order_status` 增加 `COMPLETED`，并保留 `CONFIRMED`、`CANCELLED` 的原有数据。
2. 当 migration 执行时，系统应将现有 `CONFIRMED + SIGNED + PAID` 采购订单回填为 `COMPLETED`。
3. 当数据库写入 `orderStatus = COMPLETED` 时，数据库应要求同一行同时满足 `fulfillmentStatus = SIGNED` 与 `paymentStatus = PAID`。
4. 当 migration 完成时，系统应校验枚举值、现有完成订单和约束一致性；任一不满足时应回滚整个 migration。
5. migration 回填不应伪造无法归属真实操作人的状态历史或审计事件。

### 2.6 API、列表与详情展示

**用户故事：** 作为采购运营人员，我希望在采购列表和订单详情中看到一致的“已完成”状态。

#### 验收标准

1. 当服务端返回采购订单列表或详情时，公共 OpenAPI 契约中的 `PurchaseOrderStatus` 应包含 `COMPLETED`。
2. 当用户按订单状态筛选全部采购时，前端应允许提交 `orderStatus = COMPLETED`。
3. 当采购订单为 `COMPLETED` 时，全部采购列表、移动卡片与 `QsPurchaseOrderDesc` 应显示“已完成”。
4. 当采购订单为 `COMPLETED` 时，前端应使用与销售订单“已完成”一致的主色状态标签，状态含义仍以文字为准。
5. 当采购订单为 `COMPLETED` 时，系统不应在待办采购中返回该订单，也不应提供履约推进操作。

## 3. UI 设计规格

```text
DESIGN SPECIFICATION
====================
1. Purpose Statement: 在现有采购列表和详情状态区域补充“已完成”语义，让运营人员无需新增交互即可识别已经签收并付清的订单。此次仅扩展既有状态标签，不改变页面结构和操作路径。
2. Aesthetic Direction: Industrial/utilitarian（工业化运营工具风格，强调状态密度和可扫描性）
3. Color Palette: 主色绿 #009640；正文 #171717；次级文字 #737373；背景 #FFFFFF；危险红 #DC2626。实现继续使用项目 `primary`、`muted-foreground`、`background`、`destructive` Token，不硬编码页面颜色。
4. Typography: Noto Sans SC 用于状态文字；Noto Sans Mono 用于订单编号和金额。沿用 `--qs-font-sans` 与 `--qs-font-mono`。
5. Layout Strategy: 保持现有采购表格右侧状态信息层级和移动卡片双列布局；“已完成”只替换订单状态标签内容，不新增卡片、弹窗、图标、动画或额外占位。
```

## 4. 非目标

- 不新增人工“完成采购订单”接口或按钮。
- 不修改采购履约状态集合；中文“已签收”继续对应技术编码 `SIGNED`。
- 不修改采购付款状态集合或金额计算规则。
- 不修改销售订单状态机。
- 不改变采购列表现有列宽、筛选布局、待办工具栏和分页结构。
- 不新增第三方依赖或公共 UI 组件 API。
