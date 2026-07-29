# 编号管理需求规格

## 1. 文档状态

- 状态：已确认
- 确认日期：2026-07-29
- 目标页面：`/system/basic-data/numbering`
- 适用范围：千树 DMS Server 与 `web/apps/qsmds-arco`
- 固定业务时区：`Asia/Shanghai`
- 首期边界：管理编号规则，并通过 Server 内部服务供后续业务域生成编号

## 2. 背景与目标

系统需要建立统一的编号规则中心，用于描述、发布和执行后续业务域的编号策略，避免各业务模块分别实现前缀、日期、流水号和随机码逻辑。

首期需要实现：

1. 组合固定字符、日期、分隔符、自增数字和随机字符串，形成可发布的编号规则。
2. 展示规则当前周期容量、已使用量、剩余量和下一编号提示。
3. 在并发、重试和版本切换场景下，保证同一规则生成的编号不重复。
4. 通过 Nest 内部 `NumberingGeneratorService` 供后续业务域调用。
5. 保留永久发号台账，用于唯一性、幂等、统计和问题追溯。

系统不承诺连续无断号。正式发号一旦成功即视为已占用，不提供回收、作废后复用或手工重置能力。

## 3. 术语与数据口径

### 3.1 编号规则

编号规则由稳定的 `ruleCode` 标识。`ruleCode` 在规则层唯一，规则的所有版本共用同一个 `ruleCode`；不同规则可以生成相同的编号文本，系统只保证同一规则内编号唯一。

### 3.2 规则版本

规则版本保存配置快照；`DRAFT` 可编辑，`ACTIVE` 和 `RETIRED` 是不可变的已发布快照。版本状态为：

```text
DRAFT -> ACTIVE -> RETIRED
```

同一规则最多存在一个 `DRAFT` 版本和一个 `ACTIVE` 版本。

### 3.3 规则片段

首期支持五类有序片段：

```text
FIXED       固定字符
DATE        日期
SEPARATOR   分隔符
SEQUENCE    自增数字
RANDOM      随机字符串
```

规则至少包含一个 `SEQUENCE` 或 `RANDOM` 片段，保证存在可消费的唯一编号空间。

### 3.4 周期与重置

`resetPolicy` 支持：

```text
NEVER
YEARLY
MONTHLY
DAILY
```

周期边界、日期片段和发号时间统一使用数据库事务时间，并固定转换到 `Asia/Shanghai`。非 `NEVER` 规则必须在输出中包含足以区分对应周期的日期信息，避免不同周期生成相同文本。

### 3.5 容量和使用量

- `capacity`：统计来源配置在当前周期内可提供的理论编号容量；优先使用 `ACTIVE`，无 `ACTIVE` 时使用 `DRAFT` 理论值。
- `usedCount`：当前周期已经成功占用的编号数量；幂等重放不重复计数。
- `remainingCount`：`capacity - usedCount`，最小为 `0`。
- `lifetimeUsedCount`：规则自创建以来成功发放的编号总数。
- `nextSequenceValue`：包含自增片段时，下一次可分配的十进制序列值。
- `nextNumberPreview`：只读提示，不占号、不保留，并发下可能立即失效。

容量、用量、剩余量和序列值均可能超过 `Number.MAX_SAFE_INTEGER`，跨公共边界必须使用十进制字符串。

### 3.6 发号与幂等

每次正式发号由 `consumerCode + idempotencyKey` 标识一次调用语义：

- 同一组合重复调用且请求语义一致时，返回第一次生成的编号。
- 同一组合被用于不同规则或不同请求语义时，返回幂等冲突。
- 原始 `idempotencyKey` 不持久化、不记录日志、不写审计，只保存 Hash。

## 4. 用户故事

### 4.1 基础数据管理员

作为基础数据管理员，我希望用可视化方式编排、预览、发布和启停编号规则，并查看容量和使用情况，以便安全维护各业务域的编号策略。

### 4.2 后续业务域开发者

