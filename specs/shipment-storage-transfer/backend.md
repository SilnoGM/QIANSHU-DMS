# 货件归属、寄仓与调货后端设计

## 1. 文档状态

- 状态：方案已确认，待实施授权
- 设计日期：2026-10-28
- 需求规格：[requirements.md](./requirements.md)
- 总体设计：[design.md](./design.md)
- 实施边界：新增表、触发器、接口与权限均属公共契约变更，实施前需明确授权。

## 2. 模块划分

| 模块 | 职责 | 阶段 |
|---|---|---|
| `server/src/modules/shipment-ownership/` | 归属事件写入、当前归属投影、解析服务 | M1 |
| `server/src/modules/shipment-storage/` | 释放、寄仓记录、位置移动、认领、查询 | M3-M4 |
| `server/src/modules/sales-orders/`（改造） | 终止态、认领后的覆盖与履约 | M2/M4 |
| `server/src/modules/purchase-orders/shipments/`（改造） | 五条读取链路切换 | M1 |
| `server/src/modules/packaging-costs/`（改造） | 归属解析与释放后禁提报 | M1/M5 |
| `server/src/modules/slh-reconciliation-batches/`（改造） | 收款人解析与挂起规则 | M1/M5 |
| `server/src/modules/fund-accounts/`（改造） | 池账户与两个 posting type | M4 |

## 3. 数据库设计

### 3.1 新增枚举

```sql
CREATE TYPE shipment_owner_type AS ENUM ('SALES_ORDER','STORAGE_POOL','COMPANY');
CREATE TYPE shipment_ownership_state AS ENUM ('ACTIVE','VOIDED');
CREATE TYPE shipment_ownership_reason AS ENUM
  ('PURCHASE_CREATED','ORDER_CANCELLED','CUSTOMER_CANCEL','CUSTOMER_REJECT','RELEASE','CLAIM','CORRECTION');
CREATE TYPE shipment_storage_status AS ENUM ('IN_STORAGE','RESERVED','CLAIMED','VOIDED');
CREATE TYPE shipment_storage_location_scope AS ENUM ('MAINLAND','OVERSEAS');
CREATE TYPE shipment_cost_direction AS ENUM ('RELEASE','CLAIM');
```

### 3.2 归属表

完整字段见 [design.md](./design.md) 4.1。补充约束：

| 约束 | 说明 |
|---|---|
| `UNIQUE (shipment_id, sequence)` | 每货件事件序号连续 |
| `UNIQUE (actor_user_id, request_key)` | 幂等 |
| `CHECK ((owner_type = 'SALES_ORDER') = (owner_sales_order_id IS NOT NULL))` | 归属形状 |
| 事件表禁止 UPDATE/DELETE | 追加式事实 |
| 投影表由触发器维护 | 与事件强一致 |

投影表：

```sql
CREATE TABLE shipment_ownership_current (
  shipment_id          uuid PRIMARY KEY REFERENCES purchase_order_parts(id) ON DELETE RESTRICT,
  event_id             uuid NOT NULL UNIQUE REFERENCES shipment_ownership_events(id) ON DELETE RESTRICT,
  owner_type           shipment_owner_type NOT NULL,
  owner_sales_order_id uuid REFERENCES sales_orders(id) ON DELETE RESTRICT,
  state                shipment_ownership_state NOT NULL,
  updated_at           timestamptz NOT NULL
);
CREATE INDEX ... ON shipment_ownership_current (owner_sales_order_id);
CREATE INDEX ... ON shipment_ownership_current (owner_type, state);
```

触发器：

```text
AFTER INSERT ON shipment_ownership_events
  -> 校验 NEW.sequence = COALESCE(MAX(sequence), 0) + 1
  -> UPSERT shipment_ownership_current
```

### 3.3 寄仓表

见 [design.md](./design.md) 4.2。补充：

