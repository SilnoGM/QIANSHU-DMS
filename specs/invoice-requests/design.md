# 开票申请与审批 技术设计

## 1. 文档状态

- 状态：设计已定稿（2026-10-14）。依据 [requirements.md](requirements.md) 定稿需求编写；需求侧无未决项，设计决策见第 13 节（已全部确认）。
- 目标模块：`server/src/modules/invoice-requests/`（服务端）、`web/apps/qsmds-arco/src/views/workbenches/invoices/`（前端）。
- 范围：数据结构与迁移、接口契约、资金入账接入、权限/审计/编号/媒体登记、前端落点与测试策略。**不含实现代码**。

## 2. 设计原则与真相源

| 能力 | 真相源 | 本设计如何沿用 |
| --- | --- | --- |
| 状态机与留痕 | 采购/销售订单的 `*StatusHistory` 表 + 全不可变触发器（`20260820120000_sales_order_domain/migration.sql:708-728`） | 单据内状态历史表，逐次记录动作、从→到、原因、操作人 |
| 生命周期保护 | `enforce_slh_reconciliation_settlement_lifecycle`（`20261011150000/migration.sql:87-106`）：删拒 + 单向流转 + 「去掉白名单列比较整行」 | 单据头用它；明细行用「父单状态决定可变性」的变体 |
| 幂等 | `SlhReconciliationSettlement` 的 `(actor, request_key_hash)` 唯一索引 + `Idempotency-Key` 头 | 同构：提交/重新提交/结算等变更携带幂等键 |
| 重复确认 | 顺联航账单重复导入的「`duplicateAcknowledged` + 409」二选一 | 四项比对沿用同一交互契约 |
| 状态计数 | `slh_bills_status_counts`（列表谓词复用 + 独立计数端点） | 同构：`invoice_requests_status_counts` |
| 金额精度 | 台币金额一律整数元（票面即整数）；人民币侧 2 位小数走资金域归一化 | 整数列（`BIGINT`）+ 人民币 `DECIMAL(30,2)` |
| 资金入账 | `SALES_RECEIPT` / `PACKAGING_COST` 的「新建来源 + 绑定既有类型」范式 | 新建来源 `INVOICE_REQUEST`，绑定既有 `INVOICE_FEE` |
| 编号 | `SLH_RECON_BATCH_NO` 范式（seed 建规则 + 事务内派发 + 身份校验触发器） | 同构：规则码 `INVOICE_REQUEST`，前缀 `INV` |
| 媒体 | `MediaAssetService.prepare` + multipart（`mediaType` 必须在 `file` 之前）+ 池/用途登记 | 新增池 `invoice` 与用途 `INVOICE_REQUEST_DOCUMENT` |

## 3. 数据模型

### 3.1 `InvoiceRequest`（发票申请单，`invoice_requests`）

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | UUID PK | `gen_random_uuid()` |
| `invoiceNo` | VARCHAR(64) UNIQUE | 申请单号，编号域派发；取消不回滚 |
| `numberingIssuanceId` | UUID UNIQUE FK | 指向 `numbering_issuances`，与 `invoiceNo` 成对非空 |
| `status` | `invoice_request_status` | 默认 `PENDING_REVIEW`；无草稿态 |
| `buyerName` | VARCHAR(200) | 抬头名称（手填，去首尾空白） |
| `buyerTaxId` | VARCHAR(8) | 统一编号，CHECK `~ '^\d{8}$'` |
| `salesAmount` | BIGINT | 销售额合计 = Σ 明细金额 |
| `taxAmount` | BIGINT | 营业税应税 = 四舍五入(`salesAmount` × 0.05) |
| `totalAmount` | BIGINT | 总计 = `salesAmount` + `taxAmount` |
| `invoiceRemark` | VARCHAR(500) NULL | 发票备注（进复制文本） |
| `internalRemark` | VARCHAR(500) NULL | 申请单备注（内部，不进复制文本） |
| `recipientName` / `recipientPhone` / `recipientAddress` | TEXT | 寄送信息；不设业务长度上限，电话单值、不做格式校验 |
| `submittedAt`（申请日期） | 无独立列 | 首次提交与建行同刻，申请日期即 `created_at`；重提只刷新 `last_submitted_at` |
| `lastSubmittedAt` | TIMESTAMPTZ | 最近一次提交时间 |
| `notifiedAt` / `notifiedByUserId` | TIMESTAMPTZ / UUID NULL | 审核并通知 |
| `returnedAt` / `returnedByUserId` | TIMESTAMPTZ / UUID NULL | 最近一次退回（全部历史在状态历史表） |
| `documentMediaAssetId` | UUID NULL UNIQUE FK | 发票照片，1 张，上传即定稿 |
| `documentUploadedAt` / `documentUploadedByUserId` | TIMESTAMPTZ / UUID NULL | 上传时间 = 5 天计时起点 |
| `settledAt` / `settledByUserId` | TIMESTAMPTZ / UUID NULL | 结算入账 |
| `settleAmountCny` | DECIMAL(30,2) NULL | 入账成本（人民币） |
| `exchangeRateId` / `exchangeRateVersionSnapshot` / `foreignUnitsPerCnySnapshot` / `rateCapturedAt` | UUID / INT / DECIMAL(30,12) / TIMESTAMPTZ NULL | 入账时冻结的汇率快照 |
| `fundPostingBatchId` | UUID NULL FK | 资金批次 id，入账后回写 |
| `cancelledAt` / `cancelledByUserId` / `cancelReason` | TIMESTAMPTZ / UUID / VARCHAR(500) NULL | 取消（终态，原因必填） |
| `createdById` | UUID FK | 提交人 = 申请人（资金成本的归属用户） |
| `requestKeyHash` | BYTEA | 提交幂等键哈希 |
| `version` | INT | 乐观锁，默认 1 |
| `createdAt` / `updatedAt` | TIMESTAMPTZ(6) | 仓库统一审计列 |