作为业务域开发者，我希望通过稳定的内部服务和幂等契约生成编号，以便在重试和高并发场景下仍获得唯一结果。

### 4.3 系统维护者与审计人员

作为系统维护者或审计人员，我希望查询规则版本和永久发号记录，以便定位配置变化、容量耗尽、幂等冲突和编号来源。

## 5. UI 设计规格

### 5.1 Purpose Statement

编号管理是一个高影响基础数据页面，核心任务是让管理员准确理解规则结构、容量边界和发布状态，并在正式生效前通过预览发现配置错误。

### 5.2 Aesthetic Direction

`Industrial/utilitarian`。页面强调高信息密度、稳定层级、清晰状态和可审计操作，不使用装饰性视觉噱头。

### 5.3 Color Palette

复用项目已有 `background`、`foreground`、`muted`、`border`、`primary`、`warning` 和 `destructive` 语义 Token，同时适配亮色与暗色主题；不得硬编码另一套品牌色或引入紫色系渐变。

### 5.4 Typography

- 中文正文与表单：`Noto Sans SC`
- `ruleCode`、编号预览、容量和序列值：`Noto Sans Mono`
- 不新增全局字体，不覆盖现有排版体系

### 5.5 Layout Strategy

- 列表页使用单一 `FaPageHeader + FaPageMain + QsGenericTable`。
- 规则编排使用右侧 `QsGenericDrawer size="xl"`，形成“左侧片段配置、右侧实时预览与容量”的非对称工作区。
- 发布、启用、停用和放弃未保存修改使用 `QsGenericModal`。
- 桌面端使用表格，窄屏使用 `QsGenericTable` 移动卡片；不得堆叠统计卡或引入第二套设计系统。

## 6. 功能需求

### R1 - 规则身份与生命周期

**User Story：** 作为管理员，我希望通过稳定编码和清晰状态维护规则，以便后续业务域不会因改名或版本切换失去调用目标。

#### Acceptance Criteria

1. 当管理员创建规则时，编号管理系统应要求唯一且稳定、匹配 `^[A-Z][A-Z0-9_]{0,63}$` 的 `ruleCode`、名称和合法配置，并将规则创建为 `DRAFT`。
2. 当规则名称或说明与另一规则相同时，编号管理系统应允许保存，不建立跨规则文本唯一约束。
3. 当 `ruleCode` 已存在时，编号管理系统应拒绝创建并返回 `NUMBERING_RULE_CODE_ALREADY_EXISTS`。
4. 当规则拥有可用的活动版本时，编号管理系统应允许其从 `DRAFT` 或 `DISABLED` 进入 `ENABLED`。
5. 当规则已启用时，编号管理系统应允许停用并保留全部版本、周期状态和发号记录。
6. 当管理员不再使用规则时，编号管理系统应只提供停用，不提供物理删除。
7. 当管理员克隆规则时，编号管理系统应要求新的 `ruleCode`，复制配置为新的 `DRAFT` 规则，并且不复制周期状态或发号记录。

### R2 - 模板片段与配置校验

**User Story：** 作为管理员，我希望组合明确类型的片段，以便构造符合业务语义且能够验证容量的编号模板。

#### Acceptance Criteria

1. 当管理员编排规则时，编号管理系统应支持 `FIXED`、`DATE`、`SEPARATOR`、`SEQUENCE` 和 `RANDOM` 五类片段。
2. 当规则保存或预览时，编号管理系统应按连续位置保存和渲染片段，且首期最多允许 `32` 个片段。
3. 当规则不包含 `SEQUENCE` 或 `RANDOM` 时，编号管理系统应拒绝配置。
4. 当规则包含多个 `SEQUENCE` 或多个 `RANDOM` 时，编号管理系统应拒绝配置。
5. 当 `FIXED` 片段为空、超过 `64` 个字符或包含 `[A-Z0-9]` 之外的字符时，编号管理系统应拒绝配置。
6. 当 `SEPARATOR` 片段不是 `-`、`_`、`.` 或 `/` 时，编号管理系统应拒绝配置。
7. 当某类片段携带其他类型专属字段或缺少本类型必填字段时，编号管理系统应拒绝配置。
8. 当规则的最大输出长度超过 `64` 个 ASCII 字符时，编号管理系统应拒绝保存和发布。
9. 当管理员调整片段顺序时，编号管理页面应同时提供鼠标和键盘可操作的上移、下移能力，不得只依赖拖拽。

