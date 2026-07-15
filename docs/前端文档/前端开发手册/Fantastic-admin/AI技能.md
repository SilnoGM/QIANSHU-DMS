# Fantastic-admin AI 技能

## 介绍

Fantastic-admin 将高频开发任务写成可审查的 `SKILL.md`，让 Agent 在生成代码前先理解目录、组件、路由和配置约定。本项目的真实执行依据是 `web/skills/<name>/SKILL.md` 及其 `references/`，官方页面用于理解上游意图，不得覆盖本地路径和专业版差异。

本项目覆盖的九个 Skill 均已存在于 `web/skills/`。其中 `fa-i18n-manager` 的官方文档属于专业版能力；本地专业版 Skill 可用，但不能因此宣称公开 [`basic@v6.3.0`](https://github.com/fantastic-admin/basic/tree/v6.3.0) 也包含该实现。

官方来源：[Fantastic-admin AI 技能介绍](https://fantastic-admin.hurui.me/guide/skills.md)。

## 共同安全与执行规则

1. **先读再做**：执行前完整读取对应 `web/skills/<name>/SKILL.md`，只按它指向的 `references/` 补充细节。
2. **应用定位按本地 Skill 分流**：`fa-form-builder`、`fa-framework-settings`、`fa-i18n-manager`、`fa-page-optimizer`、`fa-route-generator`、`fa-slot-creator`、`fa-store-generator` 这七个 Skill 默认正式应用 `web/apps/qsmds-arco`；`fa-crud-page-generator` 和 `fa-theme-customizer` 是例外，用户未指定目标应用时仍按各自本地 Skill 先确认，不由本手册替它们默认。`web/examples/*` 只读；只有用户精确点名某个参考应用并明确要求修改，才能写入该目录。
3. **先确认输入和文件清单**：不从模糊需求推测 API、路由、字段、权限或数据结构；写入前读取已有目标，防止覆盖用户工作。
4. **不扩大授权**：Skill 触发只代表应使用对应工作流，不代表已获准修改公共 API、数据结构、数据库 schema 或删除文件；这些动作仍须单独确认。
5. **不泄露敏感信息**：不向提示、代码、日志或生成文件写入真实 token、密码、连接字符串、Cookie、`.env` 内容或专业版授权信息。
6. **遵守 UI 职责**：标准业务表单、表格、分页、按钮和反馈默认使用 Arco Design Vue；Fantastic-admin 内置组件只用于框架壳、框架交互，或需求明确且经本地 README/源码确认的 Pro 特有能力。Skill 中的 Fa* 模板不是正式应用的业务 UI 选型授权。
7. **人工负责验收**：官方 Skill 页没有为每个 Skill 规定独立验证命令。本手册将本地 Skill 契约、项目通用检查与运行时回归组合为验收方案，Agent 输出不能替代人工代码审查。

正式应用通过 `web/apps/qsmds-arco/src/ui/provider/index.ts` 的 `app.use(ArcoVue)` 全局注册 Arco Design Vue。执行会生成或改写页面 UI 的 Skill 时，按下表转换默认 Fa* 业务 UI；`FaPageMain` 等框架页面壳可以保留，`FaIconPicker`、日期、可视化和动画等显式 Pro 能力只在需求确实需要时采用。下表只是组件职责映射，不得只替换组件名；表单还必须完成后续 props、校验、提交和插槽语义适配。

| Skill 默认 Fa 输出 | 正式业务页面默认实现 |
| --- | --- |
| `FaForm / FaFormItem` | `AForm / AFormItem` |
| `FaTable` | `ATable` |
| `FaPagination` | `APagination` |
| `FaButton` | `AButton` |
| `FaToast / useFaToast` | Arco `Message / Notification` |
| `FaModal / useFaModal` | `AModal / Modal` |

### Arco 表单语义适配

本节以本地 `@arco-design/web-vue@2.58.0` 的 `form.d.ts`、`form-item.d.ts` 和实现为准。将 Fa 表单改为 Arco 时不得只替换组件名，必须同时处理以下契约：

1. **校验规则**：`AForm` 没有 vee-validate 的 `validation-schema` prop。将原 `validation-schema` / zod 校验意图转换为 `AForm` 的 `rules` 或 `AFormItem` 的字段级 `rules`；需要继续使用 zod 判断时，写成 Arco `FieldRule.validator(value, callback)`，在 `safeParse` 后以 `callback()` 表示通过、`callback(message)` 表示失败，不能把 typed schema 直接传给 Arco。
2. **字段和值绑定**：`FaFormItem name="account"` 改为 `AFormItem field="account"`；`AForm` 绑定 `:model="model"`，每个输入控件显式使用 `v-model="model.account"` 或等价字段路径。不能依赖 `FaFormItem` 的自动控件注入来同步值。
3. **命令式提交**：Arco form ref 没有 `FormExpose.submit()`。命令式流程改用 Arco form ref 的 `validate()`；该方法校验通过时返回 `undefined`，失败时返回字段错误记录，只有没有错误时才调用业务 API。
4. **HTML submit**：也可以使用 `AForm` 实际支持的原生表单提交链路：`AButton html-type="submit"` 触发表单后，成功监听 `@submit-success`，失败监听 `@submit-failed`；前者参数是 `values, event`，后者是 `{ values, errors }, event`。`@submit` 会在两种结果下都触发并收到 `{ values, errors }, event`，不能把它误写成只在成功时执行的事件。
5. **插槽和自动注入**：`FaFormItem` 默认插槽的 `componentField`、首控件自动绑定，以及 `description` / `message` 插槽都不能原样搬到 `AFormItem`。移除 `#default="{ componentField }"` 和相关 `v-bind`，按 Arco 的 `default`、`label`、`help`、`extra` 插槽重写；这些 Arco 插槽不提供 Fa 的插槽参数，控件值与事件仍由显式 `v-model` 和业务 handler 绑定。

通用静态验证命令为：

```bash
pnpm -C web run check
pnpm -C web run build
```

涉及交互、布局、主题、路由、保活或持久化时，还必须运行 `pnpm -C web run dev` 并由人工核对实际行为。

## fa-crud-page-generator

| 维度 | 项目化约定 |
| --- | --- |
| 用途 | 生成包含列表、搜索、分页、新增、编辑和删除的标准业务模块，可选 `router`、`modal` 或 `drawer` 详情模式。 |
| 何时使用 | 用户要求“XX 管理”、列表增删改查或标准 CRUD 模块时；只需独立表单时改用 `fa-form-builder`。 |
| 应用定位 | 这是确认例外：用户未指定目标应用时，必须保留本地 Skill 的“先查看 `web/apps/` 再确认”流程，不默认写入 `web/apps/qsmds-arco`。 |
| 必需输入 | 明确目标 `apps/<app>`、模块中英文名、`src/views/` 下存放路径、真实字段契约、详情模式、批量删除、fake、路由与 i18n 需求。 |
| 默认输出 | `web/apps/<app>/src/views/{path}/{module}/list.vue`、`detail.vue`（仅 `router`）、`components/DetailForm/index.vue`、`src/api/modules/{name}.ts`，可选 `src/api/fake_modules/{name}.fake.ts`、`src/router/modules/*.ts` 与 `src/locales/lang/route/*.json`。 |
| UI 落地 | 复用该 Skill 的 CRUD 工作流、文件清单、详情模式和失败传播结构，但不直接采用其默认 Fa* 业务 UI 输出；标准表单、表格、分页、普通按钮和反馈按共同映射改为 Arco，框架页面壳和明确需要的 Pro 能力除外。`DetailForm.submit(): Promise<boolean>` 对外契约可以保留，但内部必须改用 Arco form ref 的 `validate()`：存在 errors 时返回 `false`，校验通过且业务提交成功后才返回 `true`，不得继续调用 `FormExpose.submit()`。 |
| 只读与风险边界 | `web/examples/*` 只读；不修改 `web/packages/components/`；先列出目标文件并读取已有内容。生成 API client 不等于获准新增服务端公共 API，也不允许自行补出字段。 |
| 人工复核与验证 | 检查表单校验失败时不关闭容器、请求路径与 OpenAPI 一致、列表查询与分页参数正确；再执行通用 `check`、`build` 与完整 CRUD 运行回归。 |

本地真相源：`web/skills/fa-crud-page-generator/SKILL.md` 和 `web/skills/fa-crud-page-generator/references/templates.md`。官方概述将 fake 结果简写为 `api/modules` 下的文件，本地 Skill 明确要求 `src/api/fake_modules/`，本项目以后者为准。

官方来源：[fa-crud-page-generator](https://fantastic-admin.hurui.me/guide/skills/fa-crud-page-generator.md)。

## fa-form-builder

| 维度 | 项目化约定 |
| --- | --- |
| 用途 | 生成包含初始值、校验和提交操作区骨架的独立 Router 表单页，并复用本地 Skill 的字段收集、校验意图与失败传播结构。 |
| 何时使用 | 资料页、设置页、注册页或独立编辑页，且不需列表与 CRUD 配套文件时。 |
| 应用定位 | 默认正式应用 `web/apps/qsmds-arco`，无需重复询问；参考应用仍须精确点名并明确授权。 |
| 必需输入 | 模块中英文名、`src/views/` 下存放路径、字段名/类型/中文标签/必填性，以及单列或双列布局。 |
| 默认输出 | `web/apps/qsmds-arco/src/views/{path}/{name}/index.vue`。路由与真实 API 接入不在该 Skill 的默认输出内。 |
| UI 落地 | 复用该 Skill 的字段收集、校验、布局和提交工作流，但不直接采用其默认 Fa* 业务 UI 输出，并且不得只替换组件名：将 `validation-schema` / zod 转为 Arco `rules` 或字段 `validator`，将 `name` 转为 `field`，控件显式 `v-model` 到 form `model`；将 `FormExpose.submit()` 改为 Arco form ref 的 `validate()`，或使用 `html-type="submit"` 配合 `@submit-success` / `@submit-failed`；移除 `componentField` 自动注入并按 Arco 插槽参数重写 `default`、`label`、`help`、`extra`。 |
| 只读与风险边界 | `web/examples/*` 只读，`web/packages/*` 不承载业务表单与业务校验。未提供真实契约时，提交处只保留待接入边界，不生造 API、动态选项或上传地址。 |
| 人工复核与验证 | 复核 zod 规则、初始值类型、中文可见文案、响应式单/双列布局、提交失败传播与取消行为；再执行通用命令和浏览器表单回归。 |

本地真相源：`web/skills/fa-form-builder/SKILL.md` 和 `web/skills/fa-form-builder/references/templates.md`。

官方来源：[fa-form-builder](https://fantastic-admin.hurui.me/guide/skills/fa-form-builder.md)。

## fa-framework-settings

| 维度 | 项目化约定 |
| --- | --- |
| 用途 | 管理认证、路由模式、布局、功能开关、主题、菜单、顶栏、标签栏、工具栏和页面行为等框架设置。 |
| 何时使用 | 任务涉及 `src/settings.ts`，或用户要求切换水印、锁屏、菜单模式、标签栏风格、工具栏功能、布局或现有主题时。 |
| 应用定位 | 默认正式应用 `web/apps/qsmds-arco`，只读取和修改该应用的 `src/settings.ts`。 |
| 必需输入 | 当前期望、要改的设置域与具体效果；执行前读取正式应用 `src/settings.ts`、设置类型和默认值。 |
| 默认输出 | 仅修改 `web/apps/qsmds-arco/src/settings.ts`，并且只保留与框架默认值不同的项目定制。 |
| 只读与风险边界 | `web/examples/*`、`web/packages/settings/src/types.ts` 和 `web/packages/settings/src/default.ts` 只读。“创建新主题”不属于单纯设置切换，应改用 `fa-theme-customizer`。 |
| 人工复核与验证 | 核对类型与默认值，确认没有冗余覆盖；执行通用命令，再在亮/暗色、PC/移动布局和相关功能入口中人工检查。 |

本地真相源：`web/skills/fa-framework-settings/SKILL.md`、`web/skills/fa-framework-settings/references/*.md`、`web/apps/qsmds-arco/src/settings.ts` 和 `web/packages/settings/src/default.ts`。

官方来源：[fa-framework-settings](https://fantastic-admin.hurui.me/guide/skills/fa-framework-settings.md)。

## fa-i18n-manager

| 维度 | 项目化约定 |
| --- | --- |
| 用途 | 新增或检查翻译 key、添加语言、管理 RTL、为路由或组件接入 i18n，以及启用工具栏语言切换。 |
| 何时使用 | 页面需要多语言、语言文件缺 key、路由标题需要 i18n、需要新语言或语言切换器时。 |
| 应用定位 | 默认正式应用 `web/apps/qsmds-arco`；公共框架语言包是否需要同步，仍按 key 归属单独判断。 |
| 必需输入 | key 归属（公共框架、应用路由、应用业务或应用覆盖）、目标语言、真实中英文文案、是否检查缺失 key、是否启用切换器。 |
| 默认输出 | 按归属修改 `web/packages/locales/lang/app/**/*.json` 或 `web/apps/qsmds-arco/src/locales/lang/**/*.json`；添加语言时可修改 `src/locales/index.ts`，启用切换器时可修改 `src/settings.ts`，检查场景输出缺失报告。 |
| 只读与风险边界 | `web/examples/*` 只读。业务文案不因“可能复用”就下沉到 `web/packages/locales`；新增语言还需核对 Arco locale 和日期 locale，不自行翻译不确定的业务术语。 |
| 人工复核与验证 | 对比所有目标语言 key 集，实际切换语言，核对路由、组件、Arco 组件与 RTL 布局；再执行通用命令。 |

本地真相源：`web/skills/fa-i18n-manager/SKILL.md`、`web/skills/fa-i18n-manager/references/locale-structure.md` 和 `adding-language.md`。当前应用使用 `vue-i18n` Composition API 模式，实际配置位于 `web/apps/qsmds-arco/src/locales/index.ts`。

官方来源：[fa-i18n-manager](https://fantastic-admin.hurui.me/guide/skills/fa-i18n-manager.md)。

## fa-page-optimizer

| 维度 | 项目化约定 |
| --- | --- |
| 用途 | 分析已有 Vue 页面，在保持业务行为的前提下，按项目 UI 职责收敛原生 HTML、重复弹层、分页、空态和加载实现。 |
| 何时使用 | 用户要求优化已有页面、统一框架交互、替换自定义弹窗/分页/加载，且希望保留现有业务行为时。 |
| 应用定位 | 默认正式应用 `web/apps/qsmds-arco`，目标页面位于其 `src/views/`；参考应用写入仍须精确授权。 |
| 必需输入 | 目标页面精确路径、希望优化的区域、是否允许拆分局部组件，以及必须保持的 API、权限、状态与交互契约。 |
| 默认输出 | 修改 `web/apps/qsmds-arco/src/views/**/*.vue`，必要时在同一业务模块的 `components/` 下拆分局部组件。 |
| UI 落地 | 复用该 Skill 的页面分析、替换机会识别和行为对比工作流，但不直接采用其默认 Fa* 业务 UI 输出；普通表单、表格、分页、按钮和反馈使用 Arco，只有框架壳、框架交互和明确的 Pro 能力使用 Fa*。 |
| 只读与风险边界 | `web/examples/*` 只读；Fa 组件 API 以 `web/packages/components/src/basic/<component>/README.md`、`web/packages/components/src/pro/<component>/README.md` 和源码为准，不猜 props 或 events。该 Skill 不得覆盖根手册中“Arco 承载标准业务 UI、Fa 承载框架壳与框架交互”的职责边界。 |
| 人工复核与验证 | 对比改前后 API 调用、权限分支、表单状态和交互结果，核对 props、`v-model`、slots 与 events；执行通用命令并做视觉、键盘和响应式回归。 |

本地真相源：`web/skills/fa-page-optimizer/SKILL.md`、`web/skills/fa-page-optimizer/references/components-catalog.md` 和 `optimization-patterns.md`。

官方来源：[fa-page-optimizer](https://fantastic-admin.hurui.me/guide/skills/fa-page-optimizer.md)。

## fa-route-generator

| 维度 | 项目化约定 |
| --- | --- |
| 用途 | 新增或修改 Vue Router 路由，配置菜单、权限、徽章、面包屑、标签合并、活动菜单与页面保活。 |
| 何时使用 | 新页面需要导航，或现有列表/详情的菜单显隐、标签、权限、高亮和缓存行为需要调整时。 |
| 应用定位 | 默认正式应用 `web/apps/qsmds-arco`，路由与导航事实只从该应用读取。 |
| 必需输入 | 页面文件、真实 route path、唯一 name、中文标题或 i18n key、所属导航分组，以及权限、保活、菜单显隐和标签行为。 |
| 默认输出 | 新增 `web/apps/qsmds-arco/src/router/modules/<name>.ts`，并在 `src/router/routes.ts` 注册；修改场景只调整现有路由和 `meta`。 |
| 只读与风险边界 | `web/examples/*` 只读。先读取 `src/settings.ts` 的 `app.routeBaseOn`；值为 `backend` 时前端路由文件会被忽略，不继续生成。route path、权限和 i18n key 不得自行发明。 |
| 人工复核与验证 | 确认一级 path 以 `/` 开头、子路由 path 不以 `/` 开头、name 全局唯一；实际验证菜单显隐、`activeMenu`、权限、保活和标签行为，再执行通用命令。 |

本地真相源：`web/skills/fa-route-generator/SKILL.md`、`web/skills/fa-route-generator/references/route-meta.md`、`examples.md` 和 `web/apps/qsmds-arco/src/router/`。

官方来源：[fa-route-generator](https://fantastic-admin.hurui.me/guide/skills/fa-route-generator.md)。

## fa-slot-creator

| 维度 | 项目化约定 |
| --- | --- |
| 用途 | 在布局、头部、主/次侧边栏、标签栏、工具栏或自由定位区域注入自定义内容，共支持 19 个约定位置。 |
| 何时使用 | 用户要求在 logo、头部、侧边栏、顶栏或全局页面上下方加入公告、切换器、操作或悬浮内容时。 |
| 应用定位 | 默认正式应用 `web/apps/qsmds-arco`，只在该应用的 `src/slots/` 创建或修改插槽。 |
| 必需输入 | 精确 SlotName、中文可见内容、交互要求、布局影响与响应式要求；悬浮元素还需定位和层级约束。 |
| 默认输出 | `web/apps/qsmds-arco/src/slots/<SlotName>/index.vue`。 |
| 只读与风险边界 | `web/examples/*` 只读，带业务语义的布局内容不下沉到 `web/packages/*`。目录名必须与 SlotName 完全一致且区分大小写，入口必须是 `index.vue`；`FreePosition` 必须显式定位。 |
| 人工复核与验证 | 核对 `web/apps/qsmds-arco/src/slots/index.ts` 的自动发现结果，在真实布局中检查宽窄屏、键盘、遮挡与 `FreePosition` 定位，再执行通用命令。 |

本地真相源：`web/skills/fa-slot-creator/SKILL.md`、`web/skills/fa-slot-creator/references/slot-positions.md` 和 `web/apps/qsmds-arco/src/slots/index.ts`。

官方来源：[fa-slot-creator](https://fantastic-admin.hurui.me/guide/skills/fa-slot-creator.md)。

## fa-store-generator

| 维度 | 项目化约定 |
| --- | --- |
| 用途 | 生成 Composition API 风格的 Pinia Store，支持 state、computed、异步 action 和按字段持久化。 |
| 何时使用 | 真实数据需要跨页面共享、刷新后保留或在组件外访问时；单组件局部状态不应为此提升为全局 Store。 |
| 应用定位 | 默认正式应用 `web/apps/qsmds-arco`，业务 Store 不写入参考应用或共享 packages。 |
| 必需输入 | Store 用途、真实 state 字段/类型/初始值、需持久化的精确字段、computed 规则，以及异步 action 所依赖的已有 API 契约。 |
| 默认输出 | 业务 Store 写入 `web/apps/qsmds-arco/src/store/modules/<name>.ts`；只有框架内部状态才写入 `src/store/modules/app/<name>.ts`。 |
| 只读与风险边界 | `web/examples/*` 只读，业务状态不下沉到 `web/packages/*`。持久化仅 `pick` 明确字段；不在本地存储中保存密码、token 或其他敏感数据，不为 action 发明 API。 |
| 人工复核与验证 | 验证跨组件共享、刷新后持久化、computed 和异步失败传播；组件外使用时确认传入 Pinia 实例，再执行通用命令。 |

本地真相源：`web/skills/fa-store-generator/SKILL.md`、`web/skills/fa-store-generator/references/store-patterns.md` 和 `web/apps/qsmds-arco/src/store/modules/`。

官方来源：[fa-store-generator](https://fantastic-admin.hurui.me/guide/skills/fa-store-generator.md)。

## fa-theme-customizer

| 维度 | 项目化约定 |
| --- | --- |
| 用途 | 用 OKLCH 生成或调整 `BASE_COLORS`、`THEMES` 和必要的 `FRAMEWORK_COLORS`，并同时考虑 light/dark 配色。 |
| 何时使用 | 新建品牌主题、调整页面冷暖与中性底色、应用设计稿主色，或明确要求框架区域独立配色时；仅切换已有主题时改用 `fa-framework-settings`。 |
| 应用定位 | 共享主题定义不绑定应用；需要在应用中启用且用户未指定目标应用时，必须保留本地 Skill 的确认流程，不能默认启用到 `web/apps/qsmds-arco`。 |
| 必需输入 | 品牌色或可追溯的设计参考、风格和可读性目标、是否需要新基础色、是否要改框架区域，以及是否在 `qsmds-arco` 中启用。 |
| 默认输出 | 修改共享主题真相源 `web/packages/themes/index.ts`；需要立即启用时再修改 `web/apps/qsmds-arco/src/settings.ts`。 |
| 只读与风险边界 | `web/examples/*` 只读。`THEMES` 优先承载品牌与强调色；现有基础色无法满足背景/边框/输入中性体系时才新增 `BASE_COLORS`；只有用户明确要求框架区域分层时才改 `FRAMEWORK_COLORS`。 |
| 人工复核与验证 | 逐项检查 light/dark 对比度、焦点、破坏性操作、Arco 组件和框架壳；确认 `src/settings.ts` 引用真实 key，再执行通用命令与亮/暗色视觉回归。 |

本地真相源：`web/skills/fa-theme-customizer/SKILL.md`、`web/skills/fa-theme-customizer/references/theme-structure.md`、`design-styles.md` 和 `web/packages/themes/index.ts`。主题 key 的类型由对象 key 推导，不额外维护重复类型。

官方来源：[fa-theme-customizer](https://fantastic-admin.hurui.me/guide/skills/fa-theme-customizer.md)。