关键约束与索引：

- 唯一：`(createdById, requestKeyHash)`（提交幂等）；`invoiceNo`、`numberingIssuanceId`、`documentMediaAssetId`。
- 列表索引：`(createdById, createdAt DESC, id DESC)`（运营本人视图）、`(status, createdAt DESC, id DESC)`（财务待办视图）。
- 比对索引：`(buyerName, buyerTaxId, taxAmount, totalAmount)`，服务四项比对（见 7.3）。
- CHECK：`buyerTaxId ~ '^\d{8}$'` 且 `btrim(buyerName) <> ''`；`salesAmount > 0`；`taxAmount >= 0`（销售额为 1 元时取整后为 0）；`totalAmount = salesAmount + taxAmount`。
- 状态形状 CHECK（一条组合约束，参照 slh 的双空 CHECK 范式）：
  `status IN ('NOTIFIED','ISSUED','SETTLED') → notifiedAt IS NOT NULL`；
  `status IN ('ISSUED','SETTLED') → documentMediaAssetId IS NOT NULL AND documentUploadedAt IS NOT NULL`；
  `status = 'SETTLED' → settledAt IS NOT NULL AND settleAmountCny IS NOT NULL AND foreignUnitsPerCnySnapshot IS NOT NULL AND fundPostingBatchId IS NOT NULL`；
  `status = 'CANCELLED' → cancelledAt IS NOT NULL AND cancelReason IS NOT NULL`。
- `documentMediaAssetId` 唯一：一张照片只能挂一张单。

### 3.2 `InvoiceRequestLine`（明细行，`invoice_request_lines`）

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | UUID PK | |
| `requestId` | UUID FK | 归属不可变 |
| `lineNo` | INT | 1–5，与 `requestId` 组成唯一键 |
| `productName` | VARCHAR(200) | 品名，允许重复 |
| `quantity` | INT | CHECK `> 0` |
| `unitPrice` | BIGINT | CHECK `> 0` |
| `amount` | BIGINT | CHECK `> 0` 且 `amount = quantity * unit_price`（行内勾稽，参照顺联航行级费用勾稽 CHECK 的做法） |
| `createdAt` / `updatedAt` | TIMESTAMPTZ(6) | |

- 行数上限 1–5 在服务端校验（`POST`/重提时），DB 侧用 `lineNo ≤ 5` 的 CHECK 兜底。
- 汇总勾稽（`salesAmount = Σ amount`）为**跨表**关系，不写 DB 触发器，由服务端在同一事务内复算写入 + e2e 断言（取舍见第 13 节第 4 条）。

### 3.3 `InvoiceRequestStatusHistory`（状态历史，`invoice_request_status_history`）

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `id` | UUID PK | |
| `requestId` | UUID FK | |
| `action` | `invoice_request_action` | SUBMIT / RESUBMIT / RETURN / NOTIFY / UPLOAD_DOCUMENT / SETTLE / CANCEL |
| `fromStatus` | `invoice_request_status` NULL | 首条（SUBMIT）为空 |
| `toStatus` | `invoice_request_status` | |
| `reason` | VARCHAR(500) NULL | RETURN / CANCEL 必填；其余为空 |
| `actorUserId` | UUID FK | |
| `occurredAt` | TIMESTAMPTZ | |

- 索引 `(requestId, occurredAt, id)`。
- 全不可变：BEFORE UPDATE OR DELETE 触发器直接拒绝（范式一，同 `sales_order_status_history`）。
- 「取消时所处状态」由本表的 `fromStatus` 表达，不在主表冗余。

### 3.4 枚举

```prisma
/// 开票申请单状态。终态为 SETTLED / CANCELLED，终态后整单不可变。
enum InvoiceRequestStatus {
  PENDING_REVIEW  // 开票审核中
  RETURNED        // 已退回（可编辑重填）
  NOTIFIED        // 已通知开票
  ISSUED          // 已开出邮寄
  SETTLED         // 已结算入账（终态）
  CANCELLED       // 已取消（终态）
  @@map("invoice_request_status")
}

enum InvoiceRequestAction {
  SUBMIT
  RESUBMIT
  RETURN
  NOTIFY
  UPLOAD_DOCUMENT
  SETTLE
  CANCEL
  @@map("invoice_request_action")
}
```

### 3.5 触发器

