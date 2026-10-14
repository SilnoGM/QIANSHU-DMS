# 开票申请与审批 实施任务

## 1. 状态与基线

- 需求：[requirements.md](requirements.md) 已定稿（2026-10-14，无未决项）。
- 设计：[design.md](design.md) 已定稿（设计决策 13.1 全部确认）。
- 本清单是实施入口：任务按 T1–T10 顺序执行，每个任务以「可验证的完整逻辑变更」为单位小步提交（type 英文 + 描述中文）。
- 基线：`main` @ `88c813dc`；工作区仅新增 `specs/invoice-requests/`（另有一个未跟踪的 `.zcodeignore`，不属于本任务，不动）。
- 门禁命令：

| 用途 | 命令 |
| --- | --- |
| 服务端 | `pnpm -C server check`（prisma:validate + 漂移门禁 + typecheck + lint + test） |
| 契约 | `node --run contract:sync` / `node --run contract:check` |
| 根治理 | `node --run test:root` |
| 前端 | `pnpm -C web check`（含 `api:generate` 前置） |
| 服务端 e2e | `node --run ci:server-e2e` |

## 2. 已批准的实施对象与边界

已获授权的对象（范围以此为准，不扩张）：

1. `server/prisma/schema.prisma`：新增 3 个 model（`InvoiceRequest` / `InvoiceRequestLine` / `InvoiceRequestStatusHistory`）与 2 个 enum（`InvoiceRequestStatus` / `InvoiceRequestAction`）。
2. 5 条新迁移（design 第 4 节）：业务域、审计事件、权限、资金来源、媒体用途；其中两条修改既有对象——`audit_event_type` 加 7 个枚举值、`media_assets.upload_purpose` 的 CHECK 重建（带全量既有值）。
3. 10 个新 API 与契约三产物（design 7.2）。
4. 8 个新权限点（含 `invoice-requests:read-all`）与 `operations_staff` / `finance_staff` 种子角色调整。
5. 前端：两个工作台各新增「发票管理」分组、4 个页面、三语文案、图标资产。

仍不在授权内、需单独提出的事项：删除任何既有文件或公共 operationId；改写已提交迁移；新增或移除依赖；push / PR / Tag / 发布。

## 3. 依赖与执行约定

- 无新增依赖（全部复用既有资金域、媒体域、编号域、契约与组件能力）。
- 行为变更按 TDD：先建立有意义的失败测试，再最小实现；每个任务先跑对应 spec 看红再实现。
- 已提交迁移不可修改/重命名/重排；出问题用向前修复。
- dev 库操作：`migrate deploy` 应用迁移、`seed:run` 幂等补编号规则；禁止 `db push`。
- 提交前检查暂存范围：排除 `.env`、生成目录、构建产物、`.zcodeignore`。

## 4. 实施任务

### T1 — 数据层：schema 与 5 条迁移

- 交付：`schema.prisma` 三个 model + 两个 enum（字段与约束按 design 3.1–3.5）；迁移 1–5 按 design 第 4 节顺序与命名。
- 先失败：新写 `server/test/invoice-request-schema.e2e-spec.ts`，覆盖——状态/动作枚举清单；触发器正反例（终态 UPDATE 被拒、`NOTIFIED`/`ISSUED` 下业务字段不可改、`RETURNED` 下可改、明细行仅在父单 `RETURNED` 可变、状态历史不可变、编号身份校验）；行内勾稽 `amount = quantity × unit_price`；状态形状 CHECK；`(createdById, requestKeyHash)` 唯一。
- 迁移 1 必须含 `BEGIN/COMMIT`、中文头注释、`SET LOCAL lock_timeout`、末尾 `DO $$` 自检（参照 `20261011150000_slh_reconciliation_settlements`）。
- 验证：空库两次 `db:migrate:deploy` + `migrate status` + `_prisma_migrations` 每目录恰一行且 `finished_at` 非空；`pnpm -C server check` 的漂移门禁为 `No difference detected`。
- 同步：`docs/后端文档/数据库迁移规范.md` 第 2 节登记 5 条迁移（CI 硬门禁）；跑 `node --run test:root`。

