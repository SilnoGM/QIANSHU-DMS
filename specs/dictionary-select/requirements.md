# 通用字典下拉组件需求规格

## 1. 文档状态

- 状态：Phase 1、Phase 2 Gate B 与 Phase 3 已确认，Phase 4 本地验收已完成
- 需求确认日期：2026-08-10
- Gate B 确认日期：2026-08-10
- 本地最终验收日期：2026-08-10
- 适用范围：`web/apps/qsmds-arco`
- 组件名称：`QsDictionarySelect`
- 实施分支：`feat/dictionary-select`

## 2. 背景与目标

千树 DMS 已具备身份隔离、按需缓存和支持历史值解析的 Dictionary Catalog，但正式 Web 应用尚无统一的字典单选控件。若每个业务表单分别组合请求、搜索、错误、历史值和表单语义，容易出现默认误选、停用值被清空、迟到响应污染和无障碍属性失联等不一致行为。

本需求建立一个应用级、业务中立、可搜索的字典单选组件。组件复用既有 Catalog Provider 和 Consumer，只负责安全加载、选择与回显；调用页面继续拥有业务字段校验、保存、权限和领域映射，Server 继续作为字典值有效性的最终校验边界。

本规格是 `specs/dictionary-management/tasks.md` 中 Gate C 的一次独立范围扩展。原字典管理首期“不创建公共选择器”的历史边界保持原样；本规格只授权在新的阶段门禁下设计和实施该组件，不改变既有字典数据、管理功能或 Catalog 契约。

## 3. 用户故事

### 3.1 业务用户

作为业务用户，我希望在表单中搜索并选择当前有效的字典条目，同时能辨认旧记录中的停用或未知值，避免误改历史数据。

### 3.2 页面开发者

作为页面开发者，我希望通过稳定的 `v-model` 和 `dictionaryCode` 使用统一组件，而不重复实现 Catalog 请求、竞态、状态提示、表单提交和无障碍桥接。

### 3.3 系统维护者

作为系统维护者，我希望组件严格复用既有 Dictionary Catalog 契约，不引入新接口、硬编码选项或领域专用分支，并通过组件库和自动化测试保持一致行为。

## 4. 范围边界

### 4.1 本期范围

- 应用级单选组件 `QsDictionarySelect`。
- 响应式 `dictionaryCode`、按需加载、取消、迟到响应保护和重试。
- 按 Label 与稳定 `value` 的本地搜索。
- 有效条目选择、停用历史值和未知历史值回显。
- `v-model`、清空、禁用、表单提交、焦点和无障碍语义。
- 组件库 Showcase、定向测试和真实浏览器验收。
- 为满足上述契约而进行的最小 `FaCombobox` 公共能力加固，须在 Phase 2 Gate B 单独确认后才能实施。

### 4.2 本期不做

- 不新增或修改 Server API、OpenAPI、数据库 Schema、migration、权限或字典数据。
- 不实现多选、远程搜索、拼音搜索、分页、分组配置、树形级联或自定义选项渲染器。
- 不提供领域专用包装组件、硬编码字典编码或业务映射。
- 不在组件中执行 Mutation、权限判断或业务保存。
- 不新增 Store、第三方依赖、全局自动注册或跨应用共享包。
- 不把 Catalog 搜索文本作为业务字段值提交。
- 不接入具体业务页面；业务接入在组件完成后按调用方需求单独实施。

### 4.3 后续调用方责任

- 具体业务页面决定字段是否可空、使用哪个 `dictionaryCode`，并把组件值映射到自己的提交 DTO。
- 具体业务 Server 在新增或修改该字段的事务内调用既有 `DictionaryLookupService` 验证值当前有效。
- 上述业务集成不属于本期交付；本期只验证组件没有执行、绕过或声称替代这些领域职责。

## 5. 术语与状态口径

### 5.1 有效条目

只有 `effectiveEnabled=true` 的 Catalog Item 可以用于新选择。组件保持 Server 返回顺序，不按 Label 二次排序。

### 5.2 历史值

- `ACTIVE`：当前值命中有效条目，显示当前 Label。
- `DISABLED`：当前值命中但不再有效，显示当前 Label 和“已停用”。
- `UNKNOWN`：当前值未命中目录，原样显示 raw value 和“未知字典值”。

