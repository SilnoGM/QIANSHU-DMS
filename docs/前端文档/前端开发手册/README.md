# 前端开发手册

## 1. 定位与适用对象

本手册是千树 DMS Web 开发的统一知识入口，用于把 Fantastic-admin 框架能力、Fantastic-admin 内置组件、Arco Design Vue 标准业务组件和千树 DMS 自定义组件放入同一套项目语境中。它不镜像上游网站，而是依据仓库锁定版本和正式应用代码，说明当前项目可用的能力、选型边界、开发路径与维护规则。

适用对象包括新增或维护 Web 页面、路由、权限、接口、组件、构建配置的开发者，以及负责代码审查、版本升级和前端技术治理的维护者。开始具体任务前，应先按本页确认正式应用、知识域和真相源，再进入相应主题。

## 2. 固定基线

| 项目 | 当前基线 |
| --- | --- |
| Fantastic-admin | Fantastic-admin 专业版 `6.3.0` |
| Arco Design Vue | `@arco-design/web-vue@2.58.0` |
| 正式应用 | `web/apps/qsmds-arco` |
| 最后核对日期 | `2026-07-24` |

`web/apps/qsmds-arco` 是千树 DMS 唯一正式 Web 应用。`web/examples/*` 仅用于只读参考，不是正式应用，也不承担业务实现或产品发布职责；本手册中的项目路径、接入结论和开发建议均以正式应用为准。

## 3. 四个知识域

### 3.1 Fantastic-admin

负责框架级开发知识，包括工程准备、应用启动、环境变量、服务端交互、登录、路由与导航、全局状态、应用配置、权限、页面保活、国际化、预留插槽、快捷键、构建和框架升级。该知识域解释管理系统框架如何运行，以及正式应用应从哪些入口接入框架能力。

### 3.2 Fantastic-admin 内置组件

Fantastic-admin 内置组件是标准业务 UI 的第一优先级，同时承担框架壳与框架交互。本知识域负责基础版与专业版内置组件的本地可用状态、公开导出、关键 API、最小用法和选型规则。组件是否可用以 `web/packages/components/src/index.ts` 及其本地源码为准；专业版能力属于当前正式基线，不是可选附录。

### 3.3 Arco Design Vue

Arco Design Vue 是 Fantastic-admin 无法满足需求时的回退组件库，包括通用与布局、数据录入、数据展示、反馈、导航及其他组件。该知识域以 `@arco-design/web-vue@2.58.0` 为固定版本，说明组件在正式应用中的接入状态、高频 API、项目化示例，以及与 Fantastic-admin 内置组件重叠时的回退依据。

### 3.4 千树 DMS 自定义组件库

千树 DMS 自定义组件库记录正式应用内已经形成稳定接口的基础组件和业务组件。该知识域按代码职责分为“基础组件”和“业务组件”，提供真实导入路径、Props、Events、Slots、格式化边界、响应式行为、Showcase 路由和验证命令；具体入口见[自定义组件库手册](./自定义组件库/README.md)。

运营、销售视角的柜次概览和个人明细展示，查阅[海运柜次卡片](./自定义组件库/业务组件/海运柜次卡片.md)。`QsOceanContainerList` 提供展开与分页事件，服务端授权和请求由调用方负责。

## 4. 真相源优先级

同一事实出现冲突时，按以下顺序判断，低优先级来源不得覆盖高优先级结论：

1. **本仓库锁定版本与正式应用代码**：先查 `web/package.json`、`web/pnpm-lock.yaml` 和 `web/apps/qsmds-arco`，确认版本、目录、启用方式与当前行为。
2. **本仓库 Fantastic-admin 专业版源码**：再查 `web/packages/*`、正式应用框架接入代码及相关类型，确认专业版实际实现、公开导出和 API。
3. **对应版本的官方文档或官方源码**：用于解释上游设计意图和固定版本公开能力；基础版源码不能覆盖本仓库专业版差异。
4. **当前在线官方文档**：用于补充目录、示例、修正说明和最新能力；若与本地版本不同，必须明确记录差异，不能把最新网页状态直接写成项目事实。

因此，官网出现某项能力并不等于本项目已经启用，本地暂未导出的组件也不能仅凭官网导航被标记为“当前可用”。

## 5. 组件与代码边界

| 层级 | 默认职责 | 主要位置 | 不应承担 |
| --- | --- | --- | --- |
| 框架壳与框架交互 | 应用布局、导航、页面容器、标签栏、主题、权限与框架生命周期；优先使用 Fantastic-admin 框架能力和内置组件 | `web/apps/qsmds-arco/src/layouts/`、`web/apps/qsmds-arco/src/router/`、`web/apps/qsmds-arco/src/settings.ts`、`web/packages/components/` | 千树 DMS 领域 API 和业务状态流 |
| 标准业务 UI | 表单、表格、数据展示、反馈、弹出层等通用后台交互；优先使用 Fantastic-admin 内置组件 | `web/apps/qsmds-arco/src/views/` 及页面内组件 | 替代框架导航、布局或保活机制 |
| 领域组件 | 封装带有千树 DMS 业务语义、权限或流程的交互 | `web/apps/qsmds-arco/src/components/` | 伪装成通用能力进入共享包 |

