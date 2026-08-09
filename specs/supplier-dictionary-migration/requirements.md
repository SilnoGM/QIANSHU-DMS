# 供应商字典化与独立模块退役需求规格

## 1. 文档状态

- 状态：已实施并通过本地验收
- 编写日期：2026-08-09
- Phase 1 确认日期：2026-08-09
- 实施验收日期：2026-08-09
- 实施分支：`refactor/supplier-to-dictionary`
- 基线分支：`main`
- 基线 SHA：`a41e7014709ce3adf46ba1c768f653c5de2c34d4`
- 取代范围：`specs/supplier-management/` 所定义的独立供应商主数据能力
- 目标入口：`/system/basic-data/dictionaries`

## 2. 背景与目标

供应商不再作为具有独立生命周期、联系人、登记和地址信息的核心主数据维护，而是降级为由业务管理员维护的平铺可选列表。系统应复用既有 `DictionaryType -> DictionaryItem` 能力承载供应商选项，并彻底退役独立供应商页面、HTTP API、权限、Schema、发号数据、Audit 数据和专属 CI。

本次变更采用向前迁移，不回退或重写已公开的 `main` 历史，不修改、删除或重命名已经执行的供应商 migration。

## 3. 冻结时真相源

Phase 1 只读审计确认：

- 本地与远端 `main` 均为 `a41e7014709ce3adf46ba1c768f653c5de2c34d4`，其后没有新增提交。
- 本地开发库已应用全部十条现有 migration，Schema 状态为最新。
- 本地开发库包含 1 条启用 Supplier、2 条 SupplierCreateRequest（其中 1 条未完成）、5 项供应商权限及 5 项角色授权。
- 本地开发库包含 1 条 `SUPPLIER.CREATE` Numbering Issuance、2 条 `SUPPLIER_*` 业务 Audit 和 3 条 `SUPPLIER` Rule 生命周期 Audit，`SUPPLIER` Numbering Rule 为启用状态。
- 当前唯一 Supplier 及其全部业务字段已确认直接舍弃，不转换为 Dictionary Item。
- `/system/service-provider` 当前只包含供应商一个子路由；供应商退役后应删除整个空父路由。
- 当前 CI 有八个 validation jobs，其中 `browser-suppliers-e2e` 为供应商专属；退役后应保留其余七个。

以上数据只描述本地开发库。任何其他环境执行 migration 前都必须独立运行相同的前置检查，不得假设数据形态一致。

## 4. 术语与决策

### 4.1 供应商字典

- Dictionary Type code：`service_provider.supplier`。
- Dictionary Type name：`供应商`。
- Dictionary Type description：`合作供方中的供应商列表`。
- 业务页面如需消费供应商，应通过现有 Dictionary Catalog 或 `DictionaryLookupService` 使用 `service_provider.supplier`，不得恢复供应商专用 API。

现有字典 Type code 必须使用带命名空间的小写格式，因此不使用不符合契约的裸 `SUPPLIER`。

### 4.2 供应商字典条目

退役 migration 只创建空且停用的 `service_provider.supplier` Type，不从 `suppliers` 生成任何 Dictionary Item。现有 `SUP/260805-001`、法定名称、简称、登记信息、联系人、地址、邮编、备注、状态、版本和创建幂等资料全部舍弃。

后续 Dictionary Item 必须由管理员通过现有字典管理能力手工创建、启用和维护，并继续遵守既有 value、label、description、tone、排序、版本和 Audit 契约。

### 4.3 历史与清理边界

以下供应商专属数据库数据和契约全部舍弃：

- `SUPPLIER` Numbering Rule、RuleVersion、PeriodState 及其全部 Numbering Issuance ledger。
- 全部 `SUPPLIER_*` Audit、目标类型为 Supplier 的历史 Audit，以及属于 `SUPPLIER` Numbering Rule 的生命周期 Audit。
- Prisma 与 PostgreSQL `audit_event_type` 中四个 `SUPPLIER_*` 枚举值。
- 供应商业务表、创建请求、权限、角色授权和供应商专属运行时代码。