### R3 - 日期、固定时区与重置周期

**User Story：** 作为管理员，我希望日期和重置边界使用统一时钟，以便不同运行节点生成相同口径的周期编号。

#### Acceptance Criteria

1. 当系统计算日期片段或当前周期时，编号管理系统应使用同一数据库事务的 `transaction_timestamp()`。
2. 当数据库时间参与渲染时，编号管理系统应固定转换为 `Asia/Shanghai`，不得使用浏览器或 Nest 进程本地时区。
3. 当客户端创建、更新或预览规则时，编号管理系统不应接受可编辑的 timezone 字段。
4. 当管理员选择日期格式时，编号管理系统应只接受已确认的 `YYYY`、`YY`、`MM`、`DD`、`YYYYMM`、`YYYYMMDD` 和 `YYMMDD`。
5. 当 `resetPolicy=YEARLY` 时，编号管理系统应要求输出包含四位年份 `YYYY`。
6. 当 `resetPolicy=MONTHLY` 时，编号管理系统应要求输出包含四位年份 `YYYY` 和月份 `MM`。
7. 当 `resetPolicy=DAILY` 时，编号管理系统应要求输出包含四位年份 `YYYY`、月份 `MM` 和日期 `DD`。
8. 当非 `NEVER` 规则包含 `YY` 或 `YYMMDD` 日期片段时，编号管理系统应拒绝配置；两位年份格式首期只允许用于 `NEVER`，避免永久台账在百年周期后产生歧义。
9. 当规则只有 `RANDOM` 而没有 `SEQUENCE` 时，编号管理系统应要求日期变化粒度与 reset period 完全一致：`NEVER` 不得包含日期、`YEARLY` 只包含四位年、`MONTHLY` 包含四位年和月且不包含日、`DAILY` 包含四位年/月/日。
10. 当上海时区跨日、跨月或跨年时，编号管理系统应从新的 period key 读取或创建周期状态，并且不得修改历史周期。

### R4 - 自增数字

**User Story：** 作为管理员，我希望配置位数、起始值和步长，以便得到可预测且可统计的流水号。

#### Acceptance Criteria

1. 当管理员配置 `SEQUENCE` 时，编号管理系统应要求宽度为 `1..18`、起始值为非负十进制整数、步长为正十进制整数。
2. 当起始值或步长超过当前宽度允许的最大值时，编号管理系统应拒绝配置。
3. 当序列值位数小于配置宽度时，编号管理系统应在左侧补 `0`。
4. 当宽度为 `w`、起始值为 `s`、步长为 `p` 时，编号管理系统应按 `floor((10^w - 1 - s) / p) + 1` 计算容量。
5. 当宽度为 `6`、起始值为 `1`、步长为 `2` 时，编号管理系统应依次使用 `000001`、`000003`、`000005`。
6. 当下一序列值超过该宽度允许的最大值时，编号管理系统应返回 `NUMBERING_CAPACITY_EXHAUSTED`，不得回绕或重新从起始值发号。
7. 当规则同时包含 `SEQUENCE` 和 `RANDOM` 时，编号管理系统应以序列容量作为有效容量上限。

### R5 - 随机字符串

**User Story：** 作为管理员，我希望配置大写字母和数字长度及排列方式，以便生成容量可计算的随机编号。

#### Acceptance Criteria