同一页面可以组合不同职责的组件，但不得仅为视觉差异混用同类基础控件。选型固定按 Fantastic-admin 内置组件、Arco Design Vue 组件、基于 Arco Design Vue 的应用级自定义组件、基于原生 Vue 的自定义组件的顺序逐级回退。只有至少两个真实调用方、接口稳定且不含领域语义的能力，才评估进入 `web/packages/*`，并继续遵循 YAGNI。

## 6. 按任务阅读

新增或维护页面时，先阅读 [UI 设计规范与页面开发指南](../UI设计规范.md)，快速确认当前主题、排版角色、页面骨架、组件组合、响应式和交互状态，再进入下列专项章节核对完整契约。

制作或接入导航图标时，阅读[图标制作与使用规范](../图标制作与使用规范.md)。项目沿用 `FaIcon` 渲染本地品牌 SVG，组件库 `/component-library/basic/icons` 提供当前图标清单与用法预览。

四个知识域均已建立本地分册：框架开发从 [Fantastic-admin 开发手册](./Fantastic-admin/README.md)进入，标准业务 UI 先从 [Fantastic-admin 内置组件手册](./Fantastic-admin内置组件/README.md)和[选型与使用规则](./Fantastic-admin内置组件/选型与使用规则.md)进入；经核对 Fa 能力无法满足已确认契约时，再查 [Arco Design Vue 手册](./Arco-Design-Vue/README.md)作为回退资料。复用正式应用已有能力时，从[自定义组件库手册](./自定义组件库/README.md)核对真实接口和使用边界。下面的任务导航把常见工作直接映射到本地章节和正式应用核对点。