以下历史证据必须保留：

- 已执行的 `20260805090000_supplier_management_schema_and_permissions` migration 文件及 Prisma migration ledger 记录。
- 已公开的 Git commit、PR 和 CI 历史。

旧 migration 必须继续参加空库完整重放；新的 forward migration 负责在最终状态中清除其创建的供应商对象和数据。

## 5. 用户故事

### 5.1 基础数据管理员

作为基础数据管理员，我希望在现有字典管理页面维护供应商选项，以便业务页面消费统一的供应商列表，而不再进入独立供应商管理页面。

### 5.2 业务用户

作为业务用户，我希望业务页面只展示当前有效的供应商字典项，并能识别已经停用或未知的历史值。

### 5.3 系统维护者

作为系统维护者，我希望通过可重放的向前 migration 明确舍弃全部供应商专属业务、发号和 Audit 数据并退役专用结构，同时保留 migration 与 Git 证据，避免数据库历史失配。

## 6. 功能需求

### Requirement 1 - 供应商字典身份与管理入口

#### Acceptance Criteria

1. 当退役迁移完成时，系统应存在且只存在一个 code 为 `service_provider.supplier` 的 Dictionary Type。
2. 当基础数据管理员维护供应商时，系统应只通过 `/system/basic-data/dictionaries` 和既有 `dictionaries:*` 权限提供维护能力。
3. 当业务调用方消费供应商选项时，系统应复用既有 Dictionary Catalog 或 `DictionaryLookupService`，不得新增供应商专用 Catalog、选择器或 HTTP API。
4. 当源数据库存在或不存在供应商记录时，系统都应创建停用的 `service_provider.supplier` Type，且不得根据源 Supplier 生成任何 Item。
5. 当退役 migration 完成时，`service_provider.supplier` Type 应保持停用且 Item 数量应为零。
6. 当管理员后续新增供应商 Item 时，系统应继续遵守现有字典 value、版本、状态、Audit 和不可删除边界。

### Requirement 2 - 现有供应商数据舍弃

#### Acceptance Criteria

1. 当源 `suppliers` 表存在记录时，系统不应把任何 Supplier 字段复制、转换或编码为 Dictionary Item。
2. 当源 `supplier_create_requests` 存在完成或未完成记录时，系统应随专用表退役直接舍弃这些记录。
3. 当退役 migration 执行时，系统应舍弃 Supplier code、主体、登记、联系人、地址、备注、状态、版本和时间字段，不建立归档表、JSON、说明拼接或兼容副本。
4. 当目标数据库已存在 `service_provider.supplier` Type 时，migration 应整体失败并暴露迁移冲突，不得合并、覆盖或使用 `ON CONFLICT DO NOTHING` 隐藏漂移。
5. 当 migration 创建空 Dictionary Type 时，系统不应伪造交互式 `DICTIONARY_TYPE_CREATED` Audit；migration 文件本身作为结构转换证据。
6. 当退役 migration 成功时，源 Supplier 和 SupplierCreateRequest 记录数应归零且两张源表应被删除，目标 Dictionary Item 数量应为零。

### Requirement 3 - 供应商数据库结构退役

#### Acceptance Criteria

1. 当空 Dictionary Type 创建并完成自检时，migration 应删除 `supplier_create_requests` 和 `suppliers` 表以及其 Trigger、Function、索引、约束和外键。
2. 当供应商表删除后，migration 应删除不再使用的 `supplier_entity_type` PostgreSQL enum。
3. 当退役完成时，Prisma schema 应移除 `Supplier`、`SupplierCreateRequest`、`SupplierEntityType` 以及 Region、NumberingIssuance 上的供应商关系。
4. 当数据库升级时，系统应使用新的单事务 forward migration，不得修改、删除或重命名任何旧 migration。
5. 当 migration 任一前置检查、Type 创建、数据清理、权限清理或结构自检失败时，事务应整体回滚。
6. 当从空数据库重放全部 migration 时，最终数据库应只包含供应商字典，不包含供应商专用表和 enum。
7. 当从已经执行供应商 migration 的数据库升级时，Prisma migration status 应保持一致且无缺失历史。
8. 当删除供应商专用数据库对象时，migration 不应使用 `CASCADE`；任何未知依赖都应使事务失败并保留源数据。

