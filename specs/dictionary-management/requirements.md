# 系统字典管理需求规格

## 1. 文档状态

- 状态：Phase 1 与 Gate B 精确公共边界已确认，Task 5 至 Task 14 已完成，Task 15 待确认
- 需求确认日期：2026-08-02
- Phase 3 任务确认日期：2026-08-03
- Gate B 确认日期：2026-08-03
- 适用范围：千树 DMS Server 与 `web/apps/qsmds-arco`
- 正式入口：`/system/basic-data/dictionaries`
- 实施分支：`feat/dictionary-management`

## 2. 背景与目标

系统需要为低风险、可配置、平铺的业务选项提供统一维护与消费能力，避免各业务页面分别硬编码相同的 Label、状态和排序。系统字典不是任意配置中心，也不是把所有 enum、主数据和业务规则动态化的容器。

首期目标是建立全局两级 `DictionaryType -> DictionaryItem` 目录：管理员通过受权限保护的页面维护类型和条目；正常登录的业务用户通过只读 Catalog 解析选项；业务表只保存稳定 `value`，Server 在新建或改值事务内验证该值当前有效。

## 3. 范围边界

### 3.1 适合进入系统字典

- 低风险、可由业务管理员调整的平铺选项。
- 业务表只需要保存稳定字符串值的下拉、单选或标签型字段。
- Label、排序和语义色调可以随当前配置变化，且不要求按历史时点还原。

### 3.2 不进入系统字典

- 鉴权、角色、权限码和安全策略。
- 业务状态机、审批流和数据库约束。
- 货币、地区、编号规则以及其他已有独立模型的核心主数据。
- 金额、比例、税率、算法参数和需要强类型计算的值。
- 大规模、需要复杂检索、关联、导入导出或独立生命周期的主数据。

## 4. 术语与状态口径

### 4.1 Dictionary Type

`DictionaryType` 是一组业务选项的稳定命名空间，例如 `sales.channel`。其 `code` 是全局稳定身份，创建后不可修改。

### 4.2 Dictionary Item

`DictionaryItem` 是某个类型下的一个稳定选项。其 `value` 是业务表持久化的字符串身份，`label` 只用于当前展示。

### 4.3 自身状态与有效状态

类型和条目分别保存自身 `enabled` 状态。条目是否可用于新业务由以下公式派生，不另存字段：

```text
effectiveEnabled = dictionaryType.enabled && dictionaryItem.enabled
```

停用类型不得改写其条目的自身状态；类型重新启用后，原本自身启用的条目重新有效。

### 4.4 管理读取与业务消费

- 管理读取用于字典维护，要求 `dictionaries:read`，返回 UUID、版本、统计和时间戳。
- 业务消费用于正常业务页面，要求有效登录 Session，但不要求字典管理权限，也不暴露管理 UUID、版本或 Audit 字段。

## 5. 用户故事

### 5.1 基础数据管理员

作为基础数据管理员，我希望维护字典类型、选项、排序和状态，以便业务页面使用统一且可治理的选项目录。

### 5.2 业务用户

作为业务用户，我希望新建业务只看到当前有效选项，同时旧记录仍能安全显示已经停用或无法解析的历史值。

### 5.3 系统维护者

作为系统维护者，我希望稳定身份、并发、权限、Audit、缓存和数据库不变量均有明确边界，避免动态配置破坏业务数据完整性。

## 6. 功能需求

### Requirement 1 - 字典适用范围与结构

#### Acceptance Criteria

1. 当系统承载动态字典时，系统应只允许全局、低风险、可配置的平铺业务选项进入字典目录。
2. 当某类数据涉及鉴权、状态机、金额、算法、核心主数据或数据库约束时，系统应继续使用代码或独立 Schema 表达，不得迁入动态字典。
3. 当管理员建立字典时，系统应使用固定两级 `DictionaryType -> DictionaryItem` 结构。
4. 当首期功能完成时，系统不应提供租户、组织、树形层级、多语言表、有效期、审批、导入导出或任意 JSON 扩展能力。
5. 当系统部署首期 migration 时，系统不应创建任何业务字典类型或条目。

### Requirement 2 - 字典类型身份与生命周期

#### Acceptance Criteria