1. **`invoice_requests` 生命周期**（BEFORE INSERT OR UPDATE OR DELETE）：
   - DELETE：拒绝（`invoice_requests_no_delete_check`）。
   - INSERT：`status` 必须为 `PENDING_REVIEW`。
   - UPDATE：
     - `OLD.status IN ('SETTLED','CANCELLED')` → 全拒（终态不可变）。
     - 流转白名单（其余组合一律拒绝）：`PENDING_REVIEW→NOTIFIED | RETURNED | CANCELLED`、`RETURNED→PENDING_REVIEW | CANCELLED`、`NOTIFIED→ISSUED | CANCELLED`、`ISSUED→SETTLED | CANCELLED`。
     - 列白名单：`OLD.status='RETURNED' AND NEW.status='PENDING_REVIEW'`（重填重提）时允许业务字段（抬头、统编、备注两个、寄送三项、汇总三项）与流转列同时变化；**其余流转只允许流转列变化**（`status`、对应时间戳与操作人、照片列、入账快照列、取消列、`lastSubmittedAt`、`version`、`updatedAt`）。
     - 实现用「`to_jsonb(NEW) - 白名单` 与 `to_jsonb(OLD) - 白名单` 比较」的两分支写法；身份类列（`id`、`invoiceNo`、`numberingIssuanceId`、`createdById`、`createdAt`）永远不在白名单内。
2. **`invoice_request_lines` 守卫**（BEFORE INSERT OR UPDATE OR DELETE）：
   - INSERT：父单状态 ∈ `(PENDING_REVIEW, RETURNED)`；`requestId` 一旦写入不可改。
   - UPDATE / DELETE：仅当父单当前状态为 `RETURNED` 才允许（即「重填」只在退回态发生）。
   - 依赖同一事务内的语句顺序：重填流程先改明细行、再翻父单状态，触发器读到的父单状态仍是 `RETURNED`。
3. **编号身份校验**（BEFORE INSERT ON `invoice_requests`）：校验引用的 `numbering_issuances` 行 `rule_code='INVOICE_REQUEST'`、`consumer_code='INVOICE_REQUEST.CREATE'`、`purpose='BUSINESS'`，且 `issuer` 与 `createdById` 一致（范式：`20260929120000_slh_reconciliation_batch/migration.sql:104-121`）。
4. **状态历史全不可变**（如前）。

## 4. 迁移清单

按依赖顺序，全部为**追加式 forward migration**，且必须逐条登记到《数据库迁移规范》第 2 节（CI 硬门禁：`scripts/root-governance.test.mjs:2381-2439` 要求每个 migration 目录名出现在该文档内）。

| 顺序 | 迁移 | 内容 |
| --- | --- | --- |
| 1 | `20261014090000_invoice_request_domain` | 两个枚举 + 三张表 + 索引 + CHECK + 四个触发器 + FK（一律 `ON DELETE RESTRICT ON UPDATE RESTRICT`） |
| 2 | `20261014091000_invoice_request_audit_events` | `ALTER TYPE "audit_event_type" ADD VALUE` × 7（新增枚举值单独成条，不与使用它的 DDL 同事务） |
| 3 | `20261014092000_invoice_request_permissions` | 8 条权限 + 授予 `system_admin` + `MigrationSelfCheck`（稳定 UUID `...171`–`...178` 续号） |
| 4 | `20261014093000_invoice_request_fund_source` | 新建 `fund_business_sources` 行 `INVOICE_REQUEST` + 绑定 `INVOICE_FEE` + `fund_posting_batches` 形状 CHECK + 断言块 |
| 5 | `20261014094000_invoice_request_media_reference` | 重建 `media_assets.upload_purpose` CHECK（加入 `INVOICE_REQUEST_DOCUMENT`，**必须带上全部既有五个值**）→ 以 `CREATE OR REPLACE` 在通用 READY 引用校验函数上追加开票申请分支 → 给 `invoice_requests` 挂延迟引用触发器 |

落地流程遵循《数据库迁移规范》：创建前查 `git status` 与授权 → 生成/手写后人工审查 SQL → 空库两次 `db:migrate:deploy` + `migrate status` + `_prisma_migrations` 逐条核对 → 同步登记文档 → `node --run test:root`。

## 5. 编号

- 规则码 `INVOICE_REQUEST`，前缀 `INV`，形状 `INV/YYYYMMDD-SEQ(4)`（与 `SALES_COLLECTION` 的 `SCO/YYYYMMDD-SEQ(4)` 同形）。`INV` 前缀与 `INVOICE_REQUEST` 规则码经核对均未被占用（既有 19 条规则无冲突）。
- 登记点：`server/src/cli/seed/seed.dataset.ts` 的 `SEED_NUMBERING_RULES`（编号规则没有 migration 直插，只能来自 seed 或管理页）。**同步更新 `server/test/seed.e2e-spec.ts` 的 `expectedRuleShapes` 精确集合（19 → 20 条）**。
- 派发：创建事务内 `numbering.generateScopedInTransaction(tx, { ruleCode, consumerCode: 'INVOICE_REQUEST.CREATE', idempotencyKey, requestFingerprint })`，`numberingIssuanceId` 落到单据。
- 取消的单号保留、不回滚；重新提交沿用原单号（不另发号）。

## 6. 媒体（发票照片）