### T2 — 权限与审计登记

- 交付：`permission.constants.ts` 新增 `INVOICE_REQUEST_PERMISSION_CODES` 并展开进 `MANAGEMENT_PERMISSION_CODES`；权限迁移（稳定 UUID `...171`–`...178`，`system_only = false`，授予 `system_admin` 用 `id + code` 双重匹配 + 自检 DO 块）；`AuditEventType` 末尾追加 7 个事件 + 迁移 2。
- 先失败：新写 `server/src/infrastructure/database/invoice-request-permission.spec.ts`（域常量精确值、汇总无重复、迁移 SQL 逐字段正则与自检文案、禁 `ON CONFLICT DO NOTHING`）。
- 同步会红清单：`server/test/auth-schema.e2e-spec.ts` 与 `auth-api.e2e-spec.ts` 的权限副本；`server/test/seed.e2e-spec.ts` 角色计数（`finance_staff` 17 → 24、`operations_staff` 13 → 16）；前端 `views/system/permissions/catalog.ts` 的 `RESOURCE_LABELS` + `test/views/system-management.test.ts` 的精确集合。
- 验证：`pnpm -C server check`；前端 `pnpm -C web check`。

### T3 — 编号与种子角色

- 交付：`seed.dataset.ts` 的 `SEED_NUMBERING_RULES` 追加 `INVOICE_REQUEST`（前缀 `INV`，形状 `INV/YYYYMMDD-SEQ(4)`，`purpose = BUSINESS`）；`SEED_ROLES` 补角色权限（运营 `create/read/cancel`，财务 `read/read-all/review/return/cancel/document/settle`）。
- 先失败：更新 `server/test/seed.e2e-spec.ts` 的 `expectedRuleShapes`（19 → 20 条）、角色权限计数断言，跑出红后再改 seed。
- 验证：`pnpm -C server seed:run` 连续两次（幂等）；`node --run test:root`。
- 核对项 #7：编号 consumer 常量与资金 consumer 各自独立声明。

### T4 — 服务端模块：读写接口与状态机

- 交付：`server/src/modules/invoice-requests/` 全部文件（模块边界见 design 7.1）；10 个接口（design 7.2）；错误码（design 7.6）并登记进 controller 的 `errors` 契约元数据。
- 先失败：
  - `invoice-request.logic.spec.ts` 纯函数——营业税取整（销售额 1 元 → 税 0）、成本取整（283500 / 5.2 → 3302）、可结算时刻（恰好 120 小时）、比对键构造；
  - service spec——每个动作的状态前置、乐观锁冲突、四项比对的池边界（已取消/已退回不算命中；确认后可提交）、提交幂等重放、归属校验（非本人 403 / 他人单 404）。
- 注意：`status-counts` 必须注册在 `:id` 之前；金额 `BIGINT` 不得直接序列化。
- 验证：`pnpm -C server check`；接口层 e2e 覆盖 DTO 校验（漏装饰器必然 422）。

### T5 — 资金入账接入

- 交付：`invoice-request-fund.ts` 常量与适配；`fund-posting.service.ts` 四处登记（映射表 115–126、准入白名单 499–522、语义守卫 1125–1158、建议加入拒绝列表 483）；迁移 4（source `INVOICE_REQUEST` + 绑定 `INVOICE_FEE` + per-source 形状 CHECK + 断言块）。
- 先失败：仿 `server/test/packaging-cost-fund-source-migration.e2e-spec.ts` 新写迁移 e2e（只 INSERT 两张表、无 UPDATE/DELETE/ALTER、含断言块）；`fund-posting.service.spec.ts` 补来源准入与越权用例。
- 端到端断言：结算失败 → 单据仍为 `ISSUED`、无资金流水；成功 → 批次 `businessNo` = 申请单号、按申请人分成比例拆分用户/公司两条分录、`fundPostingBatchId` 回写。
- 验证：`pnpm -C server check`；`node --run ci:server-e2e`。

