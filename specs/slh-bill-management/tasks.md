# 顺联航账单管理 实施计划

## 执行状态

- 当前阶段：P0 实施收尾（服务端已完成，前端进行中）
- 已完成：需求与设计确认；规格文档；数据结构与迁移；服务端模块与契约
- 已授权：新增 `slh-bills:create` 权限码；新增 3 张表与 3 个枚举；`media_assets_upload_purpose_check` 白名单扩充；`slh_bills` 来源文件就绪校验分支；编号身份校验触发器；审计事件 `SLH_BILL_IMPORTED`
- 当前边界：仅实现「接收、结构化、留痕、查阅」；比对判定属 `slh-bill-reconciliation`
- TDD 原则：解析、材积与定价复算、费别拆解、勾稽校验先建立失败测试再实现

## 任务清单

### 规格与数据层

- [x] 新增 `slh_bill_charge_type` / `slh_bill_pricing_basis` / `slh_bill_rate_source` 枚举
      _Requirements: R4, R3_ _Evidence: commit a7fb41e1_
- [x] 新增 `slh_bills` / `slh_bill_lines` / `slh_bill_line_charges` 表与索引、唯一约束
      _Requirements: R1, R6_ _Evidence: commit a7fb41e1_
- [x] 汇率来源互斥 CHECK 与金额勾稽 CHECK
      _Requirements: R3_ _Evidence: commit a7fb41e1，本地库实测拒绝形状不一致与勾稽不符_
- [x] 编号身份校验触发器 `enforce_slh_bill_identity`
      _Requirements: R5_ _Evidence: commit a7fb41e1，实测拒绝编号与派发记录不一致_
- [x] 账单自报值留痕列（合计应付人民币、台币单元格原值与公式原文）
      _Requirements: R6_ _Evidence: commit c16603f2（迁移 20260926131000）_
- [x] 来源文件就绪校验分支与媒体用途白名单
      _Requirements: R1_ _Evidence: commit a7fb41e1_
- [x] 媒体引用仓储纳入 `slh_bills`，账单原件不参与媒体回收
      _Requirements: R1_ _Evidence: commit c16603f2_
- [x] 新增 `slh-bills:create` 权限并授予系统管理员
      _Requirements: R7_ _Evidence: commit a7fb41e1，权限目录常量与清单断言同步（c16603f2）_
- [x] 审计事件 `SLH_BILL_IMPORTED`
      _Requirements: R5_ _Evidence: commit c16603f2（迁移 20260926132000）_
- [x] 空库两次 `prisma migrate deploy` 验证
      _Requirements: R5_ _Evidence: 全新库两次 deploy 通过；3 张表、3 个枚举、4 个自报值列、审计值、3 条权限均就位_

### 服务端

- [x] `slh-bill-calculation.ts`：材积复算、计价方式推导、运费与合计勾稽（纯函数 + 单测）
      _Requirements: R2_ _Evidence: commit a26d3fe8，21 项用例_
- [x] `slh-bill-charge-parser.ts`：按币种拆解备注费别（纯函数 + 单测）
      _Requirements: R4_ _Evidence: commit a26d3fe8，10 项用例_
- [x] `slh-bill-parser.ts`：表头定位、列别名、行解析、合计行识别、汇率提取（单测）
      _Requirements: R1, R3, R5_ _Evidence: commit 58ae5b7d，9 项用例_
- [x] `slh-bill.dto.ts`：请求与响应 DTO，金额以字符串传输
      _Requirements: R6_ _Evidence: commit c16603f2_
- [x] `slh-bill.normalizer.ts` 与 `slh-bill.serializer.ts`
      _Requirements: R1_ _Evidence: commit c16603f2_
- [x] `slh-bill-source-file.service.ts`：上传暂存、解析取数、原件激活与投递
      _Requirements: R1, R6_ _Evidence: commit c16603f2_