1. 当管理员配置 `RANDOM` 时，编号管理系统应允许分别设置大写英文字母长度和数字长度，单项范围为 `0..32` 且总长度至少为 `1`、最多为 `32`。
2. 当随机模式为 `LETTERS_THEN_DIGITS` 时，编号管理系统应先输出精确数量的 `[A-Z]`，再输出精确数量的 `[0-9]`。
3. 当随机模式为 `SHUFFLED` 时，编号管理系统应在保持字母和数字精确数量的同时随机排列所有位置。
4. 当模式为 `LETTERS_THEN_DIGITS` 时，编号管理系统应按 `26^L * 10^D` 计算随机容量。
5. 当模式为 `SHUFFLED` 时，编号管理系统应按 `C(L+D,L) * 26^L * 10^D` 计算随机容量。
6. 当系统生成随机片段时，编号管理系统应使用密码学安全随机源，不得使用 `Math.random()`。
7. 当随机候选在同一规则内发生编号冲突时，编号管理系统应最多重试 `32` 次。
8. 当 `32` 次随机候选均冲突时，编号管理系统应返回 `NUMBERING_GENERATION_RETRY_EXHAUSTED`，且不得增加使用量。

### R6 - 版本、预览与发布

**User Story：** 作为管理员，我希望在不影响当前活动规则的情况下编辑和预览草稿，再原子发布新版本。

#### Acceptance Criteria

1. 当规则创建时，编号管理系统应同时创建 revision `1` 的 `DRAFT` 版本和有序片段。
2. 当已启用规则被编辑时，编号管理系统应创建或更新唯一 `DRAFT` 版本，且当前 `ACTIVE` 版本继续发号。
3. 当管理员发布草稿时，编号管理系统应在同一事务中将旧 `ACTIVE` 变为 `RETIRED`、将草稿变为 `ACTIVE`。
4. 当管理员提交 mutation 时，编号管理系统应校验 `expectedVersion`；过期版本应返回 `NUMBERING_RULE_STATE_CHANGED`。
5. 当规则已经成功发号时，编号管理系统应禁止改变片段类型与顺序、固定内容、日期配置、分隔符配置、随机配置、重置策略、序列起始值和步长。
6. 当规则已经成功发号且序列宽度需要调整时，编号管理系统应只允许扩大宽度，不允许缩小。
7. 当业务需要新的编号空间或重新从起始值开始时，编号管理系统应要求创建或克隆为新的 `ruleCode`，首期不提供计数器重启。
8. 当管理员请求预览时，编号管理系统应完成与发布相同的配置校验并返回样例、容量和长度，但不得创建或修改周期状态和发号记录。

### R7 - 容量、使用量与下一编号

**User Story：** 作为管理员，我希望看到明确的数据口径，以便在容量耗尽前扩容或切换规则。

#### Acceptance Criteria

1. 当管理员查看规则列表或详情时，编号管理系统应返回统计来源、当前 period key、`capacity`、`usedCount`、`remainingCount` 和 `lifetimeUsedCount`。
2. 当规则存在 `ACTIVE` 版本时，编号管理系统应始终基于 `ACTIVE` 计算在线统计，即使同时存在 `DRAFT` 或规则已经 `DISABLED`。
3. 当初建规则只有 `DRAFT` 而没有 `ACTIVE` 时，编号管理系统应返回 `statisticsSource=DRAFT` 的理论统计，`usedCount=0`，且不得创建 period state。
4. 当规则包含序列片段且当前周期尚有容量时，编号管理系统应返回十进制字符串 `nextSequenceValue`。
5. 当序列规则当前周期已经耗尽时，编号管理系统应返回 `nextSequenceValue=null` 和 `nextNumberPreview=null`。
6. 当规则是纯随机规则时，编号管理系统应返回 `nextSequenceValue=null` 和 `nextNumberPreview=null`。
7. 当规则同时包含序列和随机片段时，编号管理系统可以返回使用下一序列值生成的非保留样例，并明确其不是已占用编号。
8. 当读取容量和下一编号提示时，编号管理系统不得推进计数、保留随机值或写发号记录。
9. 当发生幂等重放时，编号管理系统应返回原编号，且 `usedCount` 和 `lifetimeUsedCount` 不得重复增加。
10. 当剩余容量为 `0` 时，编号管理系统应将当前周期派生状态显示为 `EXHAUSTED`，但不得覆盖规则自身的 `ENABLED` 或 `DISABLED` 状态。
11. 当容量或使用量超过 JavaScript 安全整数范围时，Server、OpenAPI 和 Web 应保持原始十进制字符串，不得转换为 `number`。

