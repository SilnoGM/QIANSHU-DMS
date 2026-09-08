# 销售订单对账与完成状态需求规格

## 1. 文档状态

- 状态：已确认
- 确认日期：2026-08-30
- 依赖规格：[销售订单域需求规格](../sales-order-domain/requirements.md)
- 目标页面：`/operations/sales-orders`

## 2. 目标

把销售订单列表中的“待对账”和“已完成”从前端占位筛选升级为 `orderStatus` 的真实持久化状态，并通过服务端状态机保证只有已经签收且已付清的订单才能进入待对账，且只有待对账订单在重新校验仍然满足签收、付清条件时才能进入已完成。

## 3. 目标订单状态

| 顺序 | 状态编码 | 显示文案 | 说明 |
| ---: | --- | --- | --- |
| 1 | `DRAFT` | 草稿 | Schema 保留状态；当前新增订单不产生草稿 |
| 2 | `CONFIRMED` | 已确认 | 正常履约和收款中的正式订单 |
| 3 | `PENDING_RECONCILIATION` | 待对账 | 已签收、已付清并等待最终业务核对 |
| 4 | `COMPLETED` | 已完成 | 对账完成后的终态 |
| - | `CANCELLED` | 已取消 | 草稿或已确认订单的取消终态 |

目标流转为：

```text
DRAFT -> CONFIRMED -> PENDING_RECONCILIATION -> COMPLETED
  |          |
  +----------+-> CANCELLED
```

`PENDING_RECONCILIATION` 只能进入 `COMPLETED`；`COMPLETED` 和 `CANCELLED` 均没有后继状态。

## 4. 需求与验收标准

### R1 - 真实订单状态

**User Story：** 作为销售运营人员，我希望待对账和已完成是可查询、可审计的真实订单状态，而不是页面占位入口。

#### Acceptance Criteria

1. 当数据库、Server 或 Web 表达销售订单状态时，销售订单系统应支持 `DRAFT`、`CONFIRMED`、`PENDING_RECONCILIATION`、`COMPLETED` 和 `CANCELLED`。
2. 当服务端生成 OpenAPI 契约时，销售订单系统应在所有 `SalesOrderStatus` 位置公开完整五值枚举。
3. 当订单状态成功变化时，销售订单系统应继续写入 `ORDER` 维度状态历史和对应审计事件。
4. 当既有订单和历史数据迁移时，销售订单系统应保持现有状态值不变，不自动推断或批量改写订单状态。

### R2 - 进入待对账

**User Story：** 作为销售运营人员，我希望只有履约和收款都结束的订单才能进入待对账，避免提前核对未完成订单。

#### Acceptance Criteria

1. 当用户把订单从 `CONFIRMED` 变更为 `PENDING_RECONCILIATION` 时，销售订单系统应在同一事务和订单行锁内重新读取当前状态。
2. 当且仅当 `fulfillmentStatus = SIGNED` 且 `paymentStatus = PAID` 时，销售订单系统应允许订单进入 `PENDING_RECONCILIATION`。
3. 当履约状态不是 `SIGNED` 或付款状态不是 `PAID` 时，销售订单系统应拒绝进入待对账并返回稳定业务错误。
4. 当订单只是满足 `SIGNED + PAID` 而用户未显式提交订单状态变更时，销售订单系统不得自动进入待对账。
5. 当订单状态不是 `CONFIRMED` 时，销售订单系统应拒绝进入 `PENDING_RECONCILIATION`。

### R3 - 进入已完成

**User Story：** 作为销售运营人员，我希望最终完成前再次验证履约和付款条件，避免对账期间的数据变化制造错误完成状态。

#### Acceptance Criteria

1. 当用户把订单从 `PENDING_RECONCILIATION` 变更为 `COMPLETED` 时，销售订单系统应在同一事务和订单行锁内重新校验当前状态。
2. 当且仅当订单当前仍满足 `fulfillmentStatus = SIGNED` 且 `paymentStatus = PAID` 时，销售订单系统应允许进入 `COMPLETED`。
3. 当订单不是 `PENDING_RECONCILIATION` 时，销售订单系统应拒绝直接进入 `COMPLETED`。
4. 当重新校验发现履约或付款条件不满足时，销售订单系统应拒绝完成并返回稳定业务错误。
5. 当订单进入 `COMPLETED` 后，销售订单系统应把它视为终态并拒绝后续订单状态流转。
6. 当订单已完成时，销售订单系统应拒绝修改约定金额、增加或作废实际收款，以及其他会破坏完成条件的订单业务变更。