历史 raw value 不执行 trim、大小写转换或格式修正。

### 5.3 状态分类

- `loading`：当前字典正在加载或重新加载。
- `ready`：Catalog 已可信加载且至少存在一个当前有效候选。
- `empty`：Catalog 已可信加载但没有当前有效候选，是 loaded 状态的独立 UI 分支。
- `missing`：指定字典类型不存在。
- `error`：请求、身份或响应校验失败，Catalog 当前不可用。
- `invalid`：调用方提供的 `dictionaryCode` 不符合既有格式契约；它是可恢复的本地配置错误，不等同于 Server 返回的 missing。

## 6. 功能需求

### Requirement 1 - 组件分层与职责

#### Acceptance Criteria

1. 当页面需要选择平铺字典值时，Web 应提供名为 `QsDictionarySelect` 的统一应用级组件。
2. 当组件组织到正式应用时，系统应将其放入 `components/business` 并由调用方显式导入，不得放入 `web/packages/components` 或扩大自动注册范围。
3. 当组件加载字典时，组件应通过既有 Dictionary Catalog Consumer 和注入的 Provider 获取数据，不得直接调用 API、读取 Account Store 或复制缓存逻辑。
4. 当组件提供选项时，组件不得执行、绕过或声称替代调用方与 Server 的领域校验和持久化职责。
5. 当新增组件实现时，组件与测试不得包含特定业务域的硬编码 code、权限或 Label 映射。

### Requirement 2 - 最小公共契约

#### Acceptance Criteria

1. 当调用方使用组件时，组件应要求 `dictionaryCode: string` 并接受 `modelValue?: string | null`、`placeholder?: string`、`clearable?: boolean` 和 `disabled?: boolean`。
2. 当调用方未提供可选属性时，组件应以 `modelValue=null`、`placeholder="请选择"`、`clearable=false` 和 `disabled=false` 运行。
3. 当用户选择有效条目时，组件应把 `update:modelValue` 作为唯一值变更事件并返回该条目的稳定字符串 `value`。
4. 当用户明确清空可清空组件时，组件应触发 `update:modelValue` 并返回 `null`，不得返回空字符串或 `undefined`。
5. 当真实搜索输入获得或失去焦点时，组件应分别触发 `focus` 和 `blur`，并保留原始 `FocusEvent`。
6. 当调用方需要编程控制焦点时，组件应公开 `focus()` 和 `blur()`；真实 input 可用时应作用于该 input，caller disabled 时应安全 no-op，内部 unavailable 时 `focus()` 应落到可见状态或 retry。
7. 当调用方传入 `id`、`name`、`required`、`form`、与表单关联相关的 `aria-*`、`class`、`style` 或 `data-*` 时，组件应把属性传递到承担对应语义的真实 DOM 元素，不得静默丢失或错误提交搜索文本。
8. 当本期完成时，组件不应增加 `change`、`clear`、`load`、`error` 或 `retry` 等与 `v-model` 或内部状态重复的公共事件。

### Requirement 3 - 响应式字典加载

#### Acceptance Criteria

1. 当组件挂载时，系统应规范化 `dictionaryCode` 并按需读取唯一对应 Catalog，不得在应用登录时预取全部字典。
2. 当 `dictionaryCode` 在运行时切换到另一个规范 code 时，系统应立即作废旧请求所有权、清除旧目录视图并加载新 Catalog。
3. 当旧 code 的请求在切换后迟到完成时，系统不得把旧 Catalog、错误或 missing 状态写回当前组件。
4. 当输入 code 的大小写或边缘空白变化但规范 code 未变化时，系统不应发起重复加载。
5. 当 Provider 通知当前 code 精确失效或身份域发生变化时，系统应中止旧请求、清除旧快照并重新加载。
6. 当组件卸载时，系统应取消当前消费者请求所有权、取消后续调度并解除失效订阅。
7. 当目录加载、切换、失败或失效时，组件不得隐式修改或触发当前 `modelValue`。
8. 当 `dictionaryCode` 不符合既有格式契约时，组件应立即 Abort 旧请求所有权并进入独立的 `invalid` fail-closed 状态，保留当前 `modelValue`，禁止 Provider 请求、选择、清空和重试，并只显示不包含原始 code 的安全配置错误。
9. 当 `dictionaryCode` 从 invalid 切换为合法规范 code 时，组件应自动退出配置错误并加载对应 Catalog，无需重新挂载。
10. 当 `dictionaryCode` 切换到不同规范 code 或 invalid 状态时，组件应关闭已打开的 Popover 并清空内部搜索词，同时保留业务 `modelValue`。
11. 当输入 code 变化但规范 code 不变时，组件应保留当前搜索词、Popover 和焦点，不得重置交互会话。
12. 当旧请求迟到时，旧结果不得恢复已经清除的搜索词、Popover 或旧目录视图。

