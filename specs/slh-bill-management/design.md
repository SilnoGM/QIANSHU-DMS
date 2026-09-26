# 顺联航账单管理 技术设计

## 1. 文档状态

- 状态：已确认
- 确认日期：2026-09-26
- 目标模块：`server/src/modules/slh-bills/`
- 目标前端：`web/apps/qsmds-arco/src/views/workbenches/slh-bills/`

## 2. 设计原则与真相源

| 能力 | 真相源 |
| --- | --- |
| 账单结构与金额 | 顺联航提供的 Excel 原件（`media_assets` 中留痕，SHA256 校验） |
| 账单编号 | `numbering_rules` / `numbering_issuances`，规则 `CTN_BILL_NO` |
| 账单汇率 | 账单内嵌除数，或 `exchange_rates.foreign_units_per_cny` 的冻结快照 |
| 材积与计价 | 本模块解析器按账单口径复算（`÷28316 × 箱数`） |
| 费别字典 | `slh_bill_charge_type` 枚举 |
| 权限 | `permissions` 目录 + `PermissionGuard` 运行时查库 |
| HTTP 契约 | Controller / DTO / OpenAPI decorators |
| Web DTO | Web OpenAPI snapshot 生成类型 |

## 3. 数据模型

### 3.1 `slh_bills`（账单头）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `slh_bill_no` | `VARCHAR(64)` UNIQUE | 由 `CTN_BILL_NO` 派发，形态 `CBILL/YYYYMM-NN` |
| `numbering_issuance_id` | `UUID` UNIQUE | 指向派发台账，受编号身份触发器约束 |
| `period_start` / `period_end` | `DATE` | 明细装柜日期的最小值/最大值 |
| `source_file_id` | `UUID` | 指向 `media_assets`，用途 `SLH_BILL_SOURCE_XLSX` |
| `source_file_name` | `VARCHAR(255)` | 原始文件名 |
| `source_file_sha256` | `CHAR(64)` | 原件摘要，用于重复导入检测 |
| `freight_total_amount_cny` 等 4 项 | `DECIMAL(30,2)` | 运费/代收手续费/附加费/合计应付，自算 |
| `cod_total_amount_twd` / `ntd_surcharge_total_amount_twd` | `DECIMAL(30,2)` | 代收货款与 NTD 杂费合计 |
| `reported_net_amount_twd` | `DECIMAL(30,2)` | 「合计应付台币NTD」不折算值 = 代收货款 − NTD 杂费 |
| `rate_source` | `slh_bill_rate_source?` | `EMBEDDED` / `SYSTEM` / `MANUAL` |
| `foreign_units_per_cny_snapshot` | `DECIMAL(30,12)?` | 权威汇率值，非空即 `> 0` |
| `embedded_foreign_units_per_cny` | `DECIMAL(30,12)?` | 仅 `EMBEDDED` 有值，取自账单公式除数 |
| `exchange_rate_id` / `exchange_rate_version_snapshot` / `rate_captured_at` | | 仅 `SYSTEM` 有值 |
| `line_count` / `container_batch_count` | `INTEGER` | 明细行数与去重柜号数 |
| `container_batch_names` | `VARCHAR(2000)` | 期间内柜号集合，用于重复导入检测 |
| `superseded_by_id` / `superseded_at` | | 修订版替代 |
| `version` / `created_by_id` / `updated_by_id` | | 乐观锁与审计 |
| `import_request_key_hash` / `import_payload_hash` | `BYTEA(32)` | 幂等 |

### 3.2 `slh_bill_lines`（账单明细）

原样字段：`line_number`、`loading_date`、`container_batch_name_text`、`container_batch_id?`、`warehouse_receipt_reference VARCHAR(1000)`、`shipping_mark_text VARCHAR(500)`、`goods_name`、`package_count`、`package_unit`、`gross_weight_kg DECIMAL(18,3)`、`weight_unit`、`length_cm`/`width_cm`/`height_cm DECIMAL(18,2)`、`recipient_info_raw VARCHAR(2000)`、`remark VARCHAR(2000)`。

计算字段：`volume_cai DECIMAL(24,2)`（按 R2 规则记录）、`reported_volume_cai DECIMAL(24,2)`（账单原值）、`category_code VARCHAR(32)`、`unit_price_amount DECIMAL(30,2)`、`pricing_basis`、`freight_amount_cny`、`cod_handling_amount_cny`、`surcharge_amount_cny`、`payable_amount_cny`、`cod_amount_twd`、`ntd_surcharge_amount_twd`（均 `DECIMAL(30,2)`）。

留痕字段：`source_sheet_name`、`source_row_number`、`source_data JSONB`。唯一约束 `(bill_id, line_number)`。

尺寸精度取 `DECIMAL(18,2)`：两份样本的尺寸全为整数；解析时若出现超过 2 位小数的尺寸，按差异告警呈现而不静默截断（材积复算依赖尺寸精度）。

### 3.3 `slh_bill_line_charges`（费用明细）

`line_id`、`charge_type`（`slh_bill_charge_type`）、`currency_code CHAR(3)`、`amount DECIMAL(30,2)`、`pricing_basis`（可空）、`source_remark_text VARCHAR(2000)`。

