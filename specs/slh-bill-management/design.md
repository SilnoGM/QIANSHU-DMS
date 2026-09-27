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

尺寸精度取 `DECIMAL(18,2)`：两份样本的尺寸全为整数；解析时若出现超过 2 位小数的尺寸，按差异告警呈现而不静默截断（材积复算依赖尺寸精度）。**展示层按整厘米读**：整数尺寸不带 `.00`（`240×164×108 CM`），真有小数的原样保留、不四舍五入；该列保持**右对齐**并补 `CM`，乘号两侧不留空格（2026-09-27 用户确认，commit `4ad4a57f`）。

**收货人信息拆分（2026-09-27 落地，commit `aeac3d74`/`4db4af84`）**：`recipient_info_raw` 是一行无分隔符的混排文本，按确认后的规则拆成三列 `recipient_name VARCHAR(200)`、`recipient_phones VARCHAR(500)`、`recipient_address VARCHAR(1000)`（原文继续完整保留，这三列只是派生视图）。规则要点：

- **字段顺序恒为「地址 → 电话 → 姓名」**（两份样本 53/53 行成立），电话是唯一有硬格式约束的字段，因此**先定电话集合，再用它的两端切分地址与姓名**：第一个号码起点 = 地址右界，最后一个号码终点 = 姓名左界。
- **号码归一化到国家有效号码（NSI）后再校验**：去符号 → 国际写法（`+`、`00`、`002`–`009`/`019`）去冠码与 `886` → **去前导 0（本地与国际两条分支都要做）**；合法形态只有两种：手机 `^9\d{8}$`（样本里的裸 9 位写法即省略前导 0 的手机）、市话 `^[2-8]\d{6,8}$`（`07-7315249`、`08-7327241`、省区号的 `34963090`）。
- **门牌与电话同形的区分**：片段**紧跟** `號号樓楼層层巷弄鄰邻段米附之村里鎮镇鄉乡區区市縣县路街` 之一 → 判为地址（`37-22號`、`1666-1號`、`130之181號`、`4鄰45-2號`、`1.5km`）；`號` 只说明它前面的数字是门牌，**不代表后面还有地址**（早期实现把 `37-22號915931879` 的手机吞进地址，53 行里错 30 行）。
- **多号码**：组内按 `/／、，,` 分隔，**每个号码都要独立合法**（`0933-409583/0926-343555` 不能整串一起判），整段按**原文**存入 `recipient_phones`（含原分隔符与括号），不合并、不丢弃。
- **国际写法允许空格分组**（`+886 933 409583`），实现上从 `+`/`00` 起按原文字符整段摄取，不能依赖号码片段扫描（中间的 `933` 只有 3 位）；括号区号 `(07)7315249` 由片段正则的前缀分支整体吃进，**不要用"替换括号再扫描"**（会改变长度、取原文区间错位）。
- **无任何数字的行**（样本 25 行「林口仓库」）按用户口径：地址写该文本（按 NFKC 与"整串恰好重复两遍"折叠），姓名与电话留空。
- **判不了就留空、不猜**：有数字但无合法号码时整串留在地址列、姓名与电话为空，由上层标记待确认（呈现方式：预览页标黄 + 计数，不阻断入库）。

**测试夹具**：`server/test/fixtures/slh-bill-recipient.fixture.ts` 按"先解析真实行确定字段边界 → 同形替换（地名换「範例」、号码只保留决定形态的前三位其余置 0、姓名换合成名）→ 重新解析并比对结构"生成，78 行全部结构一致；另有一组**需求驱动**用例（国际写法、括号区号、>2 号码、英文名/称谓），属于规格而非样本事实。

