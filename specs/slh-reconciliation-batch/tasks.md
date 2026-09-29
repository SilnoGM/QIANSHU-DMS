# 顺联航账单对账批次实施计划

## 0. 文档状态

- 状态：已实施完成（代码、迁移与验证全部落地）
- 确认日期：2026-09-29

## 1. 实施约束

- 严格执行失败测试 → 最小实现 → 重构 → 回归，不先写实现再补测试。
- 已确认新增：`slh_reconciliation_batches` / `slh_reconciliation_batch_lines` 两张表、`slh_bill_line_match_source` 枚举、三个审计事件值、7 个只读或写入接口（权限复用 `slh-bills:reconcile`）。
- 不得修改 `slh_bills`、`slh_bill_lines` 表结构与 `enforce_slh_bill_identity`、`enforce_slh_bill_evidence_immutable` 两个触发器。
- 不得自造编号生成逻辑；批次编号只能由编号域 `SLH_RECON_BATCH_NO` 派发。
- 匹配年份只能取明细行装柜日期的年份，禁止使用当前年份或账单期间年份。
- 新增 migration 后必须同步更新 `docs/后端文档/数据库迁移规范.md` 的「## 2. 当前迁移基线」。
- 每次提交只暂存本任务文件；不 push、不创建 PR、不部署。

## 2. 编号规则现状（2026-09-29 核对本地库）

- `SLH_RECON_BATCH_NO`「顺联航对账批次编号」已由管理员在编号管理页配置并启用：用途 `BUSINESS`、规则状态 `ENABLED`、生效版本 revision 2（`ACTIVE`）、重置周期 `YEARLY`、时区 `Asia/Shanghai`。
- 生效片段：`FIXED 'SRB'` + `SEPARATOR '/'` + `DATE 'YYYYMMDD'` + `SEPARATOR '-'` + `SEQUENCE(width 3, start 1, step 1)`，即形如 `SRB/20260929-001`（revision 1 的 `SLHRC` 前缀已退役）。
- 尚未派发过任何编号（`numbering_issuances` 0 条、无周期状态行），因此规则仍处于「首次发号前」：前缀、日期段与重置周期都还改得动；一旦发出第一个编号，只允许扩大序号位宽。
- 迁移不代替管理员建规则，本环境无需再建；若其它环境缺失，创建批次会返回 `SLH_RECON_BATCH_NUMBERING_UNAVAILABLE` 并提示检查该规则。

## 3. 任务清单

### 阶段一：规格与迁移

- [x] 提交需求、设计与实施计划（本目录三份文档）_Evidence: commit ffcb14c6_
- [x] `prisma/schema.prisma` 增加两个 model、一个枚举与反向关系 _Evidence: commit 33239826_
- [x] 迁移 `20260929120000_slh_reconciliation_batch`：两张表、索引、FK、枚举、编号身份触发器 _Evidence: commit 33239826_
- [x] 迁移 `20260929121000_slh_reconciliation_batch_audit_events`：追加三个审计事件值 _Evidence: commit 33239826_
- [x] 迁移规范文档登记两条迁移与 model 计数 57 → 59 _Evidence: commit 33239826_
- [x] 临时 PostgreSQL 16 容器验证：空库两次 `migrate deploy`（80 条迁移）、表/枚举/触发器/CHECK 齐备、编号身份触发器注入拒绝、`prisma:drift:check` 无差异 _Evidence: commit 33239826_

### 阶段二：匹配引擎（TDD）

- [x] 先写失败测试：柜号名称规范化、名称路径命中、唛头兜底命中、跨年同单、唛头尾两位不参与序号、缺唛头、跨仓歧义、四类来源不合格
- [x] 实现 `slh-bill-line-matching.ts` 纯函数并让测试通过 _Evidence: commit 99ef3596，15 项单测_
- [x] 备查：`resolveLoadingItemIneligibility` 由匹配与核对复检共用，避免两处判定漂移

### 阶段三：服务端模块（TDD）

- [x] 先写失败 e2e：创建成功并派发编号、占用冲突、零命中、预览范围不一致、复检整批拒绝、核对成功后的行级与账单级变化、结束解除占用后可再次创建、幂等重试 _Evidence: commit 99ef3596_
- [x] DTO 与序列化器（候选账单复用账单列表口径，详情给成员行与四个计数）_Evidence: commit 99ef3596_
- [x] 写路径：创建（幂等键 + 账单行锁 + 准入复检 + 重跑匹配 + 取号 + 成员行 + 审计）、核对（整批拒绝）、结束 _Evidence: commit 99ef3596_
- [x] 读路径：列表、候选、匹配预览、详情 _Evidence: commit 99ef3596_
- [x] 控制器接线、模块注册、审计事件中文标签 _Evidence: commit 99ef3596 / d3f1f4c1_
- [x] `node --run contract:sync`，三份契约产物一致；服务端 `pnpm check` 3647 项通过、e2e 10 项通过

