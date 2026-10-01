# 顺联航账单对账批次技术设计

## 0. 文档状态

- 状态：已确认
- 确认日期：2026-09-29

## 1. 设计目标与约束

1. 批次是「一次对账作业」的容器：`批次 → 账单` 为 N:1，`批次 → 明细行` 在创建时按匹配结果冻结。
2. 不引入第二套对账状态来源：账单三态仍只由 `slh_bill_lines.reconciled_at` 汇总派生（`server/src/modules/slh-bills/slh-bill-reconciliation.ts` 是唯一定义处）。
3. 不修改 `slh_bills`、`slh_bill_lines` 表结构，也不修改 `enforce_slh_bill_identity` 与 `enforce_slh_bill_evidence_immutable` 两个触发器：核对只写已在凭证不可改白名单内的 `reconciled_at`。
4. 批次编号必须复用编号域生成器 `NumberingGeneratorService.generateScopedInTransaction`，代码侧只声明 `SLH_RECON_BATCH_NO` 与 `SLH_RECON_BATCH.CREATE`。
5. 新增能力复用既有权限码 `slh-bills:reconcile`，不新增权限目录条目。

## 2. 数据模型

### 2.1 新表 `slh_reconciliation_batches`（model `SlhReconciliationBatch`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` PK，`gen_random_uuid()` | |
| `batch_no` | `varchar(64)` UNIQUE | 编号域 `SLH_RECON_BATCH_NO` 派发，形如 `SRB-202609-001` |
| `numbering_issuance_id` | `uuid` UNIQUE，FK → `numbering_issuances` RESTRICT | 与派发台账 1:1 |
| `bill_id` | `uuid` NOT NULL，FK → `slh_bills` RESTRICT | 被核对的账单（弹窗第一步选定） |
| `completed_at` | `timestamptz(6)` NULL | 空即进行中 |
| `completed_by_id` | `uuid` NULL，FK → `users` RESTRICT | 结束人 |
| `creation_request_key_hash` | `bytea` NOT NULL | `Idempotency-Key` 的 sha256 |
| `creation_payload_hash` | `bytea` NOT NULL | 请求指纹（含 billId 与域版本，不含操作者与时间） |
| `created_by_id` / `updated_by_id` | `uuid` NOT NULL，FK → `users` RESTRICT | |
| `created_at` / `updated_at` | `timestamptz(6)` NOT NULL | `updated_at` 带 `@updatedAt` |
| `version` | `int` NOT NULL DEFAULT 1 | 结束动作会更新本行 |

- 唯一/索引：`@@unique([createdById, creationRequestKeyHash])`、`@@index([billId, completedAt])`（占用判定）、`@@index([createdAt desc, id desc])`（列表）。
- 触发器 `enforce_slh_reconciliation_batch_identity`：INSERT 时校验 `numbering_issuances` 的 `generated_number`、`consumer_code = 'SLH_RECON_BATCH.CREATE'`、规则 `rule_code = 'SLH_RECON_BATCH_NO'`、`purpose = 'BUSINESS'` 四元一致，否则 `23514`（照 `enforce_slh_bill_identity` 的写法）。
- 派生、不落列：状态（`completed_at IS NULL` → `IN_PROGRESS`，否则 `COMPLETED`）、成员行数、成员已核对行数。

### 2.2 新表 `slh_reconciliation_batch_lines`（model `SlhReconciliationBatchLine`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `batch_id` | `uuid` NOT NULL，FK → `slh_reconciliation_batches` RESTRICT | |
| `line_id` | `uuid` NOT NULL，FK → `slh_bill_lines` RESTRICT | 匹配命中的明细行 |
| `matched_loading_item_id` | `uuid` NOT NULL，FK → `container_loading_items` RESTRICT | 冻结的匹配依据，同时是核对复检的锚点 |
| `match_source` | `slh_bill_line_match_source` NOT NULL | `NAME`（柜号名称命中）/ `MARK`（唛头推断命中） |
| `reconciled_at` | `timestamptz(6)` NULL | 本批次核对该行的时刻 |
| `reconciled_by_id` | `uuid` NULL，FK → `users` RESTRICT | 核对人 |
| `created_at` | `timestamptz(6)` NOT NULL | |

- 唯一/索引：`@@unique([batchId, lineId])`、`@@index([lineId])`、`@@index([batchId, reconciledAt])`。
- 追加型：`reconciled_at` 只写一次，其余列创建后不再更新。