### T6 — 媒体上传

- 交付：`MEDIA_STORAGE_POOLS` 加 `invoice`；`UPLOAD_PURPOSE_POOLS` 加 `INVOICE_REQUEST_DOCUMENT`；迁移 5 重建 `upload_purpose` CHECK（带全部既有五个值）；`invoice-request-multipart.parser.ts`（`mediaType` 必须在 `file` 之前，`files: 1 / fields: 2`）。
- 同步会红清单：`media-object-key.spec.ts`（池清单断言，`invoices` 反例保留 + 新增 `invoice` 正例）、`media-key-migration.service.spec.ts` 的 `RULE_SAMPLES`。
- 核对项 #6：单列式 `documentMediaAssetId` 是否需进 `MEDIA_ASSET_REFERENCE_TABLES` 与 `media-reference.contract.spec.ts`。
- 验证：图片格式/体积越界用例；上传后 `documentMediaAssetId` 与状态推进在同一事务。

### T7 — 契约同步与错误码

- 交付：`node --run contract:sync` 生成并提交三产物（`server/openapi/openapi.json`、`web/openapi/openapi.json`、`types.gen.ts`）。
- 验证：`node --run contract:check` 零 diff；operationId 唯一、未改名既有；`RETIRED_OPERATION_IDS` 无命中；前端可手写 `api/modules/invoice-requests.ts` 并跑其请求契约测试（URL、幂等头、FormData 字段顺序）。

### T8 — 前端：路由、菜单、文案、图标

- 交付：运营 `operations.workbench.ts` 新增「发票管理」分组（开票申请 `:create`、开票记录 `:read`）；财务 `role.workbenches.ts` 新增分组（开票审批 `:review` + `menu: false` 隐藏详情）；三语 locale（`lang/invoice-requests/*` + `lang/workbench/*` 菜单键）；图标资产 + `node web/scripts/generate-icon-inventory.mjs`。
- 同步会红清单：`test/api/role-workbench-routes.test.ts`（财务工作台叶子数 14 → 16）、`test/api/workbench-access-isolation.test.ts`（三角色权限副本、URL 准入白/黑名单、`routes.ts` 正则）。
- 验证：`pnpm -C web check`。

### T9 — 前端：页面与弹窗

- 交付：开票申请表单（离开确认四类出口、汇总只读、提交二次确认、重填回填 + 退回原因展示）、开票记录（本人六态筛选 + 已退回显著计数、详情抽屉、重新填写入口）、开票审批（五个动作弹窗、可结算倒计时、复制开票信息、照片上传二次确认）、`invoice-*.logic.ts` 纯函数与错误码映射。
- 先失败：表单纯函数单测（汇总、行校验、比对键）；locale 三语键存在性断言。
- 交互口径：复制文本与弹窗展示同源、缺值留空、资料不齐不触发；上传前本地校验格式体积；提交成功后立即清脏标记。
- 验证：`pnpm -C web check`。

### T10 — 全量门禁与跨域验收

- 执行：`pnpm -C server check`、`pnpm -C web check`、`node --run contract:check`、`node --run test:root`、`node --run ci:server-e2e`。
- 浏览器实测（dev 环境，`http://127.0.0.1:9000`）：提交 → 审核并通知（含复制）→ 退回 → 重填 → 通知 → 上传照片 → 等待窗 → 结算入账；运营可见范围隔离（他人单不可见、URL 直连 404）；四项比对弹窗（含确认后可提交）；离开确认四类出口。
- 结果写入 `## 5. 证据记录`；未通过的项如实列出，不得以失败结果作为交付依据。

## 5. 证据记录

### T1 数据层（已提交 `ac32e6d0`）