### Requirement 4 - 有效选项、顺序与搜索

#### Acceptance Criteria

1. 当 Catalog 成功加载时，组件应只把 `effectiveEnabled=true` 的 Item 作为新选择候选。
2. 当组件生成候选项时，组件应保持 Provider 返回顺序，不得按 Label、Tone 或本地语言重新排序。
3. 当用户输入搜索词时，组件应忽略搜索词边缘空白并以大小写不敏感方式同时匹配 Label 和稳定 `value`，不得发起远程搜索请求。
4. 当两个条目具有相同 Label 但不同 `value` 时，组件应稳定渲染并允许按各自 `value` 正确选择，不得使用 Label 作为唯一身份或 Vue key。
5. 当搜索没有匹配项时，组件应显示明确的“无匹配选项”空态，不得把第一项伪装成当前选择。
6. 当用户未选择任何条目时，组件应保持 `null`，不得自动选中第一项或创建默认值。

### Requirement 5 - 当前值与历史值安全回显

#### Acceptance Criteria

1. 当 `modelValue` 命中有效条目时，组件应显示当前 Label 并允许重新选择。
2. 当 `modelValue` 命中停用条目或停用类型下的条目时，组件应保留原始 `value`，显示当前 Label 和“已停用”，并禁止把该历史项作为新选择再次选中。
3. 当可信 Catalog 中不存在当前 `modelValue` 时，组件应原样显示 raw value 和“未知字典值”，并禁止选择该历史项。
4. 当组件仍在加载或 Catalog 暂时不可用时，组件应保留当前 raw value 的安全可见性，但不得提前断言其为有效、停用或未知。
5. 当外部更新 `modelValue` 时，组件应同步显示新值且不得回发一次等价的 `update:modelValue`。
6. 当历史值、目录状态或 Label 发生变化时，组件不得自动清空、规范化、替换或默认选择其他条目。
7. 当可信 Catalog 已加载且 `clearable=true` 时，用户可以明确清除停用或未知历史值。
8. 当当前值为停用或未知历史值时，组件应在有效项之后最多追加一个 value 不重复的 disabled 合成项，不得把该历史项混入可选择集合。

### Requirement 6 - 加载、空、缺失与错误状态

#### Acceptance Criteria

1. 当目录加载中时，组件应进入 fail-closed 状态，禁止新选择，并以 `role="status"` 提示“正在加载字典选项”。
2. 当 Catalog 存在但没有有效条目时，组件应显示“暂无可用选项”，并区分于搜索无结果。
3. 当指定字典类型不存在时，组件应显示稳定的“未配置该字典类型”状态，不提供无意义的重复重试。
4. 当目录请求或响应校验失败时，组件应以 `role="alert"` 显示安全错误文案，并提供可聚焦的“重试加载”操作。
5. 当用户触发重试时，组件应只重新读取当前规范 code，不得重放业务 Mutation 或恢复过期 Catalog。
6. 当加载、missing 或 error 状态存在时，组件应禁止打开候选列表和清空操作，避免在目录事实未知时产生新值变更。
7. 当 invalid 状态存在时，组件应显示区别于 missing 和网络错误的安全配置错误，不提供 retry；只有调用方修正 code 才能恢复。

### Requirement 7 - 表单与无障碍语义

#### Acceptance Criteria