**为什么成员行自带 `reconciled_at`**：同一明细行可在多个批次出现（上一轮匹配到但未核对，下一轮重新命中）。若批次进度按行的 `reconciled_at` 反推，历史批次会被后续轮次污染；成员行自带核对时刻后，批次进度只与本批次有关。

**为什么不给 `slh_bill_lines` 加列**：行级二态已由 `reconciled_at` 承担，成员关系是批次的范围，放独立表既避免改凭证不可改触发器白名单，也让同一行跨轮次的成员关系可留痕。

### 2.3 新枚举 `slh_bill_line_match_source`

`NAME` / `MARK`。删除或重排取值需重建类型（PostgreSQL 限制），追加取值用 `ALTER TYPE ... ADD VALUE`。

### 2.4 迁移

| 顺序 | 目录 | 内容 |
| --- | --- | --- |
| 1 | `20260929120000_slh_reconciliation_batch` | 建两张表、索引、FK、新枚举、编号身份触发器 |
| 2 | `20260929121000_slh_reconciliation_batch_audit_events` | `ALTER TYPE "audit_event_type" ADD VALUE`：`SLH_RECONCILIATION_BATCH_CREATED`、`SLH_RECONCILIATION_BATCH_COMPLETED`、`SLH_BILL_LINES_RECONCILED` |

两条迁移必须同步登记到 `docs/后端文档/数据库迁移规范.md` 的「## 2. 当前迁移基线」（治理测试逐目录名断言）。

## 3. 匹配引擎

### 3.1 落点

`server/src/modules/slh-reconciliation-batches/slh-bill-line-matching.ts`，纯函数 + 单测，与账单侧 `slh-bill-reconciliation.ts` 同为「规则唯一定义处」的写法。柜次名称规范化复用装柜导入的等价规则（`container-batches/import-parser.ts` 的 `batchName()` 形态），在本模块内实现同名纯函数并单测。

### 3.2 输入与输出

```ts
interface ReconciliationLineInput {
  lineId: string
  loadingDate: string        // ISO 日期，账单行装柜日期，年份的唯一来源
  containerBatchNameText: string | null
  shippingMarkText: string | null
}
interface ReconciliationLoadingItem {
  id: string
  containerBatchId: string
  cycleDate: string          // 所属柜次装柜日期（LADING_DATE）
  oceanShippingMarkText: string | null
  hasShipment: boolean
  hasSalesSource: boolean
  hasPurchaseSource: boolean
}
interface LineMatchResult {
  lineId: string
  status: 'MATCHED' | 'UNMATCHED'
  loadingItemId: string | null
  source: 'NAME' | 'MARK' | null
  reason: LineMatchReason | null   // 分层原因码
}
```

原因码：`MISSING_CONTAINER_REFERENCE`、`INVALID_CONTAINER_NAME`、`CONTAINER_NOT_FOUND`、`CONTAINER_AMBIGUOUS`、`MARK_NOT_FOUND_IN_CONTAINER`、`SHIPMENT_NOT_MATCHED`、`SALES_SOURCE_MISSING`、`PURCHASE_SOURCE_MISSING`。

### 3.3 规则

1. **柜次定位**
   - 名称路径：`/(\d{2})(\d{2})(?:-(\d{2}))?柜(?:子)?/` 从账单行柜号文本取 `MMDD` 与序号（缺省 1），年份取该行 `loadingDate` 的年份（Asia/Shanghai），按 `装柜日期 + 序号` 定位柜次。
   - 唛头推断（仅当名称路径无法定位时启用）：从唛头按 `-` 之后的 4 位数字取 `MMDD`，且必须是合法月日；年份同样取该行装柜日期年份，序号取 1。
   - 命中 0 条 → `CONTAINER_NOT_FOUND`；命中多于 1 条（同一天同序号不同仓库）→ `CONTAINER_AMBIGUOUS`，不猜测。
2. **柜次行匹配**：在定位到的柜次内用账单行唛头与柜次行唛头比较（大小写与空白归一），命中行必须唯一（柜次内唛头唯一由装柜导入强制）；未命中 → `MARK_NOT_FOUND_IN_CONTAINER`。账单行缺唛头时按同一原因返回。
3. **合格三条件**：`hasShipment`、`hasSalesSource`、`hasPurchaseSource` 全部为真，否则按缺失项返回对应原因。
4. 禁止使用当前年份作为推断年份（`deriveContainerDate` 的口径不适用于回溯对账）。

