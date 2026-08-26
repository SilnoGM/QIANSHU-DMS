# 销售订单履约状态扩展技术设计

## 1. 文档状态

- 状态：已确认
- 设计日期：2026-08-26
- 需求规格：[销售订单履约状态扩展需求规格](./requirements.md)
- 依赖设计：[销售订单域技术设计](../sales-order-domain/design.md)

## 2. 当前实现审计

当前履约状态枚举和严格相邻流转为：

```text
PENDING（待处理）
  -> PREPARING（备货中）
  -> SHIPPED（已发货）
  -> SIGNED（已签收）
```

- `SalesOrder.fulfillmentStatus` 使用 PostgreSQL Enum，默认值为 `PENDING`。
- `sales-order-state-machine.ts` 只允许相邻状态流转。
- 进入 `SIGNED` 前必须存在有效 `DELIVERY_RECEIPT`。
- “货物签收”只上传订单级凭证，不自动改变履约状态。
- 列表查询、筛选、桌面/窄屏标签和变更记录各自维护状态映射。
- `SalesOrderStatusHistory.fromStatus/toStatus` 使用字符串保存历史编码；审计事件元数据也保存原始状态编码。

## 3. 目标状态模型

Prisma 与 PostgreSQL 的目标枚举固定为：

```prisma
enum SalesOrderFulfillmentStatus {
  PENDING
  PREPARING
  LAND_TRANSIT
  WAREHOUSE_ARRIVED
  SEA_TRANSIT
  SIGNED

  @@map("sales_order_fulfillment_status")
}
```

状态机固定为：

```text
PENDING
  -> PREPARING
  -> LAND_TRANSIT
  -> WAREHOUSE_ARRIVED
  -> SEA_TRANSIT
  -> SIGNED
```

每个状态只允许进入右侧相邻状态。`SIGNED` 没有后继状态；进入 `SIGNED` 时继续调用现有有效签收单校验。

## 4. 数据库迁移设计

新增且只追加一个 migration，建议命名：

```text
20260826xxxxxx_expand_sales_order_fulfillment_status
```

迁移在同一事务中按以下顺序执行：

1. 创建临时 Enum `sales_order_fulfillment_status_next`，包含六个目标状态。
2. 删除 `sales_orders.fulfillment_status` 的旧默认值。
3. 把列类型切换到临时 Enum；转换时将 `SHIPPED` 映射为 `LAND_TRANSIT`，其余编码保持同名。
4. 删除旧 Enum，将临时 Enum 重命名为 `sales_order_fulfillment_status`。
5. 恢复 `sales_orders.fulfillment_status DEFAULT 'PENDING'`。
6. 对 `sales_order_status_history` 中 `dimension = 'FULFILLMENT'` 的记录，把 `from_status/to_status = 'SHIPPED'` 更新为 `LAND_TRANSIT`。
7. 对 `event_type = 'SALES_ORDER_FULFILLMENT_STATUS_CHANGED'` 的审计事件，使用 `jsonb_set` 把元数据中的 `fromStatus/toStatus = 'SHIPPED'` 更新为 `LAND_TRANSIT`。
8. 增加迁移内断言，确认订单当前状态、履约历史和对应审计元数据均不存在 `SHIPPED`。

该迁移属于等价编码转换，不是业务操作，因此：

- 不增加 `SalesOrder.version`。
- 不修改 `SalesOrder.updatedAt`。
- 不新增状态历史或审计事件。
- 不猜测旧 `SHIPPED` 订单实际处于到仓或海运阶段，统一放在新增链路的第一个运输状态 `LAND_TRANSIT`，后续由管理员继续推进。

既有 migration 保持不可变。新的 migration 必须通过 Prisma drift gate 和隔离数据库部署验证。

## 5. Server 设计

### 5.1 状态机

更新 `FULFILLMENT_TRANSITIONS`：

```text
PENDING: [PREPARING]
PREPARING: [LAND_TRANSIT]
LAND_TRANSIT: [WAREHOUSE_ARRIVED]
WAREHOUSE_ARRIVED: [SEA_TRANSIT]
SEA_TRANSIT: [SIGNED]
SIGNED: []
```

继续复用：

- `SALES_ORDER_FULFILLMENT_TRANSITION_INVALID`
- `SALES_ORDER_DELIVERY_RECEIPT_REQUIRED`

不新增错误码，不改变签收单查询和订单行锁边界。