| 约束 | 说明 |
|---|---|
| 部分唯一索引 `WHERE status IN ('IN_STORAGE','RESERVED')` | 同一货件只允许一条占用中的寄仓记录 |
| `CHECK (location_scope = 'MAINLAND' => warehouse_value 非空)` | 内地必须有仓库值 |
| `CHECK (status = 'CLAIMED' => claimed_sales_order_id IS NOT NULL)` | 认领必须落到销售单 |
| 快照列 NOT NULL | 释放时必须完整 |

### 3.4 跨表不变量

用延迟约束触发器保证：

1. 存在 `IN_STORAGE`/`RESERVED` 寄仓记录 ⇒ 当前归属必须是 `STORAGE_POOL`；
2. 当前归属是 `STORAGE_POOL` ⇒ 必须存在且仅存在一条占用中的寄仓记录；
3. 寄仓记录 `CLAIMED` ⇒ 当前归属是该记录上的 `claimed_sales_order_id`；
4. 位置事件只能引用 `IN_STORAGE` 的寄仓记录，且 `OVERSEAS ↔ OVERSEAS`。

## 4. 解析服务

```ts
// server/src/modules/shipment-ownership/shipment-ownership.resolver.ts
resolveShipmentOwner(transaction, shipmentId): Promise<{
  ownerType: 'SALES_ORDER' | 'STORAGE_POOL' | 'COMPANY'
  ownerSalesOrderId: string | null
  state: 'ACTIVE' | 'VOIDED'
}>
```

调用方：

| 调用方 | 用途 |
|---|---|
| `purchase-order-access.ts` | 数据范围谓词 |
| `operations-ocean-container.service.ts` | 柜次“我的”标记 |
| `sales-order-container-load-progress.ts` | 装柜推进履约 |
| `sales-order-warehouse-progress.ts` | 到仓推进履约 |
| `purchase-shipment-delivery.service.ts` | 签收推进履约 |
| `slh-reconciliation-batch.matcher.ts` / `.service.ts` | 对账收款人 |
| `packaging-cost.service.ts` | 包装费提报的货件可见性（列表仍按 `ownerUserId`） |

## 5. 接口设计

### 5.1 寄仓列表与详情

```text
GET /shipment-storage
  ?keyword=&status=&locationScope=&warehouseValue=&page=&pageSize=
GET /shipment-storage/:storageRecordId
```

响应字段（新增 DTO）：

| 字段 | 说明 |
|---|---|
| `id` | 寄仓记录 id |
| `shipmentId` / `shipmentNo` / `shippingMarkText` | 货件身份快照 |
| `status` | `IN_STORAGE` / `RESERVED` / `CLAIMED` / `VOIDED` |
| `locationScope` / `warehouse` | 位置范围与仓库（含 label） |
| `originPurchaseOrder` / `originSalesOrder` / `originIssuer` | 来源快照 |
| `costSnapshot` | 成本、已付、比例、两腿金额 |
| `containerSnapshot` | 柜次、装柜明细、收件人、COD |
| `claimedSalesOrder` / `claimedAt` | 认领信息 |
| `createdAt` / `locationUpdatedAt` | 时间 |

### 5.2 释放

```text
POST /shipment-storage/releases
{
  "shipmentIds": ["..."],
  "locationScope": "MAINLAND" | "OVERSEAS",
  "overseasWarehouseValue": "RF_TZ" | "RF_LK",   // 仅 OVERSEAS
  "reason": "CUSTOMER_CANCEL" | "CUSTOMER_REJECT" | "OTHER",
  "note": "可空",
  "requestKey": "uuid"
}
```

校验：