1. 当组件位于 `FaFormItem` 或标准 `<label for>` 中时，Label、说明、错误和 required 语义应关联到真实 combobox input。
2. 当组件带有 `name` 时，表单应提交稳定 `modelValue`，不得提交用户输入的搜索文本或展示 Label。
3. 当组件被禁用时，真实 input、清空、展开、重试和表单代理均应停止交互，且禁用字段不得提交。
4. 当调用方提供 `aria-label`、`aria-labelledby`、`aria-describedby`、`aria-invalid`、`aria-required`、`aria-errormessage` 或 `aria-busy` 时，组件应把属性传给真实 combobox input，同时保留底层控件拥有的展开、控制目标和当前候选语义。
5. 当组件存在清空或展开图标按钮时，每个按钮应具有明确的可访问名称，不得只依赖图标形状。
6. 当用户使用键盘时，组件应支持聚焦、输入搜索、方向键导航、Enter 选择、Escape 关闭和 Tab 离开，不得形成焦点陷阱。
7. 当表单校验触发 `blur` 时，组件应只在真实输入失焦时向上游传递，不得因内部状态同步伪造失焦。
8. 当调用方传入 `class`、`style` 或 `data-*` 时，组件应只把这些属性应用到稳定 root；当调用方传入 `id`、`tabindex` 或已列明的表单 ARIA 时，组件应只把它们应用到真实 combobox input。
9. 当调用方传入 `name`、`form`、`required` 或由 `FaFormItem` 注入 `aria-required=true` 时，组件应使用彼此独立的原值提交代理和 required 验证代理承载语义，并把最终 required 状态派生为真实 combobox input 的 `aria-required=true`；搜索 input 不得带有业务 `name`。
10. 当 `modelValue=null` 且存在 `name` 时，启用状态的 FormData 应省略该字段；当 `modelValue` 为任意字符串（包括空字符串）时，FormData 应包含且只包含一个精确等于 raw value 的该 name entry。
11. 当 caller `disabled=true` 时，表单代理应被禁用且 FormData 不包含该字段；内部 loading、missing、error 或 invalid 不得使一个原本启用的字段从 FormData 中消失。
12. 当 `required=true` 或 `aria-required=true` 且 `modelValue=null` 时，原生提交应被阻止并显示安全校验提示；当 `modelValue` 为包括空字符串在内的任意字符串时，验证应把它视为已有历史 raw value；真实 input 可用时焦点应转到真实 input，不可用时焦点应转到可见状态或 retry。
13. 当 `FaForm` 通过注入到 root 的 `data-slot="form-control"` 执行 `scrollToField()` 或 `scrollToError()` 时，root 应把程序化焦点转发到可用的真实 combobox input；内部 unavailable 时应转发到可见状态或 retry，不得停留在不可编辑的包装节点。

### Requirement 8 - 视觉、响应式与主题

#### Acceptance Criteria

1. 当组件渲染时，系统应复用 Fantastic-admin、Fa 和项目语义 Token，不得建立第二套设计系统或硬编码运行时颜色。
2. 当视口宽度至少为 `640px` 时，控件应保持全宽、最小宽度为零并使用 `36px` 的现有表单高度。
3. 当视口宽度小于 `640px` 时，输入、候选项、清空和重试触控目标应至少为 `44px`，且不得产生页面级横向溢出。
4. 当系统处于暗色主题时，控件、Popover、边框、焦点、状态和禁用样式应保持可读对比度。
5. 当用户启用 Reduced Motion 时，加载和状态反馈应停止非必要动画，同时保留明确的文字状态。
6. 当组件展示状态时，系统应同时使用文字和语义视觉，不得只依赖颜色。
7. 当组件展示图标时，系统应使用项目现有 Lucide/FaIcon 能力，不得使用 Emoji。

### Requirement 9 - 安全、性能与失败边界

#### Acceptance Criteria

1. 当组件读取 Catalog 时，系统应继续使用包含身份域与 code 的既有内存缓存、TTL、请求合并和取消语义，不得另建持久化缓存。
2. 当组件收到错误时，界面、日志和测试输出不得包含 Token、Cookie、连接字符串、完整敏感请求体或不可信响应内容。
3. 当 Catalog 当前不可用时，组件不得回退到硬编码选项、旧 code 的目录或第一项默认值。
4. 当多个组件读取同一身份域和 code 时，系统应继续由 Provider 合并底层请求，而每个组件保持独立取消能力。
5. 当组件实现完成时，组件源码不得包含业务 Mutation、权限判断或替代 Server 字典有效性校验的逻辑。

