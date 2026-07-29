# 系统货币与当前汇率管理需求

## 1. 文档状态

- 状态：已确认
- 确认日期：2026-07-29
- 适用范围：千树 DMS Server 与 `web/apps/qsmds-arco`
- 固定基准币：CNY

## 2. 背景与目标

系统需要维护可用于业务金额录入和展示的货币目录，并维护非人民币货币换算为人民币的当前比例。货币目录必须同时成为 `MoneyInput` 与 `AmountDisplay` 的唯一运行时真相源，避免输入、展示分别维护币种、符号和金额小数位。

首期只维护每个非 CNY 货币的一条当前汇率，不提供有效期、历史版本、实时行情或任意货币对换算。

## 3. 术语与数据口径

### 3.1 `minorUnit`

`minorUnit` 表示该货币金额允许和展示的小数位数：

- 允许范围为整数 `0..4`。
- 初始 CNY、TWD、MYR、USD 均为 `2`。
- 该值只约束金额，不约束汇率精度。

### 3.2 人民币换算比例

技术字段固定命名为 `foreignUnitsPerCny`，表示每 `1 CNY` 对应多少单位外币：

```text
cnyAmount = foreignAmount / foreignUnitsPerCny
foreignAmount = cnyAmount * foreignUnitsPerCny
```

例如 `foreignUnitsPerCny = "4.8"` 时：

```text
4.8 TWD = 1 CNY
438 TWD / 4.8 = 91.25 CNY
```

示例值仅用于解释公式，不得写入生产迁移。

### 3.3 状态

非 CNY 货币只允许以下状态：

```text
停用未配置 -> 停用已配置 -> 启用已配置
```

系统不得产生“启用未配置”状态。

## 4. 用户故事

### 4.1 基础数据管理员

作为基础数据管理员，我希望维护货币及其人民币换算比例，以便业务录入只使用已配置且可换算的货币。

### 4.2 业务用户

作为业务用户，我希望金额输入与金额展示使用相同的货币名称、符号和小数位，以免出现录入规则与展示规则不一致。

### 4.3 系统维护者

作为系统维护者，我希望金额和汇率以十进制字符串跨边界，并由数据库、服务端和测试共同保护关键不变量。

## 5. 功能需求

### Requirement 1 - 固定人民币基准币

#### Acceptance Criteria

1. 当初始迁移执行时，系统应创建固定 CNY 货币且保持启用。
2. 当客户端尝试停用 CNY 时，系统应拒绝操作且不产生部分写入。
3. 当客户端尝试为 CNY 创建汇率时，系统应拒绝操作。
4. 当系统表示基准币时，应由 `code === "CNY"` 派生，不提供多基准币配置能力。
5. 当系统处理 CNY 换算时，应使用隐含比例 `1`，不创建 ExchangeRate 行。

### Requirement 2 - 货币主数据

#### Acceptance Criteria

1. 当管理员创建货币时，系统应要求三位大写 ASCII code、名称、`minorUnit` 和排序值。
2. 当货币创建成功时，系统应默认将其设为停用。
3. 当 code 已存在时，系统应返回稳定冲突错误。
4. 当货币创建完成后，系统应禁止普通 API 修改 id、code 和 `minorUnit`。
5. 当管理员更新货币时，系统应只允许更新名称、英文名、符号和排序。
6. 当货币不再用于新业务时，系统应支持停用且不提供物理删除 API。

### Requirement 3 - 当前汇率

#### Acceptance Criteria

1. 当管理员查看汇率管理时，系统应列出所有非 CNY 货币及其当前汇率或“未配置”状态。
2. 当停用的非 CNY 货币尚未配置汇率时，管理员应能够为其创建当前汇率。
3. 当非 CNY 已有汇率时，系统应只允许更新唯一当前行，不创建第二条当前汇率。
4. 当汇率为零、负数、非法格式或超过精度时，系统应拒绝写入。
5. 当汇率创建或修改成功时，新值应立即成为后续换算的当前比例。
6. 当首期完成时，系统不应提供有效期、预约生效、历史版本或汇率删除能力。

### Requirement 4 - 启停依赖

#### Acceptance Criteria

1. 当管理员启用非 CNY 货币时，系统应在同一事务内确认其存在合法当前汇率。
2. 当汇率不存在时，系统应返回 `CURRENCY_EXCHANGE_RATE_REQUIRED` 且保持货币停用。
3. 当管理员停用外币时，系统应保留其当前汇率。
4. 当外币停用后，系统应使其退出新建业务的可选货币集合。
5. 当历史数据引用停用货币时，系统应继续解析其名称、符号和 `minorUnit`。