1. 当管理员创建字典类型时，系统应要求全局唯一的命名空间 `code`、名称、可选说明和非负排序值。
2. 当类型创建成功时，系统应将其自身状态设为停用且版本设为 `1`。
3. 当类型创建后，系统应禁止修改其 `id` 和 `code`。
4. 当管理员编辑类型时，系统应只允许修改名称、说明和排序。
5. 当管理员启用类型时，系统应确认其至少存在一个自身启用条目，否则拒绝操作且不产生部分写入。
6. 当管理员停用类型时，系统应保留全部条目及其自身状态。
7. 当类型不再用于新业务时，系统应支持停用且不提供物理删除或软删除能力。

### Requirement 3 - 字典条目身份与生命周期

#### Acceptance Criteria

1. 当管理员创建字典条目时，系统应要求所属类型、类型内唯一 `value`、Label、可选说明、白名单 Tone 和非负排序值。
2. 当条目创建成功时，系统应将其自身状态设为停用且版本设为 `1`，即使所属类型当前启用也不得自动启用新条目。
3. 当条目创建后，系统应禁止修改其 `id`、`dictionaryTypeId` 和 `value`。
4. 当管理员编辑条目时，系统应只允许修改 Label、说明、Tone 和排序。
5. 当类型停用而条目自身启用时，系统应返回 `effectiveEnabled=false`，但保留条目自身 `enabled=true`。
6. 当类型启用时，系统应禁止停用最后一个自身启用条目。
7. 当条目不再用于新业务时，系统应支持停用且不提供物理删除或软删除能力。
8. 当两个条目具有相同 Label 但不同 `value` 时，系统可以保存；Label 不得成为身份或业务关联键。

### Requirement 4 - 管理查询、写入与并发

#### Acceptance Criteria

1. 当管理员查看类型或条目时，系统应支持搜索、自身状态筛选、稳定排序和分页。
2. 当系统返回类型列表时，系统应包含条目总数、自身启用条目数和当前版本。
3. 当管理员执行更新、启用或停用时，客户端应携带 `expectedVersion`。
4. 当 `expectedVersion` 已过期时，系统应返回稳定 `409`，且不得覆盖较新的状态。
5. 当规范化后的更新没有实际变化时，系统应返回当前数据，不增加版本且不写 Audit。
6. 当并发操作类型和条目时，系统应固定按 `DictionaryType -> DictionaryItem` 顺序加锁。
7. 当网络错误导致写结果未知时，Web 应重新查询当前状态，不得自动重放 Mutation。
8. 当客户端尝试删除、修改稳定身份或移动条目时，系统应在 API 和数据库两层拒绝。

### Requirement 5 - 业务 Catalog 与历史值

#### Acceptance Criteria

1. 当正常登录用户读取单个字典 Catalog 时，系统应允许访问而不要求 `dictionaries:read`。
2. 当业务页面需要多个字典时，系统应支持一次读取最多 20 个唯一 `code`，不得在登录时获取全部字典。
3. 当 Catalog 返回已知类型时，系统应包含该类型的全部条目，包括停用类型和停用条目。
4. 当业务页面创建新记录时，页面应只提供 `effectiveEnabled=true` 的条目。
5. 当旧记录引用已停用条目时，页面应显示当前 Label 和明确的“已停用”状态。
6. 当旧记录的原始 `value` 无法解析时，页面应保留并显示原始值及“未知字典值”，不得清空、替换或伪装成默认选项。
7. 当管理员修改 Label 时，当前和历史记录应显示最新 Label；需要发生时 Label 的业务域应自行保存快照。
8. 当批量请求部分 `code` 不存在时，系统应返回其余成功目录及有序 `missingCodes`，不得使整批请求失败。

### Requirement 6 - Server 业务字段校验

#### Acceptance Criteria

1. 当业务模块新增或修改字典字段时，Server 应在同一业务事务内验证指定 `code/value` 当前有效。
2. 当业务字段未发生变化且历史值已经停用时，Server 应允许其他字段继续更新，不得强迫改写历史值。
3. 当业务模块校验新值时，系统应先锁定类型，再锁定条目，保证业务提交前该值不会并发失效。
4. 当业务模块需要历史解析时，系统应按原始 `value` 精确查询并允许返回停用描述符。
5. 当业务表持久化字典字段时，业务表应只保存规范化字符串 `value`，不得保存 Label 或字典内部 UUID。
6. 当 Server 内部消费字典时，业务模块应调用 `DictionaryLookupService`，不得通过 HTTP 调用自身 Catalog API。

### Requirement 7 - 权限、路由与菜单

#### Acceptance Criteria