**存量回填（2026-09-27 已通）**：`slh_bill_lines` 原本有 `BEFORE UPDATE OR DELETE` 触发器（`enforce_slh_bill_evidence_immutable`）无条件拒绝任何 UPDATE，导致三列只对新导入生效、存量回填被拒。经用户确认，迁移 `20260927130000_slh_bill_line_recipient_columns_mutable` 给它开了一个**受控例外**：仅当"去掉这三列后的行快照与旧值完全相同"时放行，其它任何列的变化、同一语句里夹带其它列、以及两张表的删除**仍然一律拒绝**（错误码 `23514` 与约束名保持不变）。实现用 `to_jsonb(NEW) - 三列 IS NOT DISTINCT FROM to_jsonb(OLD) - 三列`，将来给表加列无需改白名单；例外只对 `slh_bill_lines` 生效，费用明细表不受影响。回填实测：44 行写入成功、重复执行为 0 待处理；不变量回归实测：仅改三列放行、改 `goods_name` 拒绝、同语句混改拒绝、删除拒绝、费用明细更新拒绝（全部在回滚事务内验证，无残留）。

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
- 详情为独立页面（明细 22 列，抽屉不适合），入口是列表操作列的「查看详情」按钮；整行点击进入已于 2026-09-27 按需求移除，避免误点跳走（commit `7d425530`）。
- 详情页自上而下四段：**结论层**（折算净额大号主数字 + 台币两项与合计应付人民币 + 对账结论）→ **账单信息**（归属与规模 / 核算参数 / 来源与留痕，xl 起三栏并列）→ **对账核对**（对比表 + 差异与告警）→ **账单明细**。2026-09-27 重排（commit `40017aec`），解决首屏被元数据卡占满、金额与结论落到第二屏的问题；结论层与对比表读同一份 `buildSlhBillComparison`，两处口径不允许分叉（commit `40017aec`）。**首屏主数字为折算净额**（2026-09-27 二轮定案，commit `c47e227c`）：应付合计、代收货款台币、NTD 杂费退到次级区；原件下载入口下沉到信息卡的「来源与留痕」。
- **净额口径（2026-09-27 修订，commit `88334971`）**：台币净额改为**折算净额**展示——系统自算的不折算净额按**账单内嵌汇率**折成人民币后再与账单同口径比较；账单没有内嵌汇率时**不折算**，保留台币原值并显式标注「未折算」。折算前的台币原值与所用汇率作为注脚跟随展示（`row.foldedFrom`），不允许把不同币种的两个数并排比较。**列表页同口径**（commit `50887daa`）：列表列「折算净额」同样按 `不折算净额 ÷ 账单内嵌汇率` 折算（`resolveSlhBillNetDisplay`，无内嵌汇率时退回不折算的台币原值），因此列表接口补出 `embeddedForeignUnitsPerCny`；列表另有「NTD 杂费」列，汇率来源用三态颜色标签（账单内嵌=绿、系统汇率=蓝、手工填写=琥珀）。
- **自算支持项**（运费/代收手续费/附加费合计）不再单开一节，收敛到对比表「合计应付人民币」行明细累加单元格后的 `i` 图标，悬停用 `FaTooltip` 展示（commit `88334971`）。**气泡内不能套 `qs-type-*`**：FaTooltip 的气泡是「前景色底 + 背景色字」，那组类自带 foreground / muted 前景色，会让内容在气泡上几乎不可见；气泡内改用 `text-background`（题目：`text-xs font-semibold`，正文 `text-background/80`）（commit `c47e227c`）。
- **明细检索与筛选在服务端**：`GET /slh-bills/{id}/lines` 新增 `keyword`（模糊匹配入仓单号 / 唛头 / 货名 / 收货人信息，`insensitive contains`）与 `containerBatchName`（按账单原文精确匹配）两个可选参数；web 侧用 `QsGenericTable` 的 `searchable` 与 `filterDefinitions`（下拉选柜号）驱动，条件变化回到第 1 页。**点差异项的「第 N 行」跳页前会清空检索与筛选**，否则页码与整张账单的原始序号对不上（commit `88334971`）。
- **原件文件按"文件"呈现**：图标方块 + 文件名 + 紧跟其后的图标按钮（`aria-label` 为「下载原件」），与导入预览页的文件行同一视觉语言（commit `88334971`）。
- 汇率显示两位小数，仅格式化不回写（与既有 `display.logic.ts` 约定一致）。
- **对账状态（2026-09-27，commit `9263990b` + `bfa39ca4`）**：它是「账单管理」与「账单对账」之间的状态桥，两处取值不同但同源——**明细行二态**（未对账 / 已对账）由 `slh_bill_lines.reconciled_at` 是否为空决定；**账单三态**（未对账 / 部分对账 / 对账完成）由该账单的已对账行数与行数汇总派生，不单独存列。取值集中在 `server/src/modules/slh-bills/slh-bill-reconciliation.ts`，接口枚举在 `slh-bill.dto.ts` 里镜像。派生规则：已对账行数为 0 → `PENDING`，不小于账单行数 → `COMPLETED`，其余 `PARTIAL`；计数为负按 `PENDING`、大于行数按 `COMPLETED` 处理（脏数据防御）。
- **触发器例外与写入口（2026-09-27 追加，commit `3af6f08d`）**：本次仍未实现任何对账操作入口，但按用户明确授权**放宽了 `slh_bill_lines` 的「凭证不可改」触发器**——白名单在收货人三列之外加上 `reconciled_at`，其余列的改变、费用明细表的更新与两张表的删除仍一律拒绝（错误码与约束名不变）。e2e 同时断言正例（改对账时刻成功）与反例（改货名、删除都被拒且数据不变）。在「账单对账」页落地之前，这一列只能由数据侧（运维脚本 / 后续对账功能）写入；页面上的 `PARTIAL` / `COMPLETED` 都是真实派生结果（已在本地用真实账单写入一行、全部行两种情形实测）。
- **对账状态的展示**：取值 → 文案/颜色的映射集中在 `web/apps/qsmds-arco/src/views/workbenches/slh-bills/reconciliation-status.logic.ts`，两处共用同一个 `SlhBillReconciliationStatusTag`（`qs-type-status-tag` + `variant="outline"`，与同列表的汇率来源标签同款）。**颜色（2026-09-27 定案，commit `a5ae22ef` + `c1a2bc70`）**：未对账=红（`text-destructive`，还没开始做的活要被看见）、部分对账=黄、对账完成与已对账=绿。**列位置（commit `394424d5`）**：列表的「对账状态」紧跟「账单期间」之后（便于一眼看进度），移动卡片同步；详情页明细列在共用 `buildSlhBillLineColumns` **之后追加**并**右固定**——明细表很宽，横向滚动时状态要一直看得见（该表没有操作列，它即最右一列）。导入预览因此不受影响（预览行未入库，服务端对预览行固定给 `PENDING`）。
- **两块状态工具栏与计数（2026-09-27，commit `a5ae22ef` + `c1a2bc70` + `8c9a9bd3`）**：列表上方两排 `QsStatusSwitchToolbar`——上排账单状态（生效中 / 已被取代 / 全部）、下排对账状态（**未对账 / 部分对账 / 对账完成 / 全部**，`all` 收尾且**进入页面默认停在「未对账」**，财务打开时先看待办的那批；接口本身仍是"不传参即不筛选"，默认值只落在页面上）。两排都显示「状态 + 数量」。计数走只读接口 `GET /slh-bills/status-counts`（权限同 `slh-bills:read`），响应分两组：`states` 与 `reconciliationStatuses`，数组顺序与工具栏一致（客户端按 value 合并，顺序不参与契约语义）。**计数口径按 `specs/status-switch-toolbar-counts` 的规则落地，并推广到两块工具栏**：基准条件是同一组筛选（搜索、期间、金额），每块工具栏的计数**忽略自己那一维、保留另一维**——例如选了「未对账」后，上排会重算成「生效中 1 / 已被取代 0 / 全部 1」，点进去的行数与数字始终一致；下排的四个数字则始终忽略对账维度（因此「全部 = 未对账 + 部分对账 + 对账完成」）。列表与计数共用 `slh-bill-list-filter.ts` 里的同一份谓词构造（`buildSlhBillListWhere` + `withSlhBillState` / `withSlhBillReconciliationStatus`），对账状态用关系存在性判断（`lines: { none | some }`），不落派生列。Web 侧：切换任一块工具栏都会同时重取列表与计数（因为两块数字互相依赖），选中项的计数用列表 `total` 校准，刷新期间保留上一份快照，失败时清空快照回落为 0 而不冒充成功结果。
- **列表操作列的对账入口（2026-09-27，commit `2eb9e478` + `5d0ee944`）**：操作列在「查看详情」之后按状态追加对账入口——**未对账 → 开始对账、部分对账 → 继续对账、对账完成 → 不给入口**；文案键由 `resolveSlhBillReconciliationActionLabelKey`（`reconciliation-status.logic.ts`）统一给出，完成态返回 `null` 直接关掉按钮，页面不写状态分支。**操作列宽度 232**（内边距 12×2 + 按钮 100×2 + 间距 4 = 228 的下限，取 232 留余量）：组件默认 160 会把两个按钮挤成两行，宽度抽成页面常量 `actionColumn` 并有下限用例守住。**对账功能尚未上线**：点击只弹轻提示 `toast.info`「对账功能暂未开放」，不跳转、不发写请求（占位期间零副作用，占位逻辑有测试断言）。移动卡片沿用现状，不含操作按钮（该卡片此前也没有「查看详情」入口）。
- **顺带修正（commit `a5ae22ef`）**：列表金额区间曾经把上下界分别写进两个 `payableTotalAmountCny` 键，后者覆盖前者，导致 `payableMin` 静默失效（页面未暴露金额筛选，所以一直没被看见）。现在两个边界合并进同一个谓词，并有单测守住。