- 新增存储池 `invoice`（`MEDIA_STORAGE_POOLS`，与既有 `bill`、`voucher` 等单数风格一致）；`media-object-key.ts` 池名正则 `^[a-z][a-z0-9-]{1,30}$` 满足。
- 新增用途 `INVOICE_REQUEST_DOCUMENT`：上传瞬间打标（`updateMany` + `uploadPurpose: null` 条件）。
- `MediaAssetService.prepare({ actorUserId, allowedTypes: ['IMAGE'], requestedType: 'IMAGE', pool: 'invoice', ... })`；既有校验即 jpg/png/webp、≤10 MiB、无 HEIC。
- 上传在业务事务内 `media.activate(tx, id)`，并把 `documentMediaAssetId` 写回单据，同时推进状态到 `ISSUED`。
- 需同步的文件：`media-object-key.ts`（池清单）、`media-object-key.spec.ts`（清单断言，`invoices` 反例可保留、新增 `invoice` 正例）、`media-key-migration.service.ts` 的 `UPLOAD_PURPOSE_POOLS`、`media-key-migration.service.spec.ts` 的 `RULE_SAMPLES`、迁移 5 的 CHECK。
- 实现阶段需核对：单列式媒体引用（`documentMediaAssetId`）是否需要登记进 `MEDIA_ASSET_REFERENCE_TABLES` 与 `media-reference.contract.spec.ts` 的断言集合（该 spec 要求 schema 中带媒体引用列的 model 与清单精确一一对应）。

## 7. 服务端模块与接口

### 7.1 模块边界

```
server/src/modules/invoice-requests/
  invoice-request.module.ts
  invoice-request.controller.ts        # 只做参数与契约装配
  invoice-request.dto.ts               # 请求/响应 DTO（class-validator）
  invoice-request.contract.ts          # 状态、动作、错误码常量与视图类型
  invoice-request.service.ts           # 状态机与全部写动作（事务边界在这层）
  invoice-request-query.service.ts     # 列表 / 状态计数 / 详情
  invoice-request-list-filter.ts       # 列表与计数共用谓词（唯一 where 构造点）
  invoice-request.logic.ts             # 纯函数：金额与营业税、取整、可结算判断、比对键
  invoice-request.errors.ts            # 域内失败出口 + 基础设施错误映射
  invoice-request-multipart.parser.ts  # 发票照片 multipart（mediaType 在 file 之前）
  invoice-request-fund.ts              # 资金入账适配（来源常量、摘要、metadata、幂等键）
```

列表与计数共用 `buildInvoiceRequestListWhere`，归属过滤（运营仅本人）与状态过滤在同一处表达，计数用「忽略自己那一维」的口径（参照 `slh-bill-list-filter.ts`）。

### 7.2 接口清单

| 能力 | API | operationId | 权限 | 关键约束 |
| --- | --- | --- | --- | --- |
| 列表 | `GET /api/invoice-requests` | `invoice_requests_list` | `:read` | 无 `:read-all` 时强制按 `createdById = actor` 过滤；返回 `{items,total,page,pageSize}` |
| 状态计数 | `GET /api/invoice-requests/status-counts` | `invoice_requests_status_counts` | `:read` | **必须注册在 `:id` 之前**；返回六态 `{value,count}[]` |
| 详情 | `GET /api/invoice-requests/:id` | `invoice_requests_get` | `:read` + 归属 | 含明细行、状态历史、照片元数据 |
| 提交 | `POST /api/invoice-requests` | `invoice_requests_create` | `:create` | 201；`Idempotency-Key`；`duplicateAcknowledged` |
| 重新提交 | `POST /api/invoice-requests/:id/resubmissions` | `invoice_requests_resubmit` | `:create` + 本人 | 仅 `RETURNED`；全量字段；`duplicateAcknowledged`；保留单号 |
| 退回 | `POST /api/invoice-requests/:id/returns` | `invoice_requests_return` | `:return` | 仅 `PENDING_REVIEW`；`reason` 必填 |
| 审核并通知 | `POST /api/invoice-requests/:id/notifications` | `invoice_requests_notify` | `:review` | 仅 `PENDING_REVIEW` |
| 上传照片 | `POST /api/invoice-requests/:id/document-uploads` | `invoice_requests_upload_document` | `:document` | 仅 `NOTIFIED`；multipart，`mediaType` 在 `file` 之前；已上传则 `INVOICE_REQUEST_DOCUMENT_EXISTS`。**实现调整**：不带 `expectedVersion`——并发保护由状态前置 + `document_media_asset_id` 唯一 + 触发器只放行 `NOTIFIED → ISSUED` 共同兜底 |
| 读发票照片 | `GET`/`HEAD` `/api/invoice-requests/:id/document` | `invoice_requests_get_document` / `invoice_requests_head_document` | `:read` + 归属 | 私有、不缓存、inline；没有照片与单据不可见都返回 404 |
| 结算入账 | `POST /api/invoice-requests/:id/settlements` | `invoice_requests_settle` | `:settle` | 仅 `ISSUED`；≥120 小时；携带 `expectedVersion` 与 `exchangeRateId/version`；`Idempotency-Key` |
| 取消 | `POST /api/invoice-requests/:id/cancellations` | `invoice_requests_cancel` | `:cancel` + 归属 | `reason` 必填；运营仅 `PENDING_REVIEW/RETURNED`，财务任意非终态 |