### Requirement 4 - 权限、Audit 与 Numbering 清理

#### Acceptance Criteria

1. 当供应商独立模块退役时，migration 应先删除全部 `suppliers:*` RolePermission，再删除五项 `suppliers:*` Permission。
2. 当权限清理完成时，Server 权限常量和 Web 权限目录不应再包含 `suppliers:*`。
3. 当清理 `SUPPLIER` Numbering Rule 时，migration 应删除其全部 Issuance、PeriodState、RuleVersion 和 Rule 数据，不保留或迁移任何已发编号。
4. 当清理供应商 Audit 时，migration 应删除四类 `SUPPLIER_*` 事件、目标类型为 Supplier 的 Audit，以及通过目标 Rule ID 或 metadata `ruleCode=SUPPLIER` 归属于 `SUPPLIER` Numbering Rule 的生命周期 Audit。
5. 当供应商 Audit 数据删除后，migration 应从 PostgreSQL `audit_event_type` 中移除 `SUPPLIER_CREATED/UPDATED/ENABLED/DISABLED`，Prisma `AuditEventType` 也应同步移除。
6. 当删除受数据库不可变 Trigger 保护的 Numbering 数据时，migration 应只在同一事务内精确停用并恢复目标表的四个具名 Trigger，不得使用会影响其他业务表的全局 Trigger 绕过机制。
7. 当供应商运行时代码退役时，系统应移除仅由供应商使用且没有其他调用方的共享扩展；当某扩展存在独立调用方时，系统应保留并由测试证明该调用方。
8. 当 migration 完成时，数据库、Server 运行时代码和 OpenAPI 中不应保留任何可执行的 Supplier 权限、发号或 Audit 契约；旧 migration 与 Git 历史中的文本不属于运行时残留。
9. 当 migration 删除供应商专属 Numbering 和 Audit 数据时，其他 Rule、Issuance、PeriodState、Audit 行和 Audit enum label 应保持数量与内容不变。

### Requirement 5 - Server 与公共 API 退役

#### Acceptance Criteria

1. 当退役完成时，Server 应不再注册 SupplierModule，也不再包含供应商 Controller、DTO、Command、Query、Lifecycle、Normalizer、Persistence、Region Validation 或 Idempotency 运行时代码。
2. 当客户端请求原 `/api/suppliers`、`/api/suppliers/{supplierId}` 及其启停子路径时，系统应不再匹配供应商路由。
3. 当 OpenAPI 契约重新生成时，Server/Web snapshot 和 generated types 应不包含 Supplier 路径、六个 `suppliers_*` operation、Supplier DTO schema、Supplier error contract 或 `SUPPLIER_*` Audit enum label。
4. 当供应商 API 移除时，系统不得添加兼容代理、弃用期 endpoint、隐藏开关或虚假空列表响应。
5. 当供应商 API 专属测试不再代表现行契约时，系统应删除这些测试，并新增退役边界测试证明模块、路由和契约不存在。

### Requirement 6 - Web 路由与界面退役

#### Acceptance Criteria

1. 当退役完成时，Web 应删除 `/system/service-provider/suppliers` 路由、供应商页面、领域 Drawer/Modal、API adapter 和专属状态逻辑。
2. 当“合作供方”父菜单不再包含任何有效子路由时，Web 应删除该父菜单与对应路由模块，不保留空菜单。
3. 当用户访问旧前端地址时，Router 应按现有未知路由策略处理，不提供重定向或兼容页面。
4. 当供应商入口消失时，字典管理页面应保持现有信息架构、响应式布局、暗色主题和无障碍行为，不新增供应商专属视觉分支。
5. 当 Web 构建完成时，供应商 API、权限码、页面路径和组件名不应出现在正式运行时代码或生成契约中。

### Requirement 7 - CI、测试与工程治理退役

#### Acceptance Criteria