| 条件 | 失败码 |
|---|---|
| 货件不存在 / 不可见 | 404 `PURCHASE_ORDER_PART_NOT_FOUND` |
| 非 `ACTIVE` | 422 `SHIPMENT_STORAGE_NOT_ALLOWED` |
| 已签收 | 422 `SHIPMENT_STORAGE_DELIVERED` |
| 未发货 / 未到仓 | 422 `SHIPMENT_STORAGE_NOT_RECEIVED` |
| 已有占用中的寄仓记录 | 409 `SHIPMENT_STORAGE_ALREADY_ACTIVE` |
| 内地仓与目的地不一致 | 422 `SHIPMENT_STORAGE_LOCATION_INVALID` |
| 内地仓为空 | 422 `SHIPMENT_STORAGE_DESTINATION_MISSING` |
| 海外仓值无效 | 422 `SHIPMENT_STORAGE_LOCATION_INVALID` |
| 幂等键冲突 | 409 `SHIPMENT_STORAGE_IDEMPOTENCY_CONFLICT` |

### 5.3 位置移动

```text
POST /shipment-storage/:storageRecordId/location
{ "warehouseValue": "RF_TZ" | "RF_LK", "reason": "...", "requestKey": "uuid" }
```

- 只允许 `IN_STORAGE`；
- 只允许 `OVERSEAS ↔ OVERSEAS`；
- 内地位置不可移动；
- 追加位置事件并更新当前快照。

### 5.4 认领

```text
GET  /sales-orders/:salesOrderId/storage-claim-context
POST /shipment-storage/:storageRecordId/claim
{
  "salesOrderId": "...",
  "lines": [{ "salesOrderLineId": "...", "quantity": 1 }],
  "requestKey": "uuid"
}
```

首期约束：

- 整件认领：`lines` 的数量之和必须等于货件全部数量；
- 销售单必须 `CONFIRMED`；
- 销售行必须存在且 `removedAt` 为空；
- 不允许同一货件被两个销售单同时认领。

### 5.5 终止态

复用现有路由：

```text
PATCH /sales-orders/:salesOrderId/order-status
{ "toStatus": "TERMINATED", "reason": "..." }
```

新增前置（推荐规则，待 G-15 拍板）：

- 订单为 `CONFIRMED`，未取消、未完成；
- 无待审核收款；
- 已签收货件保持完成，不参与释放；
- 终止要求全部非签收货件已释放或已认领，避免混合状态悬空；
- 已有有效收款保留，不冲正。

## 6. 读路径切换

| 顺序 | 文件 | 改动 |
|---|---|---|
| 1 | `purchase-order-access.ts` | `purchaseOrderPartScopeWhere` 改为按归属投影；新增 `shipmentScopeWhere` |
| 2 | `operations-ocean-container.service.ts` | `mine` 标记改按归属 |
| 3 | `sales-order-container-load-progress.ts` | `salesOrderIdsOfShipments` 改按归属 |
| 4 | `sales-order-warehouse-progress.ts` | 同上 |
| 5 | `purchase-shipment-delivery.service.ts` | 签收推进与守卫改按归属 |
| 6 | `slh-reconciliation-batch.matcher.ts` / `.service.ts` | 匹配与结算收款人 |
| 7 | `packaging-cost.service.ts` | 仅提报入口的货件可见性改按归属；费用列表仍按 `ownerUserId`，不切换 |

每条切换后用 `shipments:ownership-parity` 比较新旧解析结果，零差异才继续。

## 7. 权限、审计、幂等与并发

### 7.1 权限

| 权限码 | 用途 | 默认授予 |
|---|---|---|
| `shipment-storage:read` | 寄仓列表/详情 | `system_admin` |
| `shipment-storage:release` | 释放 | `system_admin` |
| `shipment-storage:claim` | 认领 | `system_admin` |
| `shipment-storage:relocate` | 位置移动 | `system_admin` |
| `sales-orders:terminate` | 销售单终止 | `system_admin` |

不做仓库级数据权限隔离：有 `shipment-storage:read` 即可看到全部记录。

### 7.2 审计