- 变更类接口一律要求 `Idempotency-Key` 头，并在服务层与 `(createdById, requestKeyHash)` / 业务化幂等键配合（提交用请求指纹，结算用 `${id}:SETTLE`）。
- 全部写动作携带 `expectedVersion`，不一致返回 `INVOICE_REQUEST_STATE_CHANGED`。
- 金额（`BIGINT`）在 DTO 映射中转 `number`（整数台币在安全整数范围内）或字符串，禁止直接序列化 BigInt。

### 7.3 状态机与前置条件（服务端实现口径）

- **提交**：校验表单（1–5 行、正整数、统编 8 位）→ 复算 `salesAmount`/`taxAmount`/`totalAmount` → 四项比对（命中且未确认则 409 + 相似单列表）→ 同事务：派发编号 → 写单据（`PENDING_REVIEW`）→ 写明细行 → 写状态历史（`SUBMIT`）→ 写审计。
- **四项比对**：谓词 `buyerName = ? AND buyerTaxId = ? AND taxAmount = ? AND totalAmount = ?` 且 `status IN ('PENDING_REVIEW','NOTIFIED','ISSUED','SETTLED')`（不含 `RETURNED`/`CANCELLED`）；字面完全相等，不做归一化；`duplicateAcknowledged = true` 时跳过阻断。
- **重新提交**：仅本人、仅 `RETURNED`；先改明细行（父单仍为 `RETURNED`）、复算汇总、再翻状态为 `PENDING_REVIEW`，写历史（`RESUBMIT`）。
- **退回 / 取消**：写对应列 + 历史（`RETURN` / `CANCEL`，`reason` 必填）。
- **上传照片**：先 `media.prepare` → 同事务 `activate` + 写 `documentMediaAssetId`/`documentUploadedAt` + 状态转 `ISSUED` + 历史。
- **结算入账**：校验状态与 `documentUploadedAt + 120h <= now` → 事务内读当前汇率并冻结快照 → 计算成本 → 资金入账（第 8 节）→ 回写 `fundPostingBatchId`/`settleAmountCny`/`settledAt` → 状态转 `SETTLED` + 历史；任一失败整体回滚。
- **可结算时刻**由 `documentUploadedAt + 120h` 派生（不落列），列表与详情都用同一纯函数计算，前端展示与后端校验同源。

### 7.4 金额计算与精度

```
salesAmount = Σ(quantity × unitPrice)                  // 整数台币
taxAmount   = roundHalfUp(salesAmount × 5 / 100)       // 整数，四舍五入；销售额为 1 元时为 0
totalAmount = salesAmount + taxAmount                  // 取整后相加
settleAmountCny = ceil(totalAmount / foreignUnitsPerCny × 6 / 100 + 30)   // 整数人民币元
```

- 全部用整数运算（台币金额与百分比用整数分子/分母，避免浮点）：`taxAmount = Math.round(salesAmount * 5 / 100)` 可用整数形式 `floor((salesAmount * 5 + 50) / 100)`；汇率是 `DECIMAL(30,12)`，成本计算用十进制定点（Prisma `Decimal`）而非 `number`，向上取整用 `Decimal.ceil()`。
- `6%` 与 `30` 固化为具名常量（参照 `PAYMENT_FEE_RATE = '0.007'` 的做法），成本结果恒 ≥ 31 元，**永不为 0**，因此资金入账不需要「金额为 0 跳过」分支。
- 前端展示值与服务端重算值不一致（汇率变更）→ `INVOICE_REQUEST_RATE_CHANGED`，前端提示刷新重算。

### 7.5 幂等与并发

- 锁序：单据行 `SELECT ... FOR UPDATE`（按 id）→ 资金账户批量锁（`lockBusinessEventAccountsInTransaction`，统一排序防死锁）→ 读汇率 `FOR SHARE`。
- 汇率读取沿用既有域的「Currency → ExchangeRate」锁序（`slh-bill.service.ts:67-78`）。
- 并发冲突一律 `INVOICE_REQUEST_STATE_CHANGED`（409），前端提示刷新。

### 7.6 错误码

| 错误码 | HTTP | 触发 |
| --- | --- | --- |
| `INVOICE_REQUEST_NOT_FOUND` | 404 | 单不存在或不可见（运营访问他人单同样返回 404，避免存在性泄露） |
| `INVOICE_REQUEST_STATE_CHANGED` | 409 | 版本或前置条件在事务内变化 |
| `INVOICE_REQUEST_STATUS_NOT_ALLOWED` | 409 | 当前状态不允许该动作 |
| `INVOICE_REQUEST_OWNER_ONLY` | 403 | 非本人对本人限定动作（重提、运营取消） |
| `INVOICE_REQUEST_DUPLICATE_SUSPECTED` | 409 | 四项比对命中且未确认；响应携带相似单列表（单号/状态/提交日期） |
| `INVOICE_REQUEST_SETTLE_WAIT_PERIOD` | 422 | 距上传不足 120 小时 |
| `INVOICE_REQUEST_DOCUMENT_REQUIRED` | 422 | 未上传照片即尝试结算 |
| `INVOICE_REQUEST_DOCUMENT_EXISTS` | 409 | 重复上传（上传即定稿） |
| `INVOICE_REQUEST_RATE_UNAVAILABLE` | 422 | 台币汇率缺失或 ≤ 0 |
| `INVOICE_REQUEST_RATE_CHANGED` | 409 | 汇率在展示与提交之间变更 |
| `INVOICE_REQUEST_NUMBER_UNAVAILABLE` | 422 | 编号规则未启用或派发失败 |
| `INVOICE_REQUEST_FUND_POSTING_REJECTED` | 422 | 资金域拒绝（映射资金侧错误码，保留原码于 `fieldErrors`） |