### 阶段四：前端

- [x] API 客户端模块 + 接口断言测试 _Evidence: commit d3f1f4c1_
- [x] 路由改造：列表替换占位组件、新增详情隐藏兄弟叶子 _Evidence: commit d3f1f4c1_
- [x] 列表页 + 列定义 + 状态筛选（默认进行中）_Evidence: commit d3f1f4c1_
- [x] 两步弹窗（`FaSteps` 骨架 + 预览两段 + 零命中禁用 + 预览行集合仅作比对）_Evidence: commit d3f1f4c1_
- [x] 详情页：批次信息、两个数字、成员行表（只含成员）、勾选核对与结束本轮 _Evidence: commit d3f1f4c1_
- [x] 三语 i18n 文案（含批次状态、匹配来源、十条不合格原因）_Evidence: commit d3f1f4c1_
- [x] 路由清单测试同步（叶子总数 13 → 14）与页面/逻辑测试 15 项通过 _Evidence: commit d3f1f4c1_
- [x] 图标清单重算（`node web/scripts/generate-icon-inventory.mjs`）_Evidence: commit d3f1f4c1_

### 阶段五：验证与收尾

- [x] Server：`pnpm check`（含 `prisma:validate`、漂移门禁、typecheck、lint、3647 项单测）
- [x] Server e2e：`slh-reconciliation-batch.e2e-spec.ts` 10 项（隔离 schema 重放全部 80 条迁移）
- [x] Web：`pnpm check`（含合同检查、typecheck、lint、1662 项单测）
- [x] 根：`node --run check` 退出码 0（含治理用例与真实 Chrome 浏览器用例）
- [x] 浏览器实测新页面（列表 → 新建两步弹窗 → 详情 → 核对 → 结束）_Evidence: 见下节「浏览器实测记录」_

## 4. 浏览器实测记录（2026-09-29）

在内置浏览器对本地开发环境走完整流程，全部通过：

- 列表页：菜单入口、两处工具栏、列定义、空态、面包屑（主页 › 千树财务工作台 › 账单对账 › 顺联航账单对账）正确；默认停在「进行中」。
- 两步弹窗：步骤条 1/2；未选账单时「下一步」禁用；候选列表只列未对账且无进行中批次的账单。
- 匹配预览：真实账单 44 行，展示「可核对 1 行 / 暂不能核对 43 行」，未匹配行逐条给出原因；零命中时「开始对账」禁用。
- 创建：批次编号按编号域配置派发为 `SRB/20260929-001`，成功后跳详情页。
- 详情：只显示匹配命中的成员行；两个数字（本批次已核对 1/1 · 本账单还剩未核对行 43）；核对后账单三态自动变为「部分对账」，账单管理列表操作列自动变「继续对账」。
- 结束：确认弹窗说明剩余行去向；结束后状态变「已完成」、记录结束人时间、页面转只读。
- 服务端留痕：派发记录 `consumer_code = SLH_RECON_BATCH.CREATE`、批次版本 1 → 2、三条审计事件元数据齐全。

为让账单有一行可匹配，向本地开发库写入了一条最小链路（销售订单 → 采购订单 → 货件 `PKG/20260929-00001` → 柜次 `CTN/2026-004`(1211-01柜/2025-12-11) → 装柜明细(唛头 J-121125)），均为正式编号域派发并满足既有触发器规则。**用户已确认保留现状**：账单 `CBILL/202609-01` 第 1 行现为已对账，审计事件与编号派发记录按设计永久保留。

本次实测发现并修复的页面缺陷：`FaAlert` 文案写进默认插槽导致错误提示为空（`8db03f47`）、已结束批次详情仍显示「已选择 0 行」（`0cb6dd5a`），并补了前者源码断言防回归。

## 5. 未纳入本轮

- 明细行与柜次行的金额、材积逐项比对判定与比对 UI。
- 撤销对账、移出批次、作废批次；账单被取代时的批次拦截。
- 批次列表状态计数工具栏。

## 6. 仓库既有缺陷（本任务外，已在 2026-09-29 单独修复）

1. 账单导入的幂等重放比较把「摘要的摘要」与明文摘要相比，永远不等 → 同一 `Idempotency-Key` 重试只会拿到 409，不会返回已创建的账单。已改为按同一推导比较，并补同键重放 e2e。_Evidence: commit a440a07b_
2. `20260926130000_slh_bill_management` 等四处迁移的结构自校验把表名写死在 `table_schema = 'public'`，隔离 schema 回放会报 `SLH bill tables missing`。历史迁移不可改写（改 checksum 会让所有已应用环境需要 `migrate resolve`），改为在隔离回放前显式断言 public 已应用迁移并给出可操作命令，迁移规范补 5.1 说明。_Evidence: commit c135a088_
