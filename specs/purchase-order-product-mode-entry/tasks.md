# 采购产品类型前置选择与销售来源过滤实施计划

## 1. 文档状态

- 状态：已确认
- 确认日期：2026-09-04
- 需求规格：[`requirements.md`](./requirements.md)
- 技术设计：[`design.md`](./design.md)
- 当前阶段：Phase 4 实施中（任务 11）

## 2. 执行原则

- 严格按照 `1 -> 2 -> 3 -> 4/5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11` 的依赖顺序实施。
- 新功能、BUG 修复、公共 API 和数据库迁移均采用 TDD：先建立可观察的 RED，再做最小 GREEN，最后重构。
- 每完成一个独立切片，立即更新本文件状态并进行范围明确的本地 Git 提交。
- 不修改既有 migration；新数据库变化只能通过 append-only migration 实现。
- `contract:sync` 是 OpenAPI 生成物的唯一同步入口，不手工编辑 generated 文件。
- migration 生成、migration 应用、推送、PR、合并和部署均是独立授权门。
- 未获得 Phase 4 正式实施授权前，所有任务保持未开始状态。

## 3. 任务依赖

```text
1 数据与测试基线
  -> 2 Schema / Migration
    -> 3 Server 创建契约
      -> 4 来源订单过滤
      -> 5 来源明细过滤
        -> 6 列表详情与下游供应商
          -> 7 OpenAPI 契约同步
            -> 8 前置选择弹窗
              -> 9 三类入口接入
                -> 10 创建页联动
                  -> 11 端到端与全量验收
```

任务 4、5 可以在完成任务 3 后并行设计，但必须在共享 SQL、DTO 和测试夹具上保持同一过滤口径。

## 4. 实施任务

- [x] 1. 建立数据库与历史数据 RED 测试
  - [x] 对目标数据库只读统计 `CATALOG`、`CUSTOM`、`MIXED` 采购单分布，并记录统计时间与范围。
    - 2026-09-04 本地开发库：共 5 张，`CATALOG` 3 张、`CUSTOM` 0 张、`MIXED` 2 张、无明细 0 张、未知类型 0 张。
  - [x] 为新枚举、字段、供应商来源互斥约束和历史回填建立 migration/Schema 失败断言。
  - [x] 覆盖纯 `CATALOG`、纯 `CUSTOM`、混合明细、无明细和未知明细类型场景。
  - [x] 证明迁移不得修改采购单数量、订单号、金额、状态、销售来源关系和明细数量。
  - [x] 运行 RED 测试并保留预期失败证据，不提前放宽断言。
  - _Requirement: R8、R9_
  - _Verification: Prisma Schema/migration drift tests、隔离 PostgreSQL migration replay_

- [x] 2. 新增产品采购类型数据模型与 append-only migration
  - [x] 新增 `PurchaseOrderProductMode.CATALOG/CUSTOM/MIXED`。
  - [x] 为 `PurchaseOrder` 增加 `productMode` 和 `customSupplierName`，将 `supplierValue` 改为可空。
  - [x] 按历史采购明细构成回填 `productMode`；历史混合采购单回填只读 `MIXED`。
  - [x] 保留所有历史 `supplierValue`，不拆单、不改号、不重算金额、不伪造自由文本供应商。
  - [x] 增加 `supplierValue/customSupplierName` 恰好一个存在及非空白约束。
  - [x] 增加必要索引并完成空库重放、升级重放、回滚失败和 Prisma drift 验证。
    - 空库完整重放成功；全库 drift 仅余既有的 numbering pattern index 与 sales order FK 命名差异，无本次采购模型差异。
  - [x] 只生成和验证 migration，不应用到业务数据库。
  - _Requirement: R2、R3、R9_
  - _Suggested commit: `feat: 增加采购产品类型与供应商来源模型`_
  - _Approval gate: 开始前需要 Schema 与 migration 生成实施授权；应用 migration 另行确认_

- [x] 3. 改造采购创建契约与可信校验
  - [x] 先为 DTO、Normalizer、领域规则、依赖服务和请求指纹建立 RED 测试。
  - [x] Create DTO 增加 `productMode` 和 `customSupplierName`，并将 `supplierValue` 改为条件必填。
  - [x] 对 `CUSTOM` 供应商名称执行 NFKC、trim、1–128 code points 校验。
  - [x] 强制供应商字段互斥、全部明细 `lineType === productMode`，并禁止新建 `MIXED`。
  - [x] 将产品模式和供应商来源加入幂等请求指纹。
  - [x] 保留 `CATALOG` 当前产品供应商/采购成本校验、`CUSTOM` 双价格相等和数量约束。
  - [x] 增加稳定错误码并更新控制器错误契约测试。
  - _Requirement: R3、R7、R8_
  - _Suggested commit: `feat: 增加采购产品类型创建约束`_
  - _Approval gate: 开始前需要公共 API 修改实施授权_