### Requirement 10 - Showcase、测试与交付

#### Acceptance Criteria

1. 当组件进入正式应用时，组件库应新增独立“字典选择器”叶子路由，并使用中性 fixture code 展示正常、搜索、清空、外部模型、停用、未知、重复 Label、空、missing、错误重试、code 切换和禁用状态。
2. 当 Showcase 渲染时，示例应通过隔离 fixture Provider 驱动，不得写入真实字典数据或绑定业务页面。
3. 当新功能实施时，开发应先建立因缺少响应式 Consumer、组件行为或共享控件能力而失败的测试，再完成最小实现和重构。
4. 当 Web 单元测试运行时，系统应覆盖 code 切换、Abort、迟到响应、选项顺序、历史值、重复 Label、清空、错误重试、表单代理和无障碍属性。
5. 当真实 Browser E2E 运行时，系统应覆盖鼠标和键盘选择、重复 Label、清空、重试、code 切换、表单 Label/required/blur、亮暗主题、Reduced Motion 以及 `390x844` 触控和无横向溢出。
6. 当交付前验证时，Web 定向测试、完整 `check`、正式 `build`、根治理和 `git diff --check` 应全部通过；任何失败必须如实记录。

## 7. UI Design Specification

```text
Purpose Statement:
  为业务表单提供安全、可搜索且能够解释历史值的统一字典单选控件，
  降低各页面重复实现目录请求、错误处理和表单语义的成本。

Aesthetic Direction:
  Industrial/utilitarian。

Color Palette:
  #FFFFFF（light background）、#09090B（foreground）、#F4F4F5（muted）、
  #E4E4E7（border）、#15803D（primary anchor）；实现只使用现有主题语义 Token。

Typography:
  Label 与状态使用 Noto Sans SC；稳定 value 可使用 Noto Sans Mono。

Layout Strategy:
  原子表单控件采用全宽单列控制面，状态和重试紧邻字段下方；
  桌面保持现有紧凑表单节奏，窄屏扩大触控目标，不引入页面级居中卡片或装饰布局。
```

该需求是原子表单控件，不适用页面级打破网格要求；项目现有表单密度、主题 Token、Popover 规则和可访问性优先于装饰性布局。组件不使用渐变、Emoji、持续动画或额外视觉依赖。

## 8. 已确认公共边界

为完整满足 Requirement 4、Requirement 7 和 Requirement 8，Gate B 已确认对共享 `FaCombobox` 做以下最小、向后兼容的公共能力加固：

1. 平铺选项使用稳定 value 身份而不是 Label 作为 Vue key。
2. 提供白名单化的真实 input 属性入口，支持 `id`、`tabindex` 与必要 `aria-*`，但不允许搜索 input 承担业务 `name`。
3. 为清空和展开按钮提供可配置的 accessible label。
4. 向上透传真实 input 的 `focus`、`blur`，并公开 `focus()`、`blur()`。
5. Task 5 经单独确认追加可选 `contentClass`，且只作用于 Teleport 的内容层，用于领域组件局部拥有移动触控、长文本和 Reduced Motion 样式。

上述能力均已在确认边界内实施；`ComboboxInputAttrs` 保持私有类型，`contentClass` 未传入时不改变既有 DOM 和样式，不使用全局 DOM 查询作为默认方案。

## 9. Phase 4 本地验收结果

2026-08-10 基于冻结源码完成最终本地验收：定向测试 44/44、`FaCombobox` 契约 7/7、Web API/View 738/738、完整 Web 检查 958/958、Root governance 663/663、真实 Chrome Dictionary Browser 6/6；正式应用和三个参考应用的检查与构建均成功。构建仅保留既有第三方 pure annotation、chunk size 与 plugin timing 非阻断警告。

最终文件矩阵为 12 个新增、9 个修改、0 删除、0 重命名；未修改 Server、OpenAPI、数据库、权限、字典数据、依赖或具体业务页面。Browser 只使用一次性隔离 PostgreSQL，不访问或修改本地开发数据库。