1. 当供应商独立功能退役时，系统应删除供应商专属 Browser runner、helper、测试脚本和 CI Job。
2. 当 CI workflow 更新时，`CI gate` 应精确移除供应商 Browser Job 依赖，从八个 validation jobs 收敛为其余七个 jobs。
3. 当根脚本和 Web scripts 更新时，系统应删除供应商专属命令，并同步修改 workflow、root governance 和 workspace script 测试。
4. 当实现每个复杂变更时，维护者应先写因旧供应商能力仍存在或新迁移能力缺失而失败的测试，再做最小实现和重构。
5. 当 OpenAPI 发生变化时，维护者应只通过根 `contract:sync` 生成快照和类型，不得手工编辑生成产物。
6. 当交付验收时，Schema、migration replay、Server、Web、OpenAPI、构建和保留的 Browser E2E 应全部通过。

### Requirement 8 - 文档、Git 与发布边界

#### Acceptance Criteria

1. 当新方案实施时，系统应把 `specs/supplier-management/` 三份文档标记为已由本规格取代，并保留原决策和实现历史。
2. 当任务提交时，维护者应使用英文 Commit 类型和中文描述，并保持每个提交可独立构建和验证。
3. 当本地实施完成时，系统不应自动 push、创建 PR、merge、删除分支或部署。
4. 当需要对非本地数据库执行 migration 时，系统应要求独立的目标环境确认、备份与运维授权。

## 7. UI Design Specification

本次不创建新页面，只保留并复用既有字典管理界面；以下规格用于约束退役后不得出现新的平行设计。

```text
Purpose Statement:
  让基础数据管理员在既有字典工作区维护平铺供应商选项，消除重复的供应商管理入口和交互模型。

Aesthetic Direction:
  Industrial/utilitarian。

Color Palette:
  #FFFFFF（light background）、#09090B（foreground）、#F4F4F5（muted）、
  #E4E4E7（border）、#15803D（primary anchor）；运行时继续使用项目语义 Token 并适配暗色主题。

Typography:
  正文继续使用 Noto Sans SC；技术 code/value 继续使用 Noto Sans Mono。

Layout Strategy:
  不新增布局；继续使用字典页面左侧 18rem Type 导航与右侧弹性 Item 工作区，
  移动端继续使用底部 Drawer 和 Item 卡片。
```

系统继续复用 Fantastic-admin、Arco、Fa 和 Qs 组件，不新增 Emoji 图标、装饰性渐变、供应商专属颜色或第二套设计系统。

## 8. 明确不做

- 不保留供应商独立路由、页面、权限或 API。
- 不保留联系人、登记、地址、邮编、主体类型或创建幂等资料。
- 不把任何现有 Supplier 转换为 Dictionary Item，包括 `SUP/260805-001`。
- 不创建新的供应商表、历史归档表、JSON 扩展字段或兼容层。
- 不修改现有 DictionaryType、DictionaryItem 公共结构和 API。
- 不创建公共 Supplier Select；业务方直接消费通用 Dictionary Catalog。
- 不保留 `SUPPLIER` Numbering、ledger、Audit 数据或 Audit enum label。
- 不删除或改写旧 migration、Prisma migration ledger、Git commit、PR 或 CI 历史。
- 不重写 `main`，不修改分支保护，不 push、不创建 PR、不 merge、不部署。

## 9. Phase 1 已确认边界

以下边界已于 2026-08-09 确认，并作为 Phase 2 技术设计的输入：

1. 确认使用符合现有契约并与原“合作供方”领域一致的 Type code `service_provider.supplier`，而不是非法的裸 `SUPPLIER`。
2. 确认不迁移任何现有 Supplier 数据，目标 Dictionary Type 初始为空且停用。
3. 确认删除 `SUPPLIER` Rule、Version、PeriodState、Issuance ledger、Supplier 业务 Audit、该 Rule 的生命周期 Audit 和四个 Supplier Audit enum label，不创建任何替代或归档数据。
4. 确认唯一保留的是旧 migration/Prisma ledger 与 Git/PR/CI 历史；最终运行时和业务数据库不保留供应商专属能力。
