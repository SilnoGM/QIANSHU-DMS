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

- [ ] 路由：列表替换占位组件，新增解析预览与详情子路由，导入子路由要求 `slh-bills:create`
      _Requirements: R6, R7_
- [ ] `api/modules/slh-bills.ts` 请求模块
      _Requirements: R6_
- [ ] 列表页：期间/关键词/金额区间检索与分页
      _Requirements: R6_
- [ ] 解析预览页：上传、预览校验与差异展示、确认入库
      _Requirements: R1, R2, R4_
- [ ] 详情页：汇总、自报与自算并列、明细与费用明细分页、原件下载
      _Requirements: R6_
- [ ] 文案三语（zh-cn / zh-tw / en）与路由清单测试同步
      _Requirements: R6_

### 验证

- [x] 服务端单测（解析器、材积、费别、勾稽）
      _Requirements: R1-R4_ _Evidence: slh-bills 40 项用例；全量 318 套件 3552 用例通过_
- [x] 类型检查、lint 与契约检查
      _Requirements: R1-R7_ _Evidence: tsc、eslint、contract:check 均通过_
- [x] 账单工作簿用例（自有脱敏 OOXML 夹具）
      _Requirements: R1-R4_ _Evidence: `test/fixtures/slh-bill-xlsx.fixture.ts`_
- [ ] 浏览器实测列表、导入预览与详情
      _Requirements: R6_

## 备注

- 真实账单含客户姓名、电话与地址，**不提交进仓库**；解析用例使用代码构造的脱敏 OOXML 夹具，结构与金额照抄真实账单，收货人信息替换为测试文本。
- 账单口径 `÷28316` 与 DMS 内部 `÷28317` 的差异在比对阶段处理，本阶段不做折算。
- 迁移时间戳必须晚于同批次既有迁移：本次两个后续迁移曾因时间戳早于主迁移而在空库上先执行，已重命名到主迁移之后。