- 空库（隔离容器）首次与二次 `migrate deploy` 均成功；`migrate status` 为最新；`prisma migrate diff` 比对为 `No difference detected`。
- 新增 `server/test/invoice-request-schema.e2e-spec.ts`：4/4 通过（枚举清单、状态机与列白名单正反例、明细行可编辑性、状态历史不可变、编号身份、媒体就绪引用）。
  - **测试发现的真实缺陷**：结算列的成对形状 CHECK 最初写成单向约束，「SETTLED 但缺入账列」能通过；已在提交前改为双向。
- 五条迁移已应用 dev 库并登记进《数据库迁移规范》；`node --run test:root` 710/710。
- `pnpm -C server check` 全绿（含同步更新的媒体引用契约与字典基线断言）。

### T2 权限与审计 / T3 编号 / T6 媒体登记（已提交 `84c79558`）

- `invoice-request-permission.spec.ts` 2/2；权限副本、角色计数（17→24 / 13→16）、编号集合（19→20）与前端资源标签同步。
- 隔离库定点复验：`invoice-request-schema`、`seed`、`region-seed`、`shipping-mark-bindings` 共 16/16 通过。
- 官方隔离库全量 e2e 一次运行：89 套件中 2 个失败（`shipping-mark-bindings` 登录返回 404）；该套件单跑 5/5 通过，属仓库已记录的偶发 404（形态一致：期望 2xx 得到 404、单跑必绿），与本批改动无关。

### T4 服务端模块 / T5 资金接入（已提交 `d019e307`）

- `invoice-request.logic.spec.ts` 4/4（税率取整边界、成本公式与向上取整、120 小时整点边界、明细合计）。
- `pnpm -C server check` 345 套件 / 3951 用例全绿（含 lint 与 typecheck）。
- 资金侧四处代码登记已落地：受控映射表、准入白名单、结算语义守卫（COST/requiresUser/DEBIT/金额 > 0）、独立事务入口拒绝列表。
- **尚未执行**：资金迁移 e2e（仿 `packaging-cost-fund-source-migration.e2e-spec.ts`）与服务层用例（状态前置、乐观锁、四项比对池边界、幂等重放、结算失败回滚）。这两项是 T10 之前的补齐项。

### 与设计的偏差（实现阶段调整，需回写设计）

1. **上传不带 `expectedVersion`**：发票照片上传复用订单凭证的 multipart 解析器（字段 `mediaType` + `file`），并发保护由「状态必须是已通知开票」+ `document_media_asset_id` 唯一 + 触发器只放行 `NOTIFIED → ISSUED` 三次兜底，客户端版本号在此动作上是冗余的。
2. **资金常量位置**：改为 `fund-accounts/application/fund-invoice-request.ts`（与 `fund-bill-settlement.ts` 同一先例），避免资金域反向依赖业务域；业务模块从这里导入。
3. **提交幂等语义**：`request_key_hash` 存**幂等键**的 SHA-256；同一个键重放直接恢复原单，不做载荷比对（同一键换内容按重放处理）。载荷指纹只用于编号派发的 `requestFingerprint`。

### 待完成

- T7 契约同步（`node --run contract:sync` 三产物）与前端审计事件标签（后者的类型依赖前者生成的 eventType 联合）。
- T8/T9 前端：两个工作台的「发票管理」分组、四个页面与三语文案、图标资产、路由契约测试。
- T10 全量门禁（`test:root`、前端 `check`、`ci:server-e2e`）与浏览器实测验收。

## 6. 业务启用边界

- 编号规则 `INVOICE_REQUEST` 必须先由 seed 或管理页建好并启用，否则提交必失败（`INVOICE_REQUEST_NUMBER_UNAVAILABLE`）。
- 资金入账依赖台币汇率存在且 > 0；缺失时结算入账失败关闭。
- 历史数据无迁移需求（全新域，无存量发票单据）。
- 已结算入账后的金额纠错不在本域：走资金域整批冲账 + 管理员手动调账。