- [x] 4. 按产品类型与供应商过滤销售来源订单
  - [x] 先覆盖 `CATALOG/CUSTOM`、多供应商、部分采购、已取消采购、无剩余明细和状态边界 RED 测试。
  - [x] 来源列表 query 增加 `productMode`；`CATALOG` 条件要求 `supplierValue`，`CUSTOM` 禁止该参数。
  - [x] 重构来源事实 SQL，先按 `sourceSalesOrderLineId` 计算有效已采购数量，再建立目标剩余明细集合。
  - [x] 继续执行 `CONFIRMED`、海运前履约状态和现有未采购/部分采购视图规则。
  - [x] 确保 `counts`、`total`、分页、搜索、列表和产品摘要使用同一过滤条件。
  - [x] 产品摘要只返回当前目标且仍有剩余数量的销售明细。
  - [x] 为销售快捷入口增加精确订单资格校验能力，不用模糊搜索代替身份校验。
  - _Requirement: R5_
  - _Verification: Source query unit/integration tests、SQL 参数化与分页边界_

- [x] 5. 按初始化条件过滤销售来源明细
  - [x] 为来源明细端点增加与列表一致的 `productMode/supplierValue` query 契约测试。
  - [x] `CATALOG` 只返回当前供应商产品；`CUSTOM` 只返回临时产品。
  - [x] 保留目标来源行的原始数量、有效已采购数量、剩余数量和历史采购行。
  - [x] 保证已取消采购单不进入已采购数量，灰色历史行数据只来自目标来源明细。
  - [x] 在最终创建事务中重新锁行并验证订单、类型、供应商和剩余数量，禁止信任列表快照。
  - [x] 覆盖列表可选但提交前状态变化的冲突场景。
  - _Requirement: R6、R8_
  - _Suggested commit for tasks 4–5: `feat: 支持按产品类型过滤销售来源`_

- [x] 6. 适配采购列表、详情与下游供应商读取
  - [x] 先审计所有假定 `supplierValue` 非空的列表、详情、发货、付款、取消和展示路径。
  - [x] 列表与详情响应增加 `productMode` 和供应商来源判别字段。
  - [x] 字典供应商继续通过 `resolveStoredValue()` 返回有效、停用或未知状态。
  - [x] 自由文本供应商直接返回保存名称，不伪装为字典值或未知字典项。
  - [x] 采购关键字搜索增加 `customSupplierName`。
  - [x] 历史 `MIXED` 采购单继续支持列表、详情、付款、履约、取消和发货。
  - [x] 补充所有受影响 DTO、Mapper 和服务测试。
  - _Requirement: R9、R10_
  - _Suggested commit: `feat: 支持自定义采购供应商展示`_

- [x] 7. 同步并验证 OpenAPI 契约
  - [x] 更新 Controller DTO/decorators、请求 query/body、响应和稳定错误码。
  - [x] 先让 OpenAPI snapshot/operation 契约测试按新设计失败，再完成最小实现。
  - [x] 通过根 `contract:sync` 同步 Server snapshot、Web snapshot 和 generated client。
  - [x] 检查 generated diff 仅包含预期采购契约，不手工修改生成文件。
  - [x] 运行 `contract:check`、Server typecheck、lint 和相关测试。
  - _Requirement: R5、R8、R10_
  - _Suggested commit: 与对应 Server 公共契约切片一同提交_

- [x] 8. 实现 `QsPurchaseStartModal`
  - [x] 先建立纯逻辑和组件契约 RED 测试。
  - [x] 基于 `QsGenericModal` 实现 `CATALOG/CUSTOM` 互斥面板和条件化供应商控件。
  - [x] `CATALOG` 复用 `QsDictionarySelect(service_provider.supplier)`；`CUSTOM` 使用受控文本输入。
  - [x] 面板切换清空旧供应商和错误，关闭清空局部草稿。
  - [x] 只有初始化资料合法时允许“开始采购”，提交中防重复并锁定关闭。
  - [x] 支持销售快捷订单资格校验、Abort、身份变化和失败恢复。
  - [x] 完成桌面双面板、移动单列、radio 语义、focus ring 和 44px 点击目标。
  - _Requirement: R1、R2、R3_
  - _Suggested commit: `feat: 新增采购开始选择弹窗`_