- [x] `slh-bill.service.ts`：创建（编号派发 + 汇率三态冻结 + 幂等 + 取代）与预览
      _Requirements: R3, R5, R7_ _Evidence: commit c16603f2_
- [x] `slh-bill-query.service.ts`：列表、详情、明细分页
      _Requirements: R6_ _Evidence: commit c16603f2_
- [x] `slh-bill.controller.ts` + `slh-bill.module.ts` + `http.modules.ts` 注册
      _Requirements: R6, R7_ _Evidence: commit c16603f2_
- [x] 同步 OpenAPI 契约快照并通过 `contract:check`
      _Requirements: R6_ _Evidence: commit c16603f2_

### 前端

- [x] 路由：列表替换占位组件，新增解析预览与详情路由，导入路由要求 `slh-bills:create`
      _Requirements: R6, R7_ _Evidence: commit 69c1875a_
- [x] `api/modules/slh-bills.ts` 请求模块
      _Requirements: R6_ _Evidence: commit 69c1875a_
- [x] 列表页：期间区间/关键词/金额区间检索与分页，行点击进详情
      _Requirements: R6_ _Evidence: commit 69c1875a_
      / 后续修订（2026-09-27）：金额区间筛选与整行点击进详情均已移除，详情入口只剩操作列的
      「查看详情」按钮（commit 7d425530）；列表另加「#」序号列、账单期间改单行展示、
      账单编号列置左固定（commit f52c0ed0、58a296fb）_
- [x] 解析预览页：上传、预览校验与差异/告警展示、手填汇率、重复确认与幂等键、确认入库
      _Requirements: R1, R2, R4_ _Evidence: commit 69c1875a_
- [x] 详情页：汇总、自报与自算并列及差额、明细与费用明细分页、原件下载
      _Requirements: R6_ _Evidence: commit 69c1875a_
      / 后续修订（2026-09-27）：详情页重排为「结论层 → 账单信息三栏 → 对账核对 → 账单明细」，
      首屏改为金额与对账结论（实测首屏由元数据改为 30px 主金额 ¥87,482.50 + 结论标签）；
      新增纯展示组件 `slh-bill-conclusion.vue`、`slh-bill-info.vue`，配套纯函数
      `resolveSlhBillConclusion`（差异 > 告警 > 一致定级）与 `resolveSlhBillContainerBatchPreview`
      （柜号清单超 12 个才折叠），三语文案新增 13 个键（commit 40017aec）_
      / 后续修订（2026-09-27，二轮）：台币净额改**折算净额**（按账单内嵌汇率折成人民币，无内嵌
      汇率时不折算并标注）；自算支持项收敛为应付行明细累加单元格的 `i` 图标 + `FaTooltip`；
      原件文件改为文件样式 + 图标下载；明细分页新增 `keyword`（入仓单号/唛头/货名/收货人信息
      模糊搜索）与 `containerBatchName`（柜号精确）服务端过滤，契约快照与前端类型同步重生
      （commit 88334971）_
- [x] 收货人信息拆分为姓名 / 电话 / 地址三字段
      _Requirements: R6_ _Evidence: 解析器 `slh-bill-recipient-parser.ts` + `slh-bill-recipient.fixture.ts`
      （78 行同形脱敏夹具，结构自检 0 不一致：样本 53/53 行切分成功、25 行仓库自提按口径落地址）；
      迁移 `20260927120000_slh_bill_line_recipient_fields` 加三列并已应用；导入链路与明细 DTO 同步
      （commit aeac3d74、4db4af84）。真实账单实测：服务端解析流程 44+34 行产出 53 行含电话 / 25 行仅地址 / 0 行待确认_
      / 存量回填：迁移 `20260927130000` 给"凭证不可改"触发器开了受控例外（只允许这三列变化，
      其余列变化 / 夹带其它列 / 删除仍一律拒绝），`slh-bills:backfill-recipients --apply` 实测写入 44 行、
      重复执行为 0；不变量回归在回滚事务内逐项验证通过_