### R8 - 唯一、幂等和原子发号

**User Story：** 作为业务域开发者，我希望并发调用和网络重试不会产生重复编号或重复消耗容量。

#### Acceptance Criteria

1. 当后续业务域发号时，编号管理系统应要求 `ruleCode`、`consumerCode` 和 `idempotencyKey`。
2. 当接收 `consumerCode` 时，编号管理系统应只接受匹配 `^[A-Z][A-Z0-9._-]{0,63}$` 的规范值，不得静默执行 trim、大小写转换或 Unicode 规范化。
3. 当接收 `idempotencyKey` 时，编号管理系统应要求其 UTF-8 编码后为 `1..200` bytes，并将其视为不透明值；不得执行 trim、大小写转换或 Unicode 规范化，Hash 必须基于原始 UTF-8 bytes。
4. 当相同语义的幂等记录已经存在时，编号管理系统应优先返回原结果，即使规则后来停用或发布了新版本。
5. 当首次调用没有命中幂等记录且规则不存在、未启用或没有活动版本时，编号管理系统应拒绝发号并返回 `NUMBERING_RULE_UNAVAILABLE` 或 `NUMBERING_RULE_NOT_FOUND`。
6. 当多个请求并发使用不同幂等键时，编号管理系统应保证同一规则生成的编号全部唯一。
7. 当多个请求并发使用同一 `consumerCode + idempotencyKey` 且请求语义一致时，编号管理系统应只创建一条发号记录并向所有调用返回同一编号。
8. 当同一 `consumerCode + idempotencyKey` 被用于不同规则时，编号管理系统应返回 `NUMBERING_IDEMPOTENCY_CONFLICT`。
9. 当发号事务失败、超时或回滚时，编号管理系统不应留下部分周期推进或发号记录。
10. 当正式发号事务提交时，编号管理系统应永久占用该编号，不提供回收和复用。
11. 当不同规则生成相同文本时，编号管理系统应允许成功；当同一规则生成重复文本时，编号管理系统应拒绝并按稳定错误收口。

### R9 - 后续业务域调用契约

**User Story：** 作为业务域开发者，我希望使用稳定的内部服务生成编号，而不把高风险发号能力暴露为公共 HTTP 接口。

#### Acceptance Criteria

1. 当后续 Nest 业务模块需要生成编号时，系统应通过可注入的 `NumberingGeneratorService` 提供能力。
2. 当首期 OpenAPI 生成时，系统不应出现 `/generate` 或等价公共发号接口。
3. 当内部发号成功时，服务应返回编号、规则编码、规则 revision、发号时间和是否幂等重放。
4. 当内部发号失败时，服务应返回稳定业务错误，不应泄露 SQL、约束详情、连接信息或原始幂等键。
5. 当调用方业务在发号成功后未完成自身写入时，编号管理系统不应自动回收已提交编号；调用方应使用同一幂等键安全重试。

### R10 - 管理 API 与稳定错误

**User Story：** 作为管理页面调用方，我希望通过明确的管理契约读取和维护规则。

#### Acceptance Criteria