| 任务 | 阅读入口 | 正式应用核对点与边界 |
| --- | --- | --- |
| 新增页面 | 先读[应用边界规范](../应用边界规范.md)，再按[路由（导航菜单）](./Fantastic-admin/路由导航与状态管理.md#路由导航菜单)确定页面与导航归属。 | 页面落在 `web/apps/qsmds-arco/src/views/`，路由落在 `web/apps/qsmds-arco/src/router/`；领域组件留在应用内，不从 `web/examples/*` 建立运行依赖。 |
| 配置路由 | 以[路由（导航菜单）](./Fantastic-admin/路由导航与状态管理.md#路由导航菜单)和[权限验证](./Fantastic-admin/权限保活与国际化.md#权限验证)为顺序。 | 核对 `web/apps/qsmds-arco/src/router/`、`web/apps/qsmds-arco/src/settings.ts` 与 account Store；路由、菜单、按钮权限和 Server 鉴权分层处理。 |
| 接入登录 | 阅读[登录相关](./Fantastic-admin/服务端交互与登录.md#登录相关)与[接口接入规范](../接口接入规范.md)。 | 从 `web/apps/qsmds-arco/src/api/modules/auth.ts`、`web/apps/qsmds-arco/src/store/modules/app/account.ts` 和 `web/apps/qsmds-arco/src/router/guards.ts` 核对真实 Cookie Session、启动 `/api/auth/me`、六态生命周期和 Server 权限边界。 |
| 实现权限 | 阅读[权限验证](./Fantastic-admin/权限保活与国际化.md#权限验证)，再回查路由与登录链路。 | 以 `web/apps/qsmds-arco/src/router/guards.ts`、`web/apps/qsmds-arco/src/store/modules/app/account.ts` 和 `web/apps/qsmds-arco/src/settings.ts` 为准；前端可见性不能替代 Server 授权。 |
| 选择表单 | 先读[重叠能力选择](./Fantastic-admin内置组件/选型与使用规则.md#4-与-arco-重叠能力的选择)与 [FaForm 回退到 AForm 的语义迁移](./Fantastic-admin内置组件/选型与使用规则.md#7-faform-与-aform-不是名称替换)。 | `web/apps/qsmds-arco/src/views/` 的标准业务表单优先 `FaForm`；无法满足已确认契约时才回退 `AForm`，并完整重写校验、字段、提交和 slot 语义。 |
| 选择表格 | 先按[重叠能力选择](./Fantastic-admin内置组件/选型与使用规则.md#4-与-arco-重叠能力的选择)判断；通用查询列表优先核对[通用表格](./自定义组件库/业务组件/通用表格.md)，仍有能力缺口时再查 [Arco Table](./Arco-Design-Vue/数据展示组件.md#table)。 | `web/apps/qsmds-arco/src/views/` 的通用查询列表优先复用 `web/apps/qsmds-arco/src/components/business/QsGenericTable/`；标准数据展示优先 `FaTable`，其无法满足已确认表格能力时才回退 `ATable`，窄屏优先卡片或抽屉式明细。 |
| 上传文件 | 先读[重叠能力选择](./Fantastic-admin内置组件/选型与使用规则.md#4-与-arco-重叠能力的选择)与[选型安全规则](./Fantastic-admin内置组件/选型与使用规则.md#10-安全规则)。 | `web/apps/qsmds-arco/src/api/` 当前没有可凭空引用的上传端点；优先核对 Fa request 契约，不足时才回退 Arco，鉴权始终走统一 client。 |
| 反馈状态 | 任务型侧滑流程先核对[通用抽屉](./自定义组件库/业务组件/通用抽屉.md)，聚焦式当前页任务先核对[通用模态框](./自定义组件库/业务组件/通用模态框.md)；其他反馈先读[重叠能力选择](./Fantastic-admin内置组件/选型与使用规则.md#4-与-arco-重叠能力的选择)，再按能力不足查 [Arco Message](./Arco-Design-Vue/反馈组件.md#message)与 [Modal](./Arco-Design-Vue/反馈组件.md#modal)。 | `web/apps/qsmds-arco/src/views/` 的任务抽屉优先复用 `QsGenericDrawer`，聚焦式模态任务优先复用 `QsGenericModal`；Footer、权限和写入均由页面负责。其他反馈优先 Fa 组件与 composable，回退 Arco 时要区分静态方法与实例注入 context，异步失败必须释放 loading。 |
| 主题配置 | 先读 Fantastic-admin [主题](./Fantastic-admin/应用配置.md#主题)，再核对 Arco [全局配置、语言与主题](./Arco-Design-Vue/接入基础与全局配置.md#全局配置语言与主题)。 | 主题入口为 `web/apps/qsmds-arco/src/settings.ts`，Arco 同步位于 `web/apps/qsmds-arco/src/ui/provider/`；不得只改一套 token 造成明暗主题分裂。 |
| 构建升级 | 先读[构建与预览](./Fantastic-admin/工程基础.md#构建与预览)和[框架更新](./Fantastic-admin/高级能力构建与升级.md#框架更新)，并结合 [Web 工作区说明](../../../web/README.md)。 | 从 `web/apps/qsmds-arco/package.json` 和 `web/pnpm-lock.yaml` 验证正式应用；升级同时复核 Provider、路由、Store、内置导出、74 家族矩阵与本手册基线。 |

## 7. 更新触发条件

出现以下任一变化时，必须复核本手册受影响的范围：

- `web/package.json.version` 所代表的 Fantastic-admin 上游基座版本变化。
- `web/pnpm-lock.yaml` 中 `@arco-design/web-vue` 锁定版本变化。
- `web/packages/components/src/index.ts` 新增、删除或重命名公开导出。
- 正式应用的 UI Provider、自动导入、主题、路由、权限、认证或 `web/apps/qsmds-arco/src/settings.ts` 入口变化。
- 对应版本的官方源码或当前官网出现会改变既有结论的修正说明。

维护时应先核对本地真相源，只更新受影响的知识域、覆盖关系、来源链接和最后核对日期。版本差异应明确记录，不通过长期堆叠旧兼容说明来掩盖当前推荐路径。

## 8. 安全与事实边界

- 禁止在手册、代码片段或日志示例中写入真实 `token`、密码、连接字符串、`Cookie`、真实 `.env` 内容或 Fantastic-admin 专业版授权信息；需要表达格式时，只能使用 `<TOKEN>`、`<PASSWORD>`、`<CONNECTION_STRING>` 等明显占位符。
- 禁止伪造业务 API、路由、字段、Store、权限模型或其他项目事实；示例需要业务数据时，应使用语义明确的静态占位数据，并标明其不代表仓库现状。

## 9. 官方来源

- [Fantastic-admin 官方指南](https://fantastic-admin.hurui.me/guide/intro.html)
- [Fantastic-admin 内置组件](https://fantastic-admin.hurui.me/components/)
- [Fantastic-admin 基础版源码 `v6.3.0`](https://github.com/fantastic-admin/basic/tree/v6.3.0)：用于核对对应版本的公开基线；专业版差异仍以本仓库源码为准。
- [Arco Design Vue 官方文档](https://arco.design/vue/docs/start)
- [Arco Design Vue 源码 `2.58.0`](https://github.com/arco-design/arco-design-vue/tree/2.58.0)

引用官方材料时只保留理解和追溯所需的链接与项目化说明，不复制官网全文。示例必须适配 Vue 3、TypeScript 和正式应用现有接入方式，并遵守上一节的安全与事实边界。