- [x] 入库前确认弹窗：收集名称、月份与备注，并展示编号占位与原件元数据
      _Requirements: R5, R6_ _Evidence: commit 9df04c68（迁移 20260927100000 与接口）
      / 后续提交（弹窗、列表与详情展示、名称冲突后缀）_
- [x] 对比区改为逐项对齐的对比表，预览与详情共用同一组件
      _Requirements: R2, R6_ _Evidence: commit a4ea9963，迁移 20260926133000 落库小计三值与差异快照，
      详情页因此具备与预览相同的对比与差异分组能力_
- [x] 文案三语（zh-cn / zh-tw / en）与路由清单测试同步
      _Requirements: R6_ _Evidence: commit 69c1875a，新增 135 个键三语完全一致_

导入与详情在实现上是同组隐藏兄弟路由，而不是列表页的子路由：路由 Store 的
`deleteMiddleRouteComponent` 会删掉任何带 children 的路由自身的 component，
叶子挂子路由会让列表页渲染空白。最终 URL 层级与验收预期一致，做法与采购付款、
包装付款等页面的既有先例相同。

### 验证

- [x] 服务端单测（解析器、材积、费别、勾稽）
      _Requirements: R1-R4_ _Evidence: slh-bills 40 项用例；全量 318 套件 3552 用例通过_
- [x] 类型检查、lint、前端用例与生产构建
      _Requirements: R1-R7_ _Evidence: 服务端 tsc/eslint 通过；前端 typecheck/lint 通过，
      `test:api` 1615 用例通过，`build` 通过_
- [x] 契约 `contract:sync` 后 `contract:check` 通过
      _Requirements: R6_ _Evidence: 两端快照一致，6 个 operationId 入库_
- [x] 权限目录的 e2e 断言同步
      _Requirements: R7_ _Evidence: auth-api 与 auth-schema 两个 e2e 共 19 项通过_
- [x] 账单导入接口层 e2e：上传 → 解析预览 → 入库
      _Requirements: R1, R3, R5_ _Evidence: commit e1d1fefa，`server/test/slh-bill-import.e2e-spec.ts`。
      这层用例是必需的：DTO 漏一个 class-validator 装饰器就会因全局 ValidationPipe 的
      `whitelist + forbidNonWhitelisted` 被拒，而纯函数单测与契约快照都发现不了（快照只看
      `@ApiProperty`）。它已经抓到两个必然失败的缺陷：`mediaAssetId` 缺 `@IsUUID`、
      明细分页查询 DTO 误继承了路径参数的必填 `id`。_
- [x] 账单工作簿用例（自有脱敏 OOXML 夹具）
      _Requirements: R1-R4_ _Evidence: `test/fixtures/slh-bill-xlsx.fixture.ts`_
- [x] **对账状态字段：账单三态（未对账 / 部分对账 / 对账完成）与明细行二态（未对账 / 已对账）**
      _Evidence: commit `9263990b`（数据与接口层）、`bfa39ca4`（展示层）、`3af6f08d`（触发器例外）、
      `394424d5`（列位置）；
      派生：`server/src/modules/slh-bills/slh-bill-reconciliation.ts` + `.spec.ts`（三态与边界），
      映射与接线：`web/apps/qsmds-arco/test/views/slh-bill-reconciliation-status.test.ts`，
      接口层：`server/test/slh-bill-import.e2e-spec.ts`（三态经接口派生 + 触发器只放行对账时刻）。
      浏览器实测：真实账单在写入一行对账时刻后列表显示「部分对账」、全部写入后显示「对账完成」、
      清空后回到「未对账」（列表列在账单期间之后，详情列右固定、横向滚动时可见），
      着色符合约定（未对账=红、部分对账=黄、完成/已对账=绿）。_
      _遗留：`PARTIAL` / `COMPLETED` 目前只能由数据侧写入——「账单对账」页尚未实现对账操作入口。_