1. 当用户访问字典管理读取接口或页面时，系统应要求 `dictionaries:read`。
2. 当用户执行创建、编辑、启用或停用时，系统应分别要求对应细粒度权限。
3. 当用户只有正常 Session 而没有管理权限时，系统应允许读取业务 Catalog，但所有管理接口应返回 `403`。
4. 当用户没有任何基础数据读取权限时，系统应过滤全部基础数据叶子，并隐藏空的“基础数据”父菜单。
5. 当无 `dictionaries:read` 的用户直接访问字典管理地址时，系统应进入统一 `403` 页面。
6. 当运行中动态撤销 `dictionaries:read` 时，页面应中止请求、清空受保护数据并关闭正在编辑的 Modal 或 Drawer。

### Requirement 8 - Audit、安全与错误边界

#### Acceptance Criteria

1. 当类型或条目创建、更新、启用或停用成功时，系统应在同一数据库事务写入对应 Audit 事件。
2. 当 Audit 写入失败时，系统应回滚业务写入。
3. 当更新没有实际变化或业务写入失败时，系统不应写成功 Audit。
4. 当系统记录 Audit metadata 时，系统应只记录 `dictionaryCode`、`itemValue`、排序后的 `changedFields` 和版本等稳定标量。
5. 当系统处理请求或错误时，响应、日志、OpenAPI 和测试输出不得泄露 SQL、连接字符串、Cookie、Token、密码、堆栈或完整敏感请求体。
6. 当数据库返回未知约束或驱动错误时，系统应映射为安全的 `INTERNAL_ERROR`，不得透传底层异常。
7. 当系统返回非健康检查响应时，响应应保持 `Cache-Control: private, no-store`。

### Requirement 9 - Web Catalog 缓存与失效

#### Acceptance Criteria

1. 当 Web 缓存 Catalog 时，系统应使用包含 `authEpoch`、`userId` 和 `code` 的身份隔离 Key。
2. 当首次使用某个 `code` 时，Provider 应按需加载并使用 5 分钟内存 TTL，不得写入持久化存储。
3. 当多个消费者同时读取同一 Key 时，Provider 应合并底层请求，同时保持每个消费者独立取消语义。
4. 当最后一个消费者取消时，Provider 应中止对应底层请求。
5. 当身份切换、登出或 generation 变化时，Provider 应阻止迟到响应写入新身份缓存。
6. 当字典管理写入成功时，Provider 应只失效受影响 `code`，并向同源标签页发送严格格式的失效消息。
7. 当 Provider 收到跨标签失效消息时，Provider 应只在本地失效，不得再次广播形成回路。
8. 当 Catalog 网络请求失败时，Provider 不应缓存失败结果或回退到硬编码字典。

### Requirement 10 - 字典管理页面与体验

#### Acceptance Criteria

1. 当管理员进入字典管理页时，页面应使用单一 `FaPageHeader + FaPageMain`，不得叠加第二套页面容器。
2. 当视口为桌面尺寸时，页面应使用左侧 `18rem` 类型列表和右侧自适应条目区域的主从布局。
3. 当视口为窄屏时，类型列表应进入底部 `QsGenericDrawer`，条目应使用移动卡片而不是压缩桌面表格。
4. 当管理员维护条目时，页面应复用 `QsGenericTable` 的加载、错误、空态、分页和移动卡片能力。
5. 当管理员创建、编辑或启停时，领域 Modal 应明确显示目标、不可变身份、风险和提交状态。
6. 当用户选择不同类型时，页面应只更新本地选中状态，不写 `?code=`，避免 `route.fullPath` 变化导致整页重挂载。
7. 当页面显示状态时，系统应同时使用文字和语义色，不得只依赖颜色。
8. 当用户使用键盘、暗色主题、Reduced Motion 或 `390x844` 视口时，页面应保持可操作、焦点可恢复、触控目标至少 44px 且无横向溢出。

### Requirement 11 - Migration、零种子与回滚

#### Acceptance Criteria

1. 当实施数据库结构时，系统应新增一条 forward migration，不得修改、删除或重命名已有 migration。
2. 当 migration 创建表、enum、约束、索引、Trigger、权限和管理员授权时，所有变化应在一个严格事务内完成。
3. 当 migration 追加 Audit enum 时，事务内自检应只读取 `pg_enum.enumlabel`，不得在提交前强制转换或使用新 enum 值。
4. 当 migration 完成时，系统应自检结构、五项权限、五项管理员授权、八个 Audit enum 以及两张业务表均为空。
5. 当 migration 编写冲突处理时，系统不得使用 `IF NOT EXISTS`、`ADD VALUE IF NOT EXISTS` 或 `ON CONFLICT DO NOTHING` 隐藏历史漂移。
6. 当应用需要回退时，系统应回退 Server/Web 而保留新增表、权限和 enum；数据库问题通过新的 forward migration 修复，不执行破坏性 down/drop。
7. 当生产环境需要实际 migration 时，系统应要求独立运维审批、备份、目标数据库确认和部署记录。