### R4 - 取消与既有状态规则

**User Story：** 作为系统管理员，我希望新增状态不会放宽既有取消和履约约束。

#### Acceptance Criteria

1. 当订单为 `DRAFT` 或 `CONFIRMED` 时，销售订单系统应继续按照既有规则允许进入 `CANCELLED`。
2. 当订单已有有效实际收款时，销售订单系统应继续拒绝取消。
3. 当订单为 `PENDING_RECONCILIATION` 或 `COMPLETED` 时，销售订单系统应拒绝取消、退回或跳转到其他订单状态。
4. 当履约状态发生变化时，销售订单系统应继续执行既有相邻流转和签收凭证规则。
5. 当付款记录变化时，销售订单系统应继续按有效实际收款自动派生付款状态，不允许客户端直接指定付款状态。

### R5 - 可信列表筛选与展示

**User Story：** 作为订单查看人员，我希望全部订单页面按真实服务端状态筛选，避免看到无法查询的占位入口。

#### Acceptance Criteria

1. 当用户打开全部订单状态切换时，Web 应依次展示“全部订单、已确认、待对账、已取消、已完成”。
2. 当用户选择“待对账”时，Web 应向服务端发送 `orderStatus=PENDING_RECONCILIATION` 并展示真实返回结果。
3. 当用户选择“已完成”时，Web 应向服务端发送 `orderStatus=COMPLETED` 并展示真实返回结果。
4. 当用户选择“全部订单”时，Web 应查询并合并 `CONFIRMED`、`PENDING_RECONCILIATION`、`CANCELLED` 和 `COMPLETED`，且不得混入历史 `DRAFT`。
5. 当桌面或窄屏列表展示订单状态时，Web 应把两个新增编码显示为对应中文文案，并使用现有主题语义颜色辅助区分。
6. 当新增状态没有匹配订单时，Web 应展示常规空状态，不再显示“尚未进入当前数据契约”。
7. 当状态变更记录展示新增编码时，Web 应显示中文状态名称，不得回显原始技术编码。

## 5. 前端设计规格

```text
DESIGN SPECIFICATION
====================
1. Purpose Statement: 把销售订单列表中两个占位状态升级为可信、可查询的业务状态，同时保持用户熟悉的高密度运营工作台操作方式。
2. Aesthetic Direction: Industrial/utilitarian，延续现有千树运营工作台而不重设计页面。
3. Color Palette: Primary Green #008A3B、Foreground #252525、Muted #8A8A8A、Border #E5E5E5、Destructive #DC2626；实现继续使用现有主题 Token 和明暗主题类。
4. Typography: Noto Sans SC；订单号和数据使用 Noto Sans Mono。
5. Layout Strategy: 保持现有非居中运营表格、状态切换工具栏、双行状态单元格和窄屏复合信息布局，只扩展状态内容与查询行为。
```

- 目标平台：Web。
- 图标：本次不新增图标；既有操作继续使用项目 Lucide 图标。
- 响应式：保持现有桌面表格与窄屏卡片能力。
- 可访问性：状态文字始终可见，颜色不作为唯一语义；键盘和焦点行为保持现有组件契约。

## 6. 非功能要求

- Prisma Schema、追加 migration、Server DTO 与 OpenAPI 必须保持同一枚举口径。
- 服务端状态机是状态流转和前置条件的唯一真相源，Web 不复制业务资格判断。
- 状态校验必须在已有订单行锁事务中执行，避免检查后并发修改。
- 新功能采用 TDD，覆盖枚举、migration、状态机、Mutation、查询、OpenAPI 和 Web 映射。
- migration 应应用到当前已连接的开发数据库，并通过 Prisma migration 状态和只读 SQL 复核。
- 不修改既有 migration，不连接或部署生产数据库。
- 不记录客户电话、地址、凭证内容或完整请求体等敏感信息。

## 7. 本期不包含

- 根据 `SIGNED + PAID` 自动进入待对账。
- 待对账审批人、对账单、审批意见或独立对账记录模型。
- 从待对账退回已确认，或从已完成重新开启。
- 修改履约状态、付款状态的枚举集合。
- 修改采购订单状态结构。
- 实现选择销售订单弹窗；该功能在本状态能力落地后继续设计与开发。
