# 顺联航账单管理 实施计划

## 执行状态

- 当前阶段：P0 实施中
- 已完成：需求与设计确认（`requirements.md`、`design.md`）
- 已授权：新增 `slh-bills:create` 权限码；新增 3 张表与 2 个枚举（含账单与费用明细）；`media_assets_upload_purpose_check` 白名单扩充；`slh_bills` 来源文件就绪校验分支；编号身份校验触发器
- 当前边界：仅实现「接收、结构化、留痕、查阅」；比对判定属 `slh-bill-reconciliation`
- TDD 原则：解析、材积与定价复算、费别拆解、勾稽校验先建立失败测试再实现

## 任务清单

### 规格与数据层

- [ ] 新增 `slh_bill_charge_type` / `slh_bill_pricing_basis` / `slh_bill_rate_source` 枚举
      _Requirements: R4, R3_
- [ ] 新增 `slh_bills` / `slh_bill_lines` / `slh_bill_line_charges` 表与索引、唯一约束
      _Requirements: R1, R6_
- [ ] 汇率来源互斥 CHECK 与金额非负 CHECK
      _Requirements: R3_
- [ ] 编号身份校验触发器 `enforce_slh_bill_numbering_identity`
      _Requirements: R5_
- [ ] 来源文件就绪校验分支与媒体用途白名单
      _Requirements: R1_
- [ ] 新增 `slh-bills:create` 权限并授予系统管理员
      _Requirements: R7_

### 服务端

- [ ] `slh-bill-calculator.ts`：材积复算、计价方式推导、运费与合计勾稽（纯函数 + 单测）
      _Requirements: R2_
- [ ] `slh-bill-charge-parser.ts`：按币种拆解备注费别（纯函数 + 单测）
      _Requirements: R4_
- [ ] `slh-bill-parser.ts`：表头定位、列别名、行解析、合计行识别、汇率提取（单测）
      _Requirements: R1, R3, R5_
- [ ] `slh-bill.dto.ts`：请求与响应 DTO，金额以字符串传输
      _Requirements: R6_
- [ ] `slh-bill.normalizer.ts`：输入归一与错误映射
      _Requirements: R1_
- [ ] `slh-bill-source-file.service.ts`：上传暂存、解析预览、原件激活与投递
      _Requirements: R1, R6_
- [ ] `slh-bill.service.ts`：创建（编号派发 + 汇率冻结 + 幂等）与取代
      _Requirements: R3, R5, R7_
- [ ] `slh-bill-query.service.ts`：列表、详情、明细分页
      _Requirements: R6_
- [ ] `slh-bill.controller.ts` + `slh-bill.module.ts` + `http.modules.ts` 注册
      _Requirements: R6, R7_
- [ ] 同步 OpenAPI 契约快照
      _Requirements: R6_

### 前端

- [ ] 路由：列表替换占位组件，新增解析预览与详情子路由，导入子路由要求 `slh-bills:create`
      _Requirements: R6, R7_
- [ ] `api/modules/slh-bills.ts` 请求模块
      _Requirements: R6_
- [ ] 列表页：期间/柜号/金额/关键词检索与分页
      _Requirements: R6_
- [ ] 解析预览页：上传、预览校验与差异展示、确认入库
      _Requirements: R1, R2, R4_
- [ ] 详情页：汇总、自报与自算差异、明细分页、原件下载
      _Requirements: R6_
- [ ] 文案三语（zh-cn / zh-tw / en）与路由清单测试同步
      _Requirements: R6_

### 验证

- [ ] 服务端单测（解析器、材积、费别、勾稽）
      _Requirements: R1-R4_
- [ ] 真实账单样本脱敏后作为解析用例
      _Requirements: R1-R4_
- [ ] 空库双次 `prisma migrate deploy` 验证
      _Requirements: R5_
- [ ] 契约 `contract:sync` 后 `contract:check` 通过
      _Requirements: R6_
- [ ] 浏览器实测列表、导入预览与详情
      _Requirements: R6_

## 备注

- 真实账单含客户姓名、电话与地址，**不得**作为样本提交进仓库；用例使用脱敏或构造样本。
- 账单口径 `÷28316` 与 DMS 内部 `÷28317` 的差异在比对阶段处理，本阶段不做折算。