DTO 级校验（统编格式、明细行数与正整数、原因非空、备注长度）走统一的 422 `VALIDATION_FAILED` + `fieldErrors`，不单列业务码。错误码必须登记进 controller 的 `errors: [{status, codes}]` 契约元数据（`assertErrorMetadata` 校验），并在前端建立 `code → i18n key` 映射表（三语）。

## 8. 资金入账接入

`INVOICE_FEE` 目前**没有任何来源绑定**，因此「接入既有类型」必须新建来源并绑定（先例：`SALES_RECEIPT` 复用 `ORDER_SETTLEMENT`、`PACKAGING_COST` 复用 `WOODEN_PACKING_COST`）。

**常量与代码登记（三处）**

| 位置 | 内容 |
| --- | --- |
| `invoice-request-fund.ts` | 资金常量改用 `fund-accounts/application/fund-invoice-request.ts`（与 `fund-bill-settlement.ts` 同一先例：常量放在资金模块内，避免资金域反向依赖业务域）；业务模块从这里导入 `INVOICE_REQUEST_FUND_SOURCE`、`INVOICE_REQUEST_SETTLE_CONSUMER`、`INVOICE_REQUEST_POSTING_TYPE`，摘要文案在业务侧声明 |
| `fund-posting.service.ts:115-126` | `CONTROLLED_POSTING_TYPE_BY_SOURCE_CONSUMER` 增加 `(INVOICE_REQUEST, INVOICE_REQUEST.SETTLE) → INVOICE_FEE` |
| `fund-posting.service.ts:499-522` | `normalizeBusinessContext` 准入白名单加入该来源与 consumer |
| `fund-posting.service.ts:1125-1158` | `prepareBusinessPlan` 语义守卫：分类为 `COST`、`requiresUser`、金额 > 0、两条 leg 均为 `DEBIT` |
| `fund-posting.service.ts:483` | 建议加入「拒绝独立事务入口」列表（强制走 `postBusinessEventInTransaction`） |

**迁移（顺序 4）**：`fund_business_sources` 插入 `INVOICE_REQUEST`（`enabled=true`）→ `fund_business_source_posting_types` 绑定 `INVOICE_FEE`（用 `SELECT ... WHERE code = ...` 而非硬编码 UUID，参照 PACKAGING 模板）→ `fund_posting_batches` 增加 per-source 形状 CHECK（`business_source_code_snapshot = 'INVOICE_REQUEST'` 时要求 `kind='BUSINESS'`、`actor_user_id/user_id/user_share_rate_snapshot` 非空、consumer 与类型/分类/金额符号严格配对，参照 SLH 模板）→ 末尾 `DO $$ ... RAISE EXCEPTION` 断言块校验类型、规则版本、来源、绑定精确成形。

**调用形状（在结算事务内）**

```ts
await lockBusinessEventAccountsInTransaction(tx, plan)
const preview = await previewBusinessEventInTransaction(tx, ctx, input)
await postBusinessEventInTransaction(tx, ctx, input, preview)
```

| 入参 | 值 |
| --- | --- |
| `context.sourceCode` / `consumerCode` / `requestId` / `actorUserId` | 受控身份与操作人 |
| `postingTypeCode` | `INVOICE_FEE`（必须与映射表解析结果逐字相等） |
| `userId` | **申请人（`createdById`）** |
| `amount` | `settleAmountCny`（2 位小数）（人民币） |
| `businessId` / `businessNo` | 单据 id / 申请单号 |
| `summary` | 摘要常量 |
| `idempotencyKey` | `${invoiceRequestId}:SETTLE` |
| `businessOccurredAt` | 结算时刻 |
| `metadata` | `invoiceRequestId/invoiceNo/totalTwd/taxAmountTwd/exchangeRateId/exchangeRateVersion/foreignUnitsPerCny/serviceFeeRate/mailingFeeCny`（扁平、仅标量） |

- 币种由资金域固定 `CNY`，入参不传。
- 失败即整体回滚（单据保持 `ISSUED`），映射为 `INVOICE_REQUEST_FUND_POSTING_REJECTED`。
- 查询侧无需新接口：资金流水列表已渲染 `batchNo / businessSourceName / businessNo / summary`；详情抽屉展示 `metadata`，可据此关联回单据。

## 9. 权限、审计与登记清单

### 9.1 权限