- [x] **两块状态工具栏与计数（对账状态筛选 + 状态 + 数量）**
      _Evidence: commit `a5ae22ef`（接口与谓词）、`c1a2bc70`（页面与颜色）；
      接口：`GET /slh-bills/status-counts`（`specs/status-switch-toolbar-counts` 的规则，
      每块工具栏的计数忽略自己那一维、保留另一维），谓词共用 `slh-bill-list-filter.ts` + `.spec.ts`，
      接口层：`server/test/slh-bill-import.e2e-spec.ts`（三态计数与列表 total 一致、跨工具栏联动）。
      浏览器实测：上排「生效中 1 / 已被取代 0 / 全部 1」、下排「全部 1 / 未对账 1 / 部分对账 0 / 对账完成 0」；
      切到「对账完成」后列表空、上排重算为「生效中 0 / 全部 0」而下排保持「全部 1 / 未对账 1」，
      切回「全部」恢复；未对账标签为红色。_
- [x] **顺带修正：列表金额区间的下界曾静默失效**
      _Evidence: commit `a5ae22ef`；`payableMin` 与 `payableMax` 原先分别写进两个
      `payableTotalAmountCny` 键，上界把下界覆盖。已合并为一个谓词，并在
      `slh-bill-list-filter.spec.ts` 加回归用例（页面目前未暴露金额筛选，故一直未显现）。_
- [x] **浏览器实测列表、导入预览与详情** —— 已执行（2026-09-27）
      _Requirements: R6_ _证据：当时内置浏览器带有效登录态（`browser.tabs.list()` 非空，直接进入工作台），
      据此实测了：列表加载与各列渲染、列表「对账状态」三态与明细行二态的着色、详情页四段结构与明细列表、
      导入预览页的重复账单提示与「并存 / 取代」二选一（预览态由页面注入构造：内置浏览器无法选文件，
      见下）。_
      _仍然做不到的：**「上传 → 解析」这一段无法在浏览器里跑**——内置浏览器不支持文件选择
      （filechooser 被拒），因此文件上传、解析与入库由接口层 e2e 覆盖（`server/test/slh-bill-import.e2e-spec.ts`，
      经 `node ./scripts/ci-postgres.mjs -- ...` 在临时 schema 上执行）。_
      _⚠️ 登录态会过期：会话失效时仍需请用户在标签里手动登录，不得索取账号密码，也不得绕过
      「永久密码只能走交互式 TTY」的约束。_

### 人工验证步骤（浏览器）

前提：本地服务与前端已启动，且当前用户拥有 `slh-bills:create`（系统管理员默认有）。

1. 打开 `/qs-finance/bill-reconciliation/slh-bill-management`，确认列表可加载、空态文案正常。
2. 点「导入账单」，上传一份顺联航对账单 `.xlsx`（可用 `server/test/fixtures/slh-bill-xlsx.fixture.ts`
   通过 `npx tsx` 生成脱敏样本，不要用真实客户账单做公开演示）。
3. 预览页应显示识别到的期间、行数、柜号清单、系统自算合计、账单自报值与公式原文；
   夹具样本应显示 0 条差异；账单公式自带除数时应显示提取到的汇率。
4. 确认入库后跳转详情：核对账单编号为 `CBILL/<派发月>-NN`、汇率来源为 `EMBEDDED`、
   自报与自算差额为 0、明细 3 行且费用明细按币种拆开、可下载原件。
5. 回到列表可查到该账单；再次导入同一文件应提示期间与柜号集合重复并需勾选确认。

## 备注

- 真实账单含客户姓名、电话与地址，**不提交进仓库**；解析用例使用代码构造的脱敏 OOXML 夹具，结构与金额照抄真实账单，收货人信息替换为测试文本。
- 账单口径 `÷28316` 与 DMS 内部 `÷28317` 的差异在比对阶段处理，本阶段不做折算。
- 迁移时间戳必须晚于同批次既有迁移：本次两个后续迁移曾因时间戳早于主迁移而在空库上先执行，已重命名到主迁移之后。