拆解规则按币种分列：RMB 附加费列与 NTD 杂费列分别解析，未识别内容落 `OTHER` 并保留原文。完整性约束由服务层校验：同一行同一币种的费用明细合计必须等于对应聚合列。

## 4. 枚举

- `slh_bill_charge_type`：`FREIGHT`、`COD_HANDLING`、`HEAVY_CARGO`、`DELIVERY`、`REDELIVERY`、`TRANSFER_DELIVERY`、`REMOTE_AREA`、`UNLOADING`、`STORAGE`、`WAITING`、`OVERSIZE`、`INSPECTION`、`FORKLIFT`、`MINIMUM_CHARGE`、`OTHER`
- `slh_bill_pricing_basis`：`WEIGHT`、`VOLUME`
- `slh_bill_rate_source`：`EMBEDDED`、`SYSTEM`、`MANUAL`

枚举名带业务语义、不带域前缀（沿用 `purchase_order_status` 一类命名），但保留 `slh` 前缀以区分未来的其他货代账单。

## 5. 导入管线

复用既有 OOXML 能力，不引入第三方 Excel 依赖：

| 环节 | 复用/新增 |
| --- | --- |
| 解压与 CRC32 | 复用 `container-batches/import-parser.workbook.ts` |
| OOXML 子集解析 | 复用 `container-batches/import-parser.xml.ts` |
| 安全公式求值与单元格取数 | 复用 `container-batches/import-parser.numbers.ts` |
| 多段上传 | 复用 `sales-orders/documents/sales-order-document-multipart.parser.ts` |
| 原件激活与校验 | 仿 `media/ocean-freight-source-file.service.ts`，用途改为 `SLH_BILL_SOURCE_XLSX` |
| 账单专用解析 | 新增 `slh-bill-parser.ts`（表头定位、列别名、行解析、合计行识别） |
| 材积与勾稽复算 | 新增 `slh-bill-calculator.ts`（纯函数） |
| 费别拆解 | 新增 `slh-bill-charge-parser.ts`（纯函数） |

解析取单元格**缓存值**并自行复算比对，不解析共享公式的 `ref` 范围继承。

## 6. 编号与汇率

- 编号：`generateScopedInTransaction(tx, { ruleCode: 'CTN_BILL_NO', consumerCode: 'SLH_BILL.CREATE', ... })`。实测该规则片段为 `FIXED CBILL` + `SEPARATOR /` + `DATE YYYYMM` + `SEPARATOR -` + `SEQUENCE(width 2, start 1, step 1)`，时区 `Asia/Shanghai`。**三个时间维度相互独立**：编号里的 `YYYYMM` 取**派发月**，流水周期取规则的 `resetPolicy`（实测为 `YEARLY`，因此流水按年累计），账单期间由 `period_start` / `period_end` 表达。序号宽度 2 位意味着**年内上限 99 张**，超限由编号引擎报错。
- 汇率：`EMBEDDED` 取账单公式除数；`SYSTEM` 在事务内按 `sales-receipt.service.ts` 的既有权重顺序读取（`FOR SHARE`，校验 `enabled` 且比例大于 0）并冻结 `exchange_rate_id` / `version` / `captured_at`；`MANUAL` 由用户手填，只冻结比例值与捕获时间。
- 汇率来源互斥形状由 CHECK 约束保证；无台币金额的账单四列全空。

## 7. 数据库约束

- 编号身份触发器 `enforce_slh_bill_numbering_identity`：插入/更新时校验编号、派发记录、消费域、规则与 `purpose = 'BUSINESS'` 一致。
- 来源文件就绪：为 `slh_bills.source_file_id` 增加 `enforce_ready_media_asset_reference` 分支（`DOCUMENT` + `SLH_BILL_SOURCE_XLSX` + xlsx MIME + SHA256 合法 + 大小上限 50 MiB）。
- `media_assets_upload_purpose_check` 白名单加入 `SLH_BILL_SOURCE_XLSX`。
- 汇率来源互斥 CHECK 与金额勾稽 CHECK。
- 明细与费用明细不可改不可删；账单头只能被取代一次，不能被改写。
- 媒体引用仓储 `MEDIA_ASSET_REFERENCE_TABLES` 同步加入 `slh_bills`：账单原件是外部凭证的唯一留痕，不能进入媒体回收路径。
- 审计事件 `SLH_BILL_IMPORTED`：外部凭证入库是需要留痕的资金相关动作。

迁移分为三条，顺序为 `slh_bill_management` → `slh_bill_reported_amounts` → `slh_bill_audit_event`；后者依赖前者已建的表与枚举。

## 8. 运维前置条件

无内嵌汇率的账单需要新台币已启用且已配置当前汇率（`/system/basic-data/currencies?tab=exchange-rates`）。该状态由管理员在页面维护，**不得写入迁移或种子断言**：空库部署时新台币必然处于停用状态，断言会破坏空库双次部署验证。

## 9. 前端

- 列表页替换现有占位组件，模式为 `FaPageHeader + FaPageMain + QsGenericTable`。
- 解析预览为独立子路由，三段式：上传 → 解析 → 预览确认。
- 详情为独立页面（明细 22 列，抽屉不适合），行点击进入。
- 汇率显示两位小数，仅格式化不回写（与既有 `display.logic.ts` 约定一致）。