### 5.2 Mutation 与查询

- `FULFILLMENT_STATUSES` 更新为六个目标状态，用于运行时防御校验。
- `SalesOrderFulfillmentStatusRequestDto` 继续使用生成的 Prisma Enum 和 `@IsEnum`。
- 列表查询 DTO、详情响应和状态历史响应结构保持不变，只扩展枚举取值。
- 列表、详情、汇总和出单人筛选逻辑不做其他修改。

### 5.3 OpenAPI

公共路径和权限保持不变：

```http
GET   /api/sales-orders?fulfillmentStatus=...
PATCH /api/sales-orders/:salesOrderId/fulfillment-status
```

OpenAPI 中所有 `SalesOrderFulfillmentStatus` 引用统一生成六个取值，移除 `SHIPPED`。通过根级 `contract:sync` 同步 Server/Web 快照和生成类型，禁止手工编辑快照或生成文件。

## 6. Web 设计

### 6.1 筛选与查询

订单列表的履约状态筛选按业务顺序展示：

```text
待采购 / 备货中 / 陆运中 / 已到仓 / 海运中 / 已签收
```

`buildListQuery()` 的允许值同步为六个编码，继续忽略非允许值。

### 6.2 标签与语义颜色

桌面端和窄屏端复用同一映射函数：

| 状态 | 语义颜色 |
| --- | --- |
| 待采购 | muted gray |
| 备货中 | amber |
| 陆运中 | sky |
| 已到仓 | teal |
| 海运中 | blue |
| 已签收 | primary green |

实现只使用现有主题 Token 与 UnoCSS 明暗主题类。状态文字始终可见，颜色不承担唯一语义。

### 6.3 变更记录

`statusValueLabel()` 增加三个新编码并删除 `SHIPPED` 映射，保证历史迁移后显示：

```text
LAND_TRANSIT -> 陆运中
WAREHOUSE_ARRIVED -> 已到仓
SEA_TRANSIT -> 海运中
```

不改变变更记录 Tabs、计数或数据加载协议。

## 7. TDD 与验证策略

### 7.1 先写失败测试

- Prisma schema/迁移结构测试期望六值枚举和历史编码迁移。
- 状态机测试覆盖五条合法相邻流转、跳级/倒退拒绝和 `SEA_TRANSIT -> SIGNED` 的签收单约束。
- Mutation 测试把旧 `SHIPPED -> SIGNED` 场景改为 `SEA_TRANSIT -> SIGNED`。
- OpenAPI 测试断言包含六个目标编码且不包含 `SHIPPED`。
- Web 页面测试断言筛选顺序、标签映射、语义颜色和变更记录文案。

### 7.2 必要验证

```bash
pnpm -C server prisma:validate
pnpm -C server test:prisma-drift-gate
pnpm -C server exec jest <sales-order focused specs> --runInBand
pnpm -C server typecheck
pnpm -C server lint
node --run contract:sync
node --run contract:check
pnpm -C web test:api
pnpm -C web typecheck
pnpm -C web lint
git diff --check
```

数据库 migration 还需在隔离测试库执行 `db:migrate:deploy`，并用只读 SQL 验证六个枚举值及 `SHIPPED` 零残留。

## 8. 安全与发布边界

- 本次修改 Prisma schema、追加 migration 和公共枚举契约，已在需求确认中获得授权。
- migration 与新 Server 必须作为同一版本发布；旧 Server 不应在新枚举值写入后继续提供 mutation。
- 不修改或删除既有 migration，不连接生产数据库，不执行生产部署。
- 不修改真实 `.env`，不在日志或审计中输出客户敏感信息。
- 实施完成后使用一个原子提交：`feat: 扩展销售订单履约状态`；不自动推送。

## 9. 不采用的方案

### 9.1 仅修改中文文案

无法表达新增的陆运、到仓和海运三个独立阶段，也不能用于查询和审计，拒绝采用。

### 9.2 保留 `SHIPPED` 作为隐藏兼容值

会让数据库、OpenAPI 和 Web 长期保留两套口径，增加分支和历史歧义，违反“不写不必要向后兼容代码”的项目约束，拒绝采用。

### 9.3 自动把旧 `SHIPPED` 推断为到仓或海运

现有数据没有可信证据支持更细粒度推断。为避免制造虚假进度，统一迁移到 `LAND_TRANSIT`。