- 常量：`server/src/modules/access-control/permission.constants.ts` 新增 `INVOICE_REQUEST_PERMISSION_CODES`（按 code 排序）并展开进 `MANAGEMENT_PERMISSION_CODES`。
- 迁移 3：8 条权限（稳定 UUID `...171`–`...178`，`system_only = false` 以便委派给内置角色）+ 授予 `system_admin`（`id + code` 双重匹配）+ 自检 DO 块。
- 角色 seed：`operations_staff` 增加 `create/read/cancel`；`finance_staff` 增加 `read/read-all/review/return/cancel/document/settle`。

### 9.2 审计事件

`INVOICE_REQUEST_CREATED` / `_RESUBMITTED` / `_RETURNED` / `_NOTIFIED` / `_DOCUMENT_UPLOADED` / `_SETTLED` / `_CANCELLED`，追加在 `AuditEventType` 枚举末尾（顺序与 DB 一致），迁移 2 落库；写入统一走 `AuditService.record(tx, ...)` 与业务同事务；metadata 只放单号、状态、金额、汇率等标量。

### 9.3 会变红的清单（实现时必须同步）

| 类别 | 文件 |
| --- | --- |
| 权限常量与汇总 | `permission.constants.ts`、新写 `server/src/infrastructure/database/invoice-request-permission.spec.ts` |
| 权限副本 | `server/test/auth-schema.e2e-spec.ts`、`server/test/auth-api.e2e-spec.ts`（两份硬编码权限数组） |
| 角色权限计数 | `server/test/seed.e2e-spec.ts`（`finance_staff` 17 → 24、`operations_staff` 13 → 16） |
| 编号规则集合 | `server/test/seed.e2e-spec.ts` 的 `expectedRuleShapes`（19 → 20） |
| 枚举断言 | 新写 `server/test/invoice-request-schema.e2e-spec.ts`（状态/动作/审计事件前缀） |
| 契约三产物 | `server/openapi/openapi.json` → `web/openapi/openapi.json` → `types.gen.ts`（`node --run contract:sync` 后必须提交） |
| 迁移文档登记 | `docs/后端文档/数据库迁移规范.md` 第 2 节（5 条新迁移，CI 硬门禁） |
| 前端权限目录 | `web/apps/qsmds-arco/src/views/system/permissions/catalog.ts` 的 `RESOURCE_LABELS` + `test/views/system-management.test.ts:274-328` 精确集合 |
| 前端路由契约 | `test/api/role-workbench-routes.test.ts`（财务工作台叶子数 14 → 16）、`test/api/workbench-access-isolation.test.ts`（三角色权限副本、URL 准入清单、`routes.ts` 源码正则） |
| 图标清单 | 跑 `node web/scripts/generate-icon-inventory.mjs` 刷新 `project-icon-inventory.generated.json` |
| 媒体 | `media-object-key.spec.ts`、`media-key-migration.service.spec.ts` 的 `RULE_SAMPLES`、`media-reference.contract.spec.ts`（待核对） |
| 资金 | 仿 `server/test/packaging-cost-fund-source-migration.e2e-spec.ts` 新写迁移 e2e；`fund-posting.service.spec.ts` 补来源准入/越权用例 |

## 10. 前端设计

### 10.1 路由与菜单

- 运营：`router/modules/operations.workbench.ts` 新增分组「发票管理」（第 4 组，中文字面量 title），两个正式菜单项：`开票申请`（`/qs-operations/invoices/create`，业务码 `:create`）与 `开票记录`（`/qs-operations/invoices/records`，业务码 `:read`）；重填复用开票申请路由（带单据 id 的查询参数），不再单开路由。
- 财务：`router/modules/role.workbenches.ts` 的 `financeWorkbench` 新增分组「发票管理」（i18n key `workbench.invoiceApproval`），菜单项 `开票审批`（`/qs-finance/invoices/approval`，业务码 `:review`）+ 一个 `menu: false` 的隐藏详情路由。
- 分组门槛用工作台准入码（组级 `auth` 会覆盖一级子路由声明，业务码放在叶子）。

### 10.2 页面落点

| 文件 | 职责 |
| --- | --- |
| `views/workbenches/invoices/records/create.vue` | 开票申请表单（新建与重填共用，`route.query.id` 决定形态） |
| `views/workbenches/invoices/records/index.vue` | 开票记录（本人、六态筛选、已退回显著计数、照片入口） |
| `views/workbenches/invoices/records/detail-drawer.vue` | 只读详情（明细、寄送、照片、状态历史） |
| `views/workbenches/invoices/approval/index.vue` | 开票审批（六态筛选 + 按状态给动作） |
| `views/workbenches/invoices/approval/{review,return,upload-document,settle,cancel}-modal.vue` | 五个动作弹窗 |
| `views/workbenches/invoices/invoice-form.logic.ts` | 纯函数：汇总计算、行校验、比对键 |
| `views/workbenches/invoices/invoice-status.logic.ts` | 状态 → 标签色/文案映射（单一映射点）+ 可结算时刻与剩余时间 |
| `views/workbenches/invoices/invoice-failure.logic.ts` | 错误码 → i18n key 映射（沿用 `settle-modal.logic.ts` 范式） |
| `locales/lang/invoice-requests/{zh-cn,zh-tw,en}.json` | 页面文案三语 |