## 4. 服务端模块与接口

### 4.1 模块结构

`server/src/modules/slh-reconciliation-batches/`：`slh-reconciliation-batch.controller.ts`、`slh-reconciliation-batch.service.ts`（写路径）、`slh-reconciliation-batch-query.service.ts`（读路径）、`slh-reconciliation-batch.dto.ts`、`slh-reconciliation-batch.serializer.ts`、`slh-bill-line-matching.ts`、`slh-reconciliation-batch.module.ts`。注册进 `server/src/http.modules.ts`。

跨模块复用：从 `slh-bills` 模块导入并导出 `slhBillListInclude`、`toSlhBillListItemDto`、`slhBillReconciliationConditions`（后两者当前为模块私有，需改为导出），用于候选账单与成员账单行的序列化口径统一。

### 4.2 接口

| 方法 + 路径 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/slh-reconciliation-batches` | `slh-bills:reconcile` | 列表，支持 `status`（`IN_PROGRESS` / `COMPLETED` / `all`，默认 `IN_PROGRESS`）与分页 |
| `GET /api/slh-reconciliation-batches/candidates` | 同上 | 候选账单分页（复用 `SlhBillPageDto`） |
| `POST /api/slh-reconciliation-batches/match-preview` | 同上 | 纯读匹配预览，body `{ billId }` |
| `POST /api/slh-reconciliation-batches` | 同上 | 创建（201，`Idempotency-Key` 必带），body `{ billId, previewLineIds? }` |
| `GET /api/slh-reconciliation-batches/:id` | 同上 | 详情（批次头 + 成员行 + 四个计数） |
| `POST /api/slh-reconciliation-batches/:id/reconcile` | 同上 | 核对，body `{ lineIds }` |
| `POST /api/slh-reconciliation-batches/:id/complete` | 同上 | 结束本次对账 |

静态路径（`candidates`、`match-preview`）必须声明在 `:id` 之前。

### 4.3 写路径事务

**创建**：`SELECT ... FOR UPDATE` 锁目标账单行 → 复检「生效中 ∧ 至少一行未对账 ∧ 无进行中批次」→ 匹配未对账行 → 零命中拒绝 → 若请求带 `previewLineIds` 则与命中集合比对，不一致拒绝 → 取号 → INSERT 批次 → INSERT 成员行 → 审计 → COMMIT。

**核对**：校验批次进行中 → 校验行属于本批次且未对账 → 用成员行的 `matched_loading_item_id` 复检合格三条件 → 任一行失败即整批拒绝 → 批量写 `slh_bill_lines.reconciled_at` 与成员行 `reconciled_at/reconciled_by_id` → 审计 → COMMIT。

**结束**：校验批次进行中 → 写 `completed_at/completed_by_id`（允许 0 行核对）→ 审计 → COMMIT。

### 4.4 错误码

| 错误码 | HTTP | 场景 |
| --- | --- | --- |
| `SLH_RECON_BATCH_CONFLICT` | 409 | 账单已有进行中批次 |
| `SLH_RECON_BATCH_NO_LINES_TO_RECONCILE` | 409 | 零命中所致无法创建 |
| `SLH_RECON_BATCH_SCOPE_CHANGED` | 409 | 预览集合与创建时重跑集合不一致 |
| `SLH_RECON_BATCH_LINES_NOT_ELIGIBLE` | 409 | 核对复检失败（返回行号与原因） |
| `SLH_RECON_BATCH_NOT_IN_PROGRESS` | 409 | 往已结束批次追加核对或重复结束 |
| `SLH_RECON_BATCH_NUMBERING_UNAVAILABLE` | 409 | 编号规则缺失或未启用 |
| `SLH_RECON_BATCH_STATE_CHANGED` | 409 | 序列化/死锁等可重试冲突 |

### 4.5 审计

`SLH_RECONCILIATION_BATCH_CREATED`（metadata：批次编号、账单编号、成员行数）、`SLH_RECONCILIATION_BATCH_COMPLETED`（批次编号、账单编号、已核对行数）、`SLH_BILL_LINES_RECONCILED`（批次编号、账单编号、行号数组，字符串数组在 `validateMetadata` 默认允许范围内）。事件中文标签加入 `web/apps/qsmds-arco/src/views/system/audit/presentation.ts`。

## 5. 前端设计

### 5.1 文件

| 文件 | 职责 |
| --- | --- |
| `src/api/modules/slh-reconciliation-batches.ts` | 7 个接口的客户端封装，读请求带 `AbortSignal`，写请求 `retry: false` + 幂等键 |
| `src/views/workbenches/slh-reconciliation/index.vue` | 批次列表 + 「新建对账」入口 |
| `src/views/workbenches/slh-reconciliation/list.logic.ts` | 列表查询构造、状态筛选与列定义 |
| `src/views/workbenches/slh-reconciliation/slh-bill-select-modal.vue` | 两步弹窗视图 |
| `src/views/workbenches/slh-reconciliation/select-modal.logic.ts` | 两步状态机、禁用条件、预览数据装配 |
| `src/views/workbenches/slh-reconciliation/detail.vue` | 详情页：批次信息 + 两个数字 + 成员行表 + 核对/结束 |
| `src/views/workbenches/slh-reconciliation/reconciliation-status.logic.ts` | 批次状态与匹配来源的取值到文案/颜色映射 |

### 5.2 交互要点

- 弹窗骨架沿用 `operations/ocean-containers/change-modal.vue`：`QsGenericModal` + `FaSteps` + 按步骤切换正文与页脚；第二步加载态用 `FaMultiStepLoader`（「读取明细行 → 匹配柜次行」两段）。
- 详情页只渲染成员行；头部两个数字来自详情接口的四个计数。
- 核对提交为整批语义：勾选行 → 提交 → 失败时展示服务端返回的行号与原因，成功时刷新详情。
- 详情页的核对交互（勾选、批量提交）为满足流程闭环的最小实现，视觉细节后续单独设计。

### 5.3 路由与文案

- 列表沿用现路径 `slh-bill-reconciliation`（替换占位组件），详情新增隐藏兄弟叶子 `slh-bill-reconciliation/:id`（`menu:false` + `activeMenu`）。
- 文案加入 `src/locales/lang/workbench/{zh-cn,zh-tw,en}.json`：`workbench.slhBillReconciliationDetail` 与 `slhReconciliation.*` 组，三语同步。

## 6. 测试策略

1. **匹配纯函数单测**：每条原因码一个用例 + 四类反例（跨年同单、唛头尾两位不参与序号、缺唛头、跨仓歧义）+ 柜号名称规范化。
2. **服务端 e2e**（复用 `createPackagingCostHarness` 隔离 schema，自动重放全部迁移）：创建 + 编号派发 + 编号身份一致性、占用冲突、零命中、预览范围不一致、复检整批拒绝、核对成功后的行级与账单级状态、结束解除占用并允许再次创建、幂等重试返回同一批次。
3. **前端测试**：路由清单同步（叶子总数 13 → 14）、两步弹窗逻辑单测、详情页数据边界（只含成员行）、接口客户端 URL/头断言。
4. **契约**：`node --run contract:sync` 后三份产物一致，`contract:check` 通过。

## 7. 风险与取舍

| 风险 | 处理 |
| --- | --- |
| 柜次名称不含年份，跨年同名柜次合法共存 | 年份一律取明细行装柜日期；缺柜号且唛头推断不出年份无法确定时归不合格 |
| 账单侧没有仓库维度 | 同一天同序号跨仓命中多条时归 `CONTAINER_AMBIGUOUS`，不猜测 |
| 柜次行可编辑（有变更记录），冻结依据可能失效 | 核对时以冻结的 `matched_loading_item_id` 复检合格三条件，失效则整批拒绝并提示原因 |
| 账单可能被后续导入取代 | 存在进行中批次时由创建/复检路径自然失效（成员行仍指向原账单）；取代拦截不在本轮范围，作为后续独立变更 |
| 批次成员在创建后冻结，期间柜次行补齐不会自动进入本轮 | 由业务动作「结束本轮 → 重新发起」承接；详情页通过两个数字暴露剩余工作量 |
| 编号规则需管理员配置 | 创建时编号不可用返回 `SLH_RECON_BATCH_NUMBERING_UNAVAILABLE`，提示检查 `SLH_RECON_BATCH_NO`；上线前置写入实施计划 |
