# 前端开发手册

## 1. 定位与适用对象

本手册是千树 DMS Web 开发的统一知识入口，用于把 Fantastic-admin 框架能力、Fantastic-admin 内置组件和 Arco Design Vue 标准业务组件放入同一套项目语境中。它不镜像上游网站，而是依据仓库锁定版本和正式应用代码，说明当前项目可用的能力、选型边界、开发路径与维护规则。

适用对象包括新增或维护 Web 页面、路由、权限、接口、组件、构建配置的开发者，以及负责代码审查、版本升级和前端技术治理的维护者。开始具体任务前，应先按本页确认正式应用、知识域和真相源，再进入相应主题。

## 2. 固定基线

| 项目 | 当前基线 |
| --- | --- |
| Fantastic-admin | Fantastic-admin 专业版 `6.3.0` |
| Arco Design Vue | `@arco-design/web-vue@2.58.0` |
| 正式应用 | `web/apps/qsmds-arco` |
| 最后核对日期 | `2026-07-15` |

`web/apps/qsmds-arco` 是千树 DMS 唯一正式 Web 应用。`web/examples/*` 仅用于只读参考，不是正式应用，也不承担业务实现或产品发布职责；本手册中的项目路径、接入结论和开发建议均以正式应用为准。

## 3. 三个知识域

### 3.1 Fantastic-admin

负责框架级开发知识，包括工程准备、应用启动、环境变量、服务端交互、登录、路由与导航、全局状态、应用配置、权限、页面保活、国际化、预留插槽、快捷键、构建和框架升级。该知识域解释管理系统框架如何运行，以及正式应用应从哪些入口接入框架能力。

### 3.2 Fantastic-admin 内置组件

Fantastic-admin 内置组件用于框架壳与框架交互，本知识域负责基础版与专业版内置组件的本地可用状态、公开导出、关键 API、最小用法和选型规则。组件是否可用以 `web/packages/components/src/index.ts` 及其本地源码为准；专业版能力属于当前正式基线，不是可选附录。

### 3.3 Arco Design Vue

Arco Design Vue 用于标准业务 UI，包括通用与布局、数据录入、数据展示、反馈、导航及其他组件。该知识域以 `@arco-design/web-vue@2.58.0` 为固定版本，说明组件在正式应用中的接入状态、高频 API、项目化示例，以及与 Fantastic-admin 内置组件重叠时的选择依据。

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
| 标准业务 UI | 表单、表格、数据展示、反馈、弹出层等通用后台交互；默认使用 Arco Design Vue | `web/apps/qsmds-arco/src/views/` 及页面内组件 | 替代框架导航、布局或保活机制 |
| 领域组件 | 封装带有千树 DMS 业务语义、权限或流程的交互 | `web/apps/qsmds-arco/src/components/` | 伪装成通用能力进入共享包 |

同一页面可以按职责组合两套组件，但不得仅为视觉差异混用同类基础控件。专业版特有的日期、可视化、动画或框架封装可使用 Fantastic-admin 专业版组件；常规业务表单、数据展示和反馈优先使用 Arco Design Vue。只有至少两个真实调用方、接口稳定且不含领域语义的能力，才评估进入 `web/packages/*`，并继续遵循 YAGNI。

## 6. 按任务阅读

Fantastic-admin 知识域已经建立独立分册，统一入口为 [Fantastic-admin 开发手册](./Fantastic-admin/README.md)。其余知识域文档纳入仓库后，再由各域入口维护章节级导航。

| 任务 | 阅读和核对顺序 |
| --- | --- |
| 新增页面 | 先确认[应用边界规范](../应用边界规范.md)，再查 Fantastic-admin 的工程基础与页面约定；在 `web/apps/qsmds-arco/src/views/` 实现页面，按职责选择 Arco、内置组件或领域组件。 |
| 配置路由与导航 | 查 Fantastic-admin 的路由、导航、权限和保活知识，再核对 `web/apps/qsmds-arco/src/router/`、`web/apps/qsmds-arco/src/settings.ts` 与 `web/apps/qsmds-arco/src/store/`；不要从 `web/examples/*` 复制成运行依赖。 |
| 选择业务 UI 或组件 | 先按第 5 节判断框架壳、标准业务 UI 或领域组件，再查 Fantastic-admin 内置组件和 Arco Design Vue 对应条目；本地导出与正式应用接入状态优先。 |
| 接入认证与 API | 先查 Fantastic-admin 的服务端交互与登录链路，再遵循[接口接入规范](../接口接入规范.md)，核对 `web/apps/qsmds-arco/src/api/`、路由守卫和认证 Store；公共 API 或数据结构变更必须另行确认。 |
| 构建、发布或升级 | 先读 [Web 工作区说明](../../../web/README.md)和[开发工作流](../../全局文档/开发工作流.md)，再查 Fantastic-admin 构建、框架更新与迁移知识；升级时同时复核 lockfile、正式应用接入、内置组件导出和本手册版本基线。 |

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