1. 当管理页面加载时，Server 应提供规则列表、详情、版本历史和发号历史查询。
2. 当管理员维护规则时，Server 应提供预览、创建、更新、发布、启用、停用和克隆操作。
3. 当管理 API 发布到 OpenAPI 时，每个 operation 应具有稳定 `operationId`、成功响应、`X-Request-Id` 和适用错误矩阵。
4. 当列表或历史查询接收分页、筛选和排序参数时，Server 应使用白名单和稳定 UUID tie-breaker。
5. 当客户端请求物理删除规则、版本、周期状态或发号记录时，Server 不应提供对应 DELETE API。
6. 当持久化层返回未知错误时，Server 应收口为安全 `INTERNAL_ERROR`，不得解析并暴露数据库 message 或 detail。

### R11 - 权限、审计和安全

**User Story：** 作为系统管理员，我希望按操作分配权限，并能审计高影响配置变化。

#### Acceptance Criteria

1. 当用户访问编号管理页面或读取管理数据时，系统应校验 `numbering-rules:read`。
2. 当用户创建、更新、发布、启用或停用规则时，系统应分别校验对应细粒度权限；查询发号记录时应同时校验 `numbering-rules:read` 和 `numbering-rules:read-issuances`。
3. 当规则创建、更新、发布、启用或停用成功时，系统应在同一事务写入通用管理审计事件。
4. 当通用审计写入失败时，系统应回滚对应管理写操作。
5. 当正式发号成功时，系统不应为每次生成写入通用 `AuditEvent`，而应写入永久 `NumberingIssuance`。
6. 当通用审计按现有保留策略清理时，系统不应清理发号台账或影响容量和使用量。
7. 当管理页面展示发号记录时，系统不应返回原始幂等键、幂等 Hash 或请求指纹 Hash。
8. 当运行时权限被撤销时，Web 应中止相关请求、清除数据并关闭无权操作上下文。
9. 当用户克隆规则时，Server 应同时要求 `numbering-rules:read` 和 `numbering-rules:create`，防止通过克隆读取无权访问的来源配置。

### R12 - 编号管理页面

**User Story：** 作为基础数据管理员，我希望在一个页面完成规则查询、编排、发布和追溯。

#### Acceptance Criteria

1. 当用户进入 `/system/basic-data/numbering` 时，页面应展示规则名称与 `ruleCode`、结构预览、规则状态、活动 revision、容量、已使用量、下一编号提示和更新时间。
2. 当用户搜索、筛选、分页或排序时，页面应使用 Server 查询并防止旧响应覆盖新状态。
3. 当用户创建、编辑或克隆规则时，页面应在 `QsGenericDrawer size="xl"` 中提供片段编排、固定时区说明、实时校验、服务端预览和容量信息。
4. 当用户发布、启用或停用规则时，页面应使用 `QsGenericModal` 明确显示目标名称、`ruleCode` 和影响。
5. 当用户没有某项操作权限时，页面应隐藏或禁用对应入口，并且 Server 应继续独立执行权限校验。
6. 当用户同时拥有 `numbering-rules:read` 和 `numbering-rules:read-issuances` 时，页面应允许查询发号记录；缺少任一权限时不得发出对应请求。
7. 当页面在桌面和 `390px` 窄屏使用时，关键内容和操作应可用且不得出现页面横向溢出。
8. 当用户使用键盘、暗色主题或 `prefers-reduced-motion` 时，页面应保持可操作、可辨识，并且状态不得只依赖颜色表达。
9. 当页面实现时，系统应复用 `QsGenericTable`、`QsGenericDrawer`、`QsGenericModal`、`QsToast`、Fantastic-admin、Arco 和现有主题 Token，不修改共享组件公共 API，除非另行确认。
10. 当页面完成时，系统不应提供“生成正式编号”按钮；页面预览不得替代业务域正式发号。

### R13 - 测试、可观测性与交付

**User Story：** 作为系统维护者，我希望编号能力有可重复的自动化验证和真实浏览器证据。

#### Acceptance Criteria