| 事件 | 触发 |
|---|---|
| `SHIPMENT_OWNERSHIP_RELEASED` | 释放 |
| `SHIPMENT_STORAGE_RECORDED` | 生成寄仓记录 |
| `SHIPMENT_STORAGE_LOCATION_CHANGED` | 位置移动 |
| `SHIPMENT_STORAGE_CLAIMED` | 认领 |
| `SHIPMENT_COST_TRANSFERRED` | 成本转移 |
| `SALES_ORDER_TERMINATED` | 销售单终止 |

审计 metadata 至少包含：货件 id、寄仓记录 id、来源销售单、目标销售单、金额、位置、请求 id。

### 7.3 幂等

- 归属事件：`(actor_user_id, request_key)` 唯一；
- 释放：`shipment_storage_records` 部分唯一索引 + `request_key`；
- 认领：`shipment_claim_lines` 不可重复 + 寄仓记录状态检查；
- 成本转移：`${storageRecordId}:RELEASE|CLAIM` 幂等键。

### 7.4 并发与锁序

沿用现有“销售明细 → 采购单 → 销售主行”的锁序；新增锁只在其后：

```text
销售明细（UUID 升序）
-> 采购单
-> 货件（UUID 升序，FOR UPDATE）
-> 寄仓记录
-> 资金账户 / 批次
```

释放与认领必须在同一事务内完成归属、寄仓记录、成本事件与审计；任一步失败整体回滚。

## 8. 迁移、回填与 CLI

### 8.1 M1 迁移

纯 additive：

1. 新枚举、新表、索引、触发器；
2. 回填每个货件的初始归属：
   - `SALES_LINKED` → `SALES_ORDER` + `purchaseOrder.salesOrderId`；
   - `STOCK` / 无来源 → `COMPANY`；
   - 已取消货件 → `VOIDED`；
3. 自检：件数、投影覆盖、最大 sequence、归属分布；
4. 失败关闭，不伪造历史。

### 8.2 双写

| 现有事务 | 追加 |
|---|---|
| 采购创建 | 每货件一条 `PURCHASE_CREATED` |
| 采购取消/驳回 | 每货件一条 `ORDER_CANCELLED`（VOIDED） |

### 8.3 CLI

```text
pnpm -C server shipments:backfill-ownership --dry-run
pnpm -C server shipments:backfill-ownership --apply
pnpm -C server shipments:ownership-parity
pnpm -C server dictionaries:ensure-overseas-warehouse --dry-run
pnpm -C server dictionaries:ensure-overseas-warehouse --apply
```

字典 CLI 规则：

- 类型不存在则创建；存在但停用则启用；
- 条目 `RF_TZ`/`RF_LK` 不存在则创建并启用；已存在但标签不同只报告差异，不覆盖；
- 全部操作幂等，输出新增/启用/跳过/差异计数。

## 9. 测试策略

| 层级 | 覆盖 |
|---|---|
| 单元 | 归属解析、释放资格、位置规则、成本两腿计算、快照构造 |
| 迁移 | 夹具库上执行 M1，验证自检与 parity |
| 集成 | 释放 → 认领 → 装柜/签收 → 对账 |
| e2e | 现有 29 个货件/装柜相关文件不改断言；新增寄仓与终止用例 |
| 契约 | 迁移期零变更；功能期只做 additive 变更 |
| 性能 | 货件列表 SELF、寄仓列表按位置的 EXPLAIN |

## 10. 公共契约影响（需授权）

| 变更 | 类型 |
|---|---|
| 新增 `/shipment-storage` 系列接口 | 新增公共 API |
| 新增 `TERMINATED` 销售状态 | 公共枚举变更 |
| 新增五个权限码 | 权限目录变更 |
| 新增六类审计事件 | 审计枚举变更 |
| 新增数据库表与枚举 | 持久化结构变更 |
| 新增字典类型与条目 | 业务数据变更 |

## 11. 未覆盖项

见 [缺口与风险](./gaps.md)。