- [x] 9. 接入全部采购、待办采购和销售订单入口
  - [x] 将全部采购与待办采购的“新增采购/新增备货采购”改为先打开前置弹窗。
  - [x] 继续使用 `purchase-orders:create` 与 `purchase-orders:create-stock` 控制入口和服务端授权。
  - [x] 将销售订单“新增采购”接入同一组件并携带目标订单 ID/订单号作为预选上下文。
  - [x] 目标订单没有当前产品模式/供应商的剩余明细时，留在弹窗并显示 Warning Toast。
  - [x] 确认后构造规范、单值、有限长路由 query；取消时不导航、不写草稿、不发号。
  - [x] 覆盖入口权限、重复点击、非法上下文和路由失败测试。
  - _Requirement: R1、R5_
  - _Suggested commit: `feat: 统一采购新增入口`_

- [x] 10. 改造采购创建页初始化与联动
  - [x] 为创建上下文解析建立纯函数 RED 测试，覆盖合法组合、数组、缺失、超长和冲突参数。
  - [x] 只有完整合法的 `purchaseType/productMode/supplier` 组合才能挂载可编辑表单。
  - [x] 第一阶段只读展示 `productMode`，并按模式显示字典供应商或文本供应商。
  - [x] 修改供应商时先确认，再清除绑定订单、来源行、可编辑行、只读行、来源映射、数量上限、定金和尾款。
  - [x] `STOCK + CATALOG` 只开放所选供应商产品；`STOCK + CUSTOM` 只开放临时产品。
  - [x] `SALES_LINKED` 的选择、视图计数、搜索、分页、明细加载和同步固定携带当前过滤条件。
  - [x] 同步后待采购行在前、灰色已采购行在后，并保留当前价格与数量规则。
  - [x] 非法直接 URL 返回安全列表入口并使用轻提示，不展示半初始化表单。
  - [x] 保留最终确认发号、幂等重放和未知提交结果恢复。
  - _Requirement: R4、R6、R7_
  - _Suggested commit: `feat: 接入采购产品类型创建流程`_

- [ ] 11. 完成回归、浏览器和全量验收
  - [ ] 构造并验证 `SALES_LINKED + CATALOG`：按供应商过滤、同步和提交。
  - [ ] 构造并验证 `SALES_LINKED + CUSTOM`：文本供应商、CUSTOM 过滤和双价格。
  - [ ] 以管理员验证 `STOCK + CATALOG` 和 `STOCK + CUSTOM` 的单类型编辑器。
  - [ ] 验证销售订单快捷入口成功与无资格分支。
  - [ ] 验证供应商切换清空下游、并发超量、订单状态变化和取消采购释放数量。
  - [ ] 验证 390px、1440px、键盘导航、焦点、关闭和重复提交行为。
  - [ ] 验证历史 `MIXED` 采购单的列表、详情、付款、履约、取消和发货不回归。
  - [ ] 运行 Server/Web typecheck、lint、test、build、OpenAPI 契约检查、真实 Browser E2E 和根 `node --run check`。
  - [ ] 如实记录所有失败；任何必要检查失败时不得声称完成或推送。
  - _Requirement: R1–R10_
  - _Suggested commit: `test: 补充采购产品类型流程验收`_

## 5. 独立确认门

### Gate A - Phase 4 正式实施

开始任务 1 前，用户必须明确授权开始实施。本文件确认本身不授权修改业务代码。

### Gate B - Schema、公共 API 与 migration 生成

开始任务 2、3 前，再次列明以下变更并取得明确确认：

- Prisma Schema 和公共数据结构；
- 创建采购订单与来源销售订单公共 API；
- append-only migration 的生成。

### Gate C - Migration 应用

完成 migration 代码和隔离验证后，先提交审计结果。只有用户明确要求“应用 migration”后，才允许对指定数据库执行。

### Gate D - 外部 Git 与发布

本计划默认只进行本地小步提交；不 push、不创建 PR、不 merge、不打 Tag、不发布、不部署。

## 6. 完成定义

只有同时满足以下条件，才可将本计划标记为完成：

1. R1–R10 全部有实现和自动化测试证据；
2. migration 在空库与升级库验证通过，并按独立授权应用到目标数据库；
3. OpenAPI Server/Web 契约完全同步；
4. 四种采购组合、销售快捷入口和历史 `MIXED` 浏览器验收通过；
5. `node --run check`、`git diff --check` 通过；
6. Git 工作区无未解释变更，所有提交范围与任务切片一致；
7. 未经授权的 push、PR、merge、发布或部署均未发生。