1. 当开始实现新能力时，开发过程应先增加能因目标能力缺失而失败的测试，再完成最小实现并恢复绿色。
2. 当数据库结构实现时，测试应覆盖空库 migration replay、约束、索引、权限、审计类型和永久发号台账。
3. 当发号能力实现时，测试应覆盖序列、随机、混合、周期切换、容量耗尽、随机碰撞、幂等和 `100` 并发请求。
4. 当管理 API 实现时，测试应覆盖权限、CSRF、`expectedVersion`、错误矩阵、请求 ID 和不存在公共生成接口。
5. 当 Web 页面实现时，测试应覆盖大整数精确展示、请求取消、乱序响应、权限撤销、未知 mutation 结果和版本冲突恢复。
6. 当进行浏览器验收时，系统应覆盖桌面、`390px`、亮暗主题、键盘、焦点恢复、无横向溢出和无控制台错误。
7. 当交付完成时，最新 Server、OpenAPI、Web、Browser 和根级门禁应全部通过；任一失败必须如实记录。

## 7. 权限目录

```text
numbering-rules:read
numbering-rules:create
numbering-rules:update
numbering-rules:publish
numbering-rules:enable
numbering-rules:disable
numbering-rules:read-issuances
```

## 8. 稳定错误码

```text
NUMBERING_RULE_NOT_FOUND
NUMBERING_RULE_CODE_ALREADY_EXISTS
NUMBERING_RULE_STATE_CHANGED
NUMBERING_RULE_UNAVAILABLE
NUMBERING_CAPACITY_EXHAUSTED
NUMBERING_IDEMPOTENCY_CONFLICT
NUMBERING_OUTPUT_CONFLICT
NUMBERING_RULE_CONFIG_INVALID
NUMBERING_GENERATION_RETRY_EXHAUSTED
```

## 9. 非功能需求

- 所有生成路径必须事务化，锁等待上限固定为 `2s`，语句上限固定为 `5s`。
- 随机源必须来自 Node.js `crypto`，并允许测试注入确定性实现。
- 发号台账永久保留；首期不做分区，但必须提供规则、周期和倒序历史查询索引。
- 管理写入和发号路径不得记录密钥、Cookie、连接字符串、原始幂等键或完整敏感请求体。
- Server 与 Web 继续通过 HTTP/OpenAPI 协作，不跨依赖域引用源码。
- 编号和容量计算不得依赖 JavaScript 浮点数。

## 10. 明确不做

- 不提供公共 HTTP 发号接口。
- 不提供规则、版本、周期状态或发号记录的物理删除。
- 不提供手工修改下一值、回退计数器、重启计数器或复用已发编号。
- 不承诺无断号。
- 不做审批流、预约发布、批量导入、批量发号或外部号码池。
- 不做多租户或组织隔离；当前仓库尚无租户模型。
- 不开放自定义 timezone，固定使用 `Asia/Shanghai`。
- 不支持小写随机字母、任意 Unicode 固定字符或自定义分隔符。
- 不修改尚未提出的业务表去保存编号。
- 不修改 `QsGenericTable`、`QsGenericDrawer` 或 `QsGenericModal` 公共契约。

## 11. 已确认决策

1. 使用 `NumberingRule + NumberingRuleVersion + NumberingRuleSegment + NumberingPeriodState + NumberingIssuance` 五表模型。
2. `ruleCode` 在规则层稳定唯一，版本共用同一编码。
3. 固定时区为 `Asia/Shanghai`，时间真相源为数据库事务时间。
4. 随机模式支持 `LETTERS_THEN_DIGITS` 和 `SHUFFLED`，默认 `SHUFFLED`。
5. 输出最长 `64` 个 ASCII 字符；固定字符为 `[A-Z0-9]`，分隔符为 `- _ . /`。
6. 大整数在 OpenAPI 和 Web 中使用十进制字符串。
7. 正式发号只通过内部服务，不提供 HTTP generate endpoint。
8. 原始幂等键只保存 Hash；发号台账永久保留。
9. `EXHAUSTED` 是当前周期派生状态，不是规则生命周期状态。
10. 首期不删除、不回收、不重启计数器。