### Requirement 5 - 统一货币目录

#### Acceptance Criteria

1. 当正常登录用户请求货币目录时，系统应允许访问而不要求 `currencies:read`。
2. 当货币目录返回时，系统应包含启用和停用货币及其展示元数据。
3. 当 `MoneyInput` 消费货币目录时，组件应只允许选择启用货币。
4. 当 `AmountDisplay` 消费货币目录时，组件应允许展示启用或停用货币。
5. 当目录加载失败或 code 无法解析时，组件不得回退到硬编码货币、CNY 符号或固定两位小数。
6. 当管理写成功时，应用层应使本标签页及同源标签页的货币目录缓存失效。

### Requirement 6 - 动态金额输入与展示

#### Acceptance Criteria

1. 当 `MoneyInput` 使用某个货币时，金额校验精度应来自该货币 `minorUnit`。
2. 当用户切换货币时，组件不得自动换算、舍入或改写金额。
3. 当当前货币已停用时，编辑旧数据的输入组件应保留该值并将其标记为不可重新选择。
4. 当 `AmountDisplay` 格式化金额时，应使用动态 symbol、code 和 `minorUnit`。
5. 当金额跨组件或 API 传递时，精确金额值应保持 `string | null`，Decimal 实例不得越过公共边界。

### Requirement 7 - 初始数据

#### Acceptance Criteria

1. 当 seed migration 执行时，系统应创建 CNY、TWD、MYR、USD 四种货币。
2. 当 seed migration 完成时，系统应只启用 CNY。
3. 当 seed migration 完成时，四种货币的 `minorUnit` 应均为 `2`。
4. 当 seed migration 完成时，ExchangeRate 行数应为 `0`。
5. 当迁移失败时，系统应整体回滚，不使用静默跳过冲突的迁移策略。

### Requirement 8 - 权限、审计与并发

#### Acceptance Criteria

1. 当用户访问管理 API 时，系统应分别校验货币和汇率的细粒度权限。
2. 当写操作提交时，客户端应携带 `expectedVersion`，过期版本应返回稳定 `409`。
3. 当 Currency 与 ExchangeRate 同时参与事务时，系统应按 Currency 到 ExchangeRate 的顺序加锁。
4. 当货币或汇率写入成功时，系统应在同一事务写入对应 Audit 事件。
5. 当 Audit 写入失败时，系统应回滚业务写入。
6. 当网络错误导致写结果未知时，页面应重新查询当前状态，不自动重放写操作。

### Requirement 9 - 页面与体验

#### Acceptance Criteria

1. 当用户访问货币管理页时，系统应展示名称、code、符号、小数位、汇率状态、启停状态、排序与更新时间。
2. 当用户访问汇率管理页时，系统应明确展示 `1 CNY = X CODE` 和外币除以比例的公式。
3. 当比例未配置时，页面应显示“未配置”，不得使用 `0` 或 `1` 代替。
4. 当页面在 1440px 或 390px 视口下使用时，关键操作应可用且不得出现横向溢出。
5. 当用户使用键盘或暗色主题时，页面应保持可访问和可辨识。

## 6. 权限目录

```text
currencies:read
currencies:create
currencies:update
currencies:enable
currencies:disable
exchange-rates:read
exchange-rates:create
exchange-rates:update
```

## 7. UI 设计规格

- Purpose：安全维护高影响货币主数据和人民币换算比例。
- Aesthetic Direction：Industrial/utilitarian。
- Color Palette：复用项目 `background`、`foreground`、`muted`、`border`、`destructive` 语义 Token。
- Typography：正文使用 `Noto Sans SC`，金额、比例和 code 使用 `Noto Sans Mono`。
- Layout：复用 `FaPageHeader + FaPageMain + QsGenericTable`，公式说明靠左、管理操作靠右。
- 禁止引入装饰性渐变、堆叠统计卡或第二套设计系统。

## 8. 明确不做

- 不接入银行、央行或第三方实时行情。
- 不做有效期、历史版本、预约生效或审批流。
- 不做多基准币和任意货币对换算。
- 不提供公共 `/convert` API。
- 不提供 Currency 或 ExchangeRate 删除 API。
- 不修改尚未提出的业务表去引用 Currency。
- 不按当前汇率回算未来的历史业务记录。