### 10.3 关键交互实现口径

- **表单离开确认**：照搬采购订单创建页范式——`onBeforeRouteLeave` 返回 Promise + `QsGenericModal`（继续编辑 / 确认放弃）、`onBeforeRouteUpdate` 覆盖参数切换、`beforeunload` 覆盖刷新关标签、提交中硬阻止、`onBeforeUnmount` 兜底 resolve、身份变化强制跳回列表；**仅在脏状态时触发**，提交成功后立即清脏。
- **汇总区**：全部只读，由 `invoice-form.logic.ts` 的纯函数计算，与后端同一算法（同源常量）。
- **复制开票信息**：纯函数 `buildInvoiceCopyText()`，复制文本与弹窗展示同源、缺值留空、资料不齐不触发（参照 `shipping-info.logic.ts:74-140`）。
- **上传弹窗**：先本地校验格式与体积（不支持的格式直接提示），再二次确认「清晰完整、上传后不可替换」；并排展示系统总计。
- **结算弹窗**：展示算式全貌与可结算时间；未满 120 小时禁用并倒计时；提交中锁；失败按错误码映射文案。
- **四项比对弹窗**：接收 409 响应体的相似单列表渲染，确认后带 `duplicateAcknowledged: true` 重发。

### 10.4 复用组件

`FaPageMain`、`QsGenericTable`（移动端卡片用 `#actions` 插槽）、`QsStatusSwitchToolbar`（六态 + 计数）、`QsGenericModal`、`FaTag variant="outline" class="qs-type-status-tag"`、`QsPersonDisplay`、`DateTimeDisplay`、`AmountDisplay`。

## 11. 测试策略

| 层 | 场景 |
| --- | --- |
| 纯逻辑单测 | 汇总与营业税（含 0.05 取整边界：销售额 1 元 → 税 0）、成本取整（示例 283500/5.2 → 3302）、可结算时刻（恰好 120 小时）、状态派生与可编辑判定、比对键构造 |
| Schema e2e | 迁移重放、枚举清单、触发器正反例：终态 UPDATE 被拒、`NOTIFIED/ISSUED` 业务字段不可改、`RETURNED` 可改、明细行仅在父单 `RETURNED` 可变、行内勾稽 CHECK、编号身份校验、历史表不可变 |
| Service 测试 | 每个动作的状态前置、乐观锁、四项比对（含池边界：已取消/已退回不算命中）、幂等重放、金额为 0 不出现 |
| 资金 | 迁移 e2e（仿 packaging-cost 范式：只 INSERT 两表 + 断言块）、来源准入与越权、平台账户分流与尾差、失败回滚后单据仍为 `ISSUED` |
| 契约 | operationId 唯一且不改名既有、`status-counts` 在 `:id` 之前、错误码登记、`contract:sync` 零 diff |
| 前端 | `role-workbench-routes` 形状、三语 locale 键存在、表单纯函数、错误码映射 |
| 浏览器实测 | 全链路（提交 → 审核并通知 → 复制 → 退回 → 重填 → 通知 → 上传 → 等待 → 结算），含运营可见范围隔离与财务全量视图、离开确认四类出口 |

## 12. 明确不实施

不记录发票字号（不做 OCR）；不打印、不导出；不做草稿保存；不做行级备注；不做与业务单据的结构化关联；不支持票面零税率 / 免税；不做站内通知；不实现「从已取消单复制新建」的预填（列为后续可选优化）；不新增外币账户或改变资金域币种口径。

## 13. 设计决策与实现阶段核对项

### 13.1 已确认的设计决策（2026-10-14）

| # | 决策 | 结论 |
| --- | --- | --- |
| 1 | 新增第 8 个权限码 `invoice-requests:read-all` | 已认可（「跨提交人读」需要一个权限点，否则只能按角色名硬编码） |
| 2 | 字段长度上限 | 确认：抬头 200 / 品名 200 / 备注 500；寄送三项（姓名、电话、地址）用 `TEXT`，不设业务上限 |
| 3 | 明细行「仅父单 `RETURNED` 时可变」的触发器口径 | 已认可（重填为原地改行，不做行版本化） |
| 4 | 汇总勾稽 | 确认：汇总金额落列 + 服务端同事务复算，**不写跨表 DB 触发器**，由 e2e 断言兜底 |
| 5 | 相似单列表位置 | 确认：放在 409 响应体，沿用 `duplicateAcknowledged` 范式，不单开查询端点 |

### 13.2 实现阶段核对项（非决策，按对应任务核对即可）

| # | 事项 | 核对时机 |
| --- | --- | --- |
| 6 | 单列式引用 `documentMediaAssetId` 是否需进入 `MEDIA_ASSET_REFERENCE_TABLES` 与 `media-reference.contract.spec.ts` 的断言集合 | **已核对：需要并已登记**（`invoice_requests` 进入引用表与就绪校验闭包，契约 spec 的模式匹配与 SQL 断言同步扩展） |
| 7 | 编号 consumer `INVOICE_REQUEST.CREATE` 与资金 consumer `INVOICE_REQUEST.SETTLE` 同名不同命名空间，两处常量各自独立声明 | T3 / T5 |