### Requirement 12 - 测试、OpenAPI 与交付门禁

#### Acceptance Criteria

1. 当实现新功能时，每个任务应先建立因能力缺失而失败的测试，再做最小实现、重构和绿色提交。
2. 当 Server 契约完成时，系统应只通过根 `contract:sync` 更新 Server/Web snapshot 和 generated types，不得手工编辑生成产物。
3. 当数据库测试运行时，系统应使用隔离 PostgreSQL，验证完整 migration replay、二次 deploy、约束、Trigger、权限和并发最终状态。
4. 当 API E2E 运行时，系统应覆盖管理/消费权限矩阵、生命周期、版本冲突、Audit 回滚、无 DELETE 和 `private, no-store`。
5. 当 Web 单元测试运行时，系统应覆盖 API Recorder、运行时白名单、身份缓存、TTL、Abort、迟到响应、精确失效和历史值解析。
6. 当 Browser E2E 运行时，系统应覆盖桌面、`390x844`、亮暗主题、权限、跨标签失效、焦点、44px 和无横向溢出。
7. 当功能接入 CI 时，系统应新增字典 Browser Job 并纳入 `CI gate`，同步根脚本和工作流治理测试。
8. 当交付完成时，只有精确 HEAD SHA 的全部适用 Job 和 `CI gate` 成功后，系统维护者才能报告 CI 已通过。

## 7. 权限目录

```text
dictionaries:read
dictionaries:create
dictionaries:update
dictionaries:enable
dictionaries:disable
```

管理权限不影响正常登录用户读取业务 Catalog。

## 8. UI Design Specification

```text
Purpose Statement:
  为基础数据管理员提供安全、可审计的全局字典维护入口，并让业务用户可靠解析当前与历史选项。

Aesthetic Direction:
  Industrial/utilitarian。

Color Palette:
  #FFFFFF（light background）、#09090B（foreground）、#F4F4F5（muted）、
  #E4E4E7（border）、#15803D（primary anchor）；运行时必须通过项目语义 Token 使用并适配暗色主题。

Typography:
  正文使用 Noto Sans SC；code、value 和技术元数据使用 Noto Sans Mono。

Layout Strategy:
  桌面使用左侧固定 18rem 类型导航与右侧弹性工作区的非对称主从布局；
  移动端将左侧导航迁入底部 Drawer，条目改为卡片，不采用居中堆叠统计卡。
```

页面复用现有 Fantastic-admin、Arco、Fa 与 Qs 组件，不使用 Emoji 图标、装饰性渐变、任意颜色元数据或第二套设计系统。

## 9. 明确不做

- 不做租户或组织隔离。
- 不做树形字典、级联字典或跨类型依赖。
- 不做多语言 Label 表。
- 不做生效时间、历史版本、审批或发布流程。
- 不做导入导出、批量编辑或拖拽排序。
- 不做默认项、任意 JSON、HTML、CSS、图标或脚本配置。
- 不提供物理删除或软删除。
- 不预置 `region.administrative_type`、销售渠道或其他虚构业务种子。
- 不迁移现有 User、Region、Currency、Numbering 或 Audit enum 到字典。
- 不在首期创建公共 `QsDictionarySelect`。
- 不在首期修改全局路由 key 或提供字典类型 URL 深链。

## 10. 已确认边界与持续门禁

本需求、技术方向、任务拆解以及以下 Gate B 公共边界已于 2026-08-03 整体确认，实施仍须按 `tasks.md` 的任务顺序逐项推进：

1. Prisma model、enum 和 forward migration。
2. 公共 API、DTO、response、operationId 和错误码。
3. 五项权限、八项 Audit enum 和管理员授权。
4. `DictionaryLookupService` 的内部公共契约。

Gate B 不授权 Gate C 范围；公共 Qs/Fa 组件 API、第三方依赖、Pinia、全局路由 key、公共 Dictionary Select、生产变更及 Git 发布动作仍须按任务计划暂停并单独确认。
