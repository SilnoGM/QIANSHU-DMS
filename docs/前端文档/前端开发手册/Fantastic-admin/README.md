# Fantastic-admin 开发手册

## 1. 适用范围

本分册说明 Fantastic-admin 在千树 DMS 正式 Web 应用中的开发方式，覆盖指引、开发准备、项目级 AI Skills、工程基础、请求与登录、路由与状态、应用配置、权限保活、国际化和高级构建能力。它是项目化使用说明，不是官网全文镜像，也不替代源码、类型与 lockfile。

| 项目 | 当前结论 |
| --- | --- |
| 本地基座 | Fantastic-admin Pro `6.3.0` |
| 正式应用 | `web/apps/qsmds-arco` |
| 公开对应基线 | [`fantastic-admin/basic@v6.3.0`](https://github.com/fantastic-admin/basic/tree/v6.3.0) |
| 最后核对日期 | `2026-07-15` |

版本与应用边界来自 `web/package.json` 和 `web/apps/qsmds-arco/package.json`；专业版组件与行为来自 `web/packages/*` 和 `web/apps/qsmds-arco`。

## 2. 真相源与基础版、专业版边界

同一结论冲突时，按以下顺序判断：

1. `web/package.json`、`web/pnpm-lock.yaml` 与 `web/apps/qsmds-arco`：确认当前版本、依赖、启用方式和正式应用行为。
2. `web/packages/*` 与 `web/skills/*`：确认专业版实现、公开导出和项目级 Skill 契约。
3. [`fantastic-admin/basic@v6.3.0`](https://github.com/fantastic-admin/basic/tree/v6.3.0)：核对同版本可公开的基础结构，不用它否定本地专业版差异。
4. [Fantastic-admin 当前官方指南](https://fantastic-admin.hurui.me/guide/intro.md)：补充上游概念和最新说明；官网后续变化不会自动改变本项目的 `6.3.0` 基线。

官方文档中的专业版标记只说明上游授权边界。本项目是专业版源码基座，但手册不记录授权信息，也不把本地专业版源码的非公开内容转载到公开基线。

## 3. 阅读顺序

1. [Fantastic-admin 开发手册](./README.md)：先确认范围、真相源和主题覆盖状态。
2. [指引与开发准备](./指引与开发准备.md)：理解选型、版本、工作区和项目术语。
3. [工程基础](./工程基础.md)：执行环境变量、资源、图标、构建、Composition API 和 JSX 约定。
4. [服务端交互与登录](./服务端交互与登录.md)：掌握 Axios/OpenAPI 契约、错误重试、fake DTO 和当前登录链路。
5. [路由导航与状态管理](./路由导航与状态管理.md)：理解路由装配、菜单生成、Router 扩展和框架 Store 边界。
6. [应用配置](./应用配置.md)：按当前 `SettingsOptions`、共享默认值和正式应用覆盖调整框架行为。
7. [权限、保活与国际化](./权限保活与国际化.md)：区分身份、授权、页面缓存、语言、快捷键和 Storage 安全边界。
8. [高级能力、构建与升级](./高级能力构建与升级.md)：使用内置 API、预留插槽、开发工具，并按差异升级；正式应用已移除 Arco Provider。
9. [AI 技能](./AI技能.md)：按真实任务选择本地 `web/skills/*`，确认输入、输出和人工复核边界。

## 4. 覆盖矩阵

“当前项目状态”表示本次已经核对到正式应用或项目级 Skill，不表示官网后续新增能力已被项目自动吸收。

| 覆盖键 | 官方来源 | 本地落点 | 当前项目状态 |
| --- | --- | --- | --- |
| 指引 / 文档说明 | [官方文档](https://fantastic-admin.hurui.me/guide/intro.md) | [文档说明](./指引与开发准备.md#文档说明) | 已映射专业版基线与项目真相源 |
| 指引 / 为什么选择我们 | [官方文档](https://fantastic-admin.hurui.me/guide/why.md) | [为什么选择 Fantastic-admin](./指引与开发准备.md#为什么选择-fantastic-admin) | 已转换为千树 DMS 选型与边界 |
| 指引 / 更新日志 | [官方文档](https://fantastic-admin.hurui.me/guide/changelog.md) | [更新日志的阅读方法](./指引与开发准备.md#更新日志的阅读方法) | 已固定 `6.3.0` 差异阅读方法 |
| AI 技能 / 介绍 | [官方文档](https://fantastic-admin.hurui.me/guide/skills.md) | [介绍](./AI技能.md#介绍) | 已设定正式应用、只读参考与人工复核边界 |
| AI 技能 / fa-crud-page-generator | [官方文档](https://fantastic-admin.hurui.me/guide/skills/fa-crud-page-generator.md) | [fa-crud-page-generator](./AI技能.md#fa-crud-page-generator) | 本地 Skill 已核对，正式应用路径已映射 |
| AI 技能 / fa-form-builder | [官方文档](https://fantastic-admin.hurui.me/guide/skills/fa-form-builder.md) | [fa-form-builder](./AI技能.md#fa-form-builder) | 本地 Skill 已核对，独立表单边界已明确 |
| AI 技能 / fa-framework-settings | [官方文档](https://fantastic-admin.hurui.me/guide/skills/fa-framework-settings.md) | [fa-framework-settings](./AI技能.md#fa-framework-settings) | 本地 Skill 已核对，仅保留应用定制的原则已明确 |
| AI 技能 / fa-i18n-manager | [官方文档](https://fantastic-admin.hurui.me/guide/skills/fa-i18n-manager.md) | [fa-i18n-manager](./AI技能.md#fa-i18n-manager) | 本地专业版 Skill 已核对，公共与应用文案边界已明确 |
| AI 技能 / fa-page-optimizer | [官方文档](https://fantastic-admin.hurui.me/guide/skills/fa-page-optimizer.md) | [fa-page-optimizer](./AI技能.md#fa-page-optimizer) | 本地 Skill 已核对，组件 API 复核边界已明确 |
| AI 技能 / fa-route-generator | [官方文档](https://fantastic-admin.hurui.me/guide/skills/fa-route-generator.md) | [fa-route-generator](./AI技能.md#fa-route-generator) | 本地 Skill 已核对，前端与后端路由模式边界已明确 |
| AI 技能 / fa-slot-creator | [官方文档](https://fantastic-admin.hurui.me/guide/skills/fa-slot-creator.md) | [fa-slot-creator](./AI技能.md#fa-slot-creator) | 本地 Skill 已核对，19 个自动发现位置已映射 |
| AI 技能 / fa-store-generator | [官方文档](https://fantastic-admin.hurui.me/guide/skills/fa-store-generator.md) | [fa-store-generator](./AI技能.md#fa-store-generator) | 本地 Skill 已核对，业务 Store 与框架 Store 边界已明确 |
| AI 技能 / fa-theme-customizer | [官方文档](https://fantastic-admin.hurui.me/guide/skills/fa-theme-customizer.md) | [fa-theme-customizer](./AI技能.md#fa-theme-customizer) | 本地 Skill 已核对，三层主题结构已映射 |
| 入门 / 准备工作 | [官方文档](https://fantastic-admin.hurui.me/guide/ready.md) | [开发前提](./指引与开发准备.md#开发前提) | 已核对 Node.js、pnpm、源码与 IDE 要求 |
| 入门 / 开始 | [官方文档](https://fantastic-admin.hurui.me/guide/start.md) | [工作区启动与检查](./指引与开发准备.md#工作区启动与检查) | 已映射独立 `web/` workspace 与正式应用默认命令 |
| 入门 / 代码规范 | [官方文档](https://fantastic-admin.hurui.me/guide/coding-standard.md) | [代码规范](./指引与开发准备.md#代码规范) | 已映射项目实际检查脚本与注释要求 |
| 入门 / 术语 | [官方文档](https://fantastic-admin.hurui.me/guide/term.md) | [项目术语](./指引与开发准备.md#项目术语) | 已映射布局、导航、顶栏、标签栏与工具栏路径 |
| 入门 / 环境变量 | [官方文档](https://fantastic-admin.hurui.me/guide/env.md) | [环境变量](./工程基础.md#环境变量) | 已核对三套示例文件与 `VITE_` 公开数据边界 |
| 入门 / 资源 | [官方文档](https://fantastic-admin.hurui.me/guide/resources.md) | [资源](./工程基础.md#资源) | 已核对 `src/assets`、就近资源与 `public` 选择规则 |
| 入门 / 图标 | [官方文档](https://fantastic-admin.hurui.me/guide/icon.md) | [图标](./工程基础.md#图标) | 已核对 `FaIcon`、UnoCSS、Iconify 与 SVG spritemap |
| 入门 / 构建与预览 | [官方文档](https://fantastic-admin.hurui.me/guide/build.md) | [构建与预览](./工程基础.md#构建与预览) | 已核对正式应用与参考应用命令、产物目录 |
| 高级 / Composition API | [官方文档](https://fantastic-admin.hurui.me/guide/composition-api.md) | [Composition API](./工程基础.md#composition-api) | 正式应用已广泛使用 `<script setup lang="ts">` 与自动导入 |
| 高级 / JSX | [官方文档](https://fantastic-admin.hurui.me/guide/jsx.md) | [JSX](./工程基础.md#jsx) | 构建链已启用 JSX，正式应用当前未使用 `.jsx` 或 `.tsx` 业务文件 |
| 入门 / 与服务端交互 | [官方文档](https://fantastic-admin.hurui.me/guide/axios.md) | [与服务端交互](./服务端交互与登录.md#与服务端交互) | 已映射 AxiosResponse、ApiClientError、受限重试、取消、Blob 和 bare fake DTO 契约 |
| 入门 / 登录相关 | [官方文档](https://fantastic-admin.hurui.me/guide/login.md) | [登录相关](./服务端交互与登录.md#登录相关) | 已记录真实 Cookie Session、六态 Account Store、启动恢复、改密、退出、redirect 与 guard 链路 |
| 入门 / 路由 (导航菜单) | [官方文档](https://fantastic-admin.hurui.me/guide/router.md) | [路由（导航菜单）](./路由导航与状态管理.md#路由导航菜单) | 已核对三类路由、前后端生成分支、菜单 meta、扩展导航与未配置能力 |
| 入门 / 全局状态管理 | [官方文档](https://fantastic-admin.hurui.me/guide/store.md) | [全局状态管理](./路由导航与状态管理.md#全局状态管理) | 已核对 Pinia 入口、11 个框架 Store 和业务 Store 放置边界 |
| 应用配置 / 介绍 | [官方文档](https://fantastic-admin.hurui.me/guide/settings.md) | [应用配置介绍](./应用配置.md#应用配置介绍) | 已固定 setSettings、SettingsOptions、共享默认与正式应用覆盖关系 |
| 应用配置 / 应用 | [官方文档](https://fantastic-admin.hurui.me/guide/settings/app.md) | [应用](./应用配置.md#应用) | 已逐项记录 app 当前有效默认和路由、响应式前提 |
| 应用配置 / 主题 | [官方文档](https://fantastic-admin.hurui.me/guide/settings/theme.md) | [主题](./应用配置.md#主题) | 已逐项记录 theme 默认；正式应用只消费主题 token，Arco 同步仅保留在参考应用 |
| 应用配置 / 导航菜单 | [官方文档](https://fantastic-admin.hurui.me/guide/settings/menu.md) | [导航菜单](./应用配置.md#导航菜单) | 已区分共享默认与 mainMenuClickMode 项目覆盖 |
| 应用配置 / 顶栏 | [官方文档](https://fantastic-admin.hurui.me/guide/settings/topbar.md) | [顶栏](./应用配置.md#顶栏) | 已记录 tabbar、toolbar、mode 与布局计算条件 |
| 应用配置 / 标签栏 | [官方文档](https://fantastic-admin.hurui.me/guide/settings/tabbar.md) | [标签栏](./应用配置.md#标签栏) | 已记录当前关闭状态、完整配置和 Storage 联动 |
| 应用配置 / 工具栏 | [官方文档](https://fantastic-admin.hurui.me/guide/settings/toolbar.md) | [工具栏](./应用配置.md#工具栏) | 已记录各工具默认、布局数组和 fake API 边界 |
| 应用配置 / 页面 | [官方文档](https://fantastic-admin.hurui.me/guide/settings/page.md) | [页面](./应用配置.md#页面) | 已记录动画、进度、iframe 保活、快捷键与无障碍边界 |
| 高级 / 权限验证 | [官方文档](https://fantastic-admin.hurui.me/guide/auth.md) | [权限验证](./权限保活与国际化.md#权限验证) | 已拆分身份、菜单、路由、按钮与 Server 鉴权，权限只读取 `/api/auth/me` 快照且无本地开关绕过 |
| 高级 / 页面保活 | [官方文档](https://fantastic-admin.hurui.me/guide/keep-alive.md) | [页面保活](./权限保活与国际化.md#页面保活) | 已核对 keepAlive/noKeepAlive、组件 name、标签关闭和 iframe 独立链路 |
| 高级 / 国际化 | [官方文档](https://fantastic-admin.hurui.me/guide/i18n.md) | [国际化](./权限保活与国际化.md#国际化) | 已核对 Vue I18n、路由语言包、Header 与 RTL 链路；正式应用不再涉及 Arco locale |
| 高级 / 内置 API | [官方文档](https://fantastic-admin.hurui.me/guide/api.md) | [内置 API](./高级能力构建与升级.md#内置-api) | 已列出本地 app/shared composables、Router 扩展、eventBus 和 dayjs |
| 高级 / 预留插槽 | [官方文档](https://fantastic-admin.hurui.me/guide/slots.md) | [预留插槽](./高级能力构建与升级.md#预留插槽) | 已核对 19 个真实 slot 目录名，正式应用当前未创建具体 slot |
| 高级 / 快捷键 | [官方文档](https://fantastic-admin.hurui.me/guide/hotkeys.md) | [快捷键](./权限保活与国际化.md#快捷键) | 已核对共享 registry、应用 extend、配置门控和当前空业务扩展 |
| 高级 / 私有 Storage 数据 | [官方文档](https://fantastic-admin.hurui.me/guide/storage.md) | [私有 Storage 数据](./权限保活与国际化.md#私有-storage-数据) | 已核对前缀 Proxy、真实逻辑 key 与非加密安全边界 |
| 高级 / 开发者工具 | [官方文档](https://fantastic-admin.hurui.me/guide/devtools.md) | [开发者工具](./高级能力构建与升级.md#开发者工具) | 已核对 Vue DevTools、Turbo Console、移动调试工具和 production 开关 |
| 高级 / 自定义字体 | [官方文档](https://fantastic-admin.hurui.me/guide/font.md) | [自定义字体](./高级能力构建与升级.md#自定义字体) | 已核对两套 Digital 7 资源存在但当前未导入使用 |
| 高级 / 首屏 Loading | [官方文档](https://fantastic-admin.hurui.me/guide/loading.md) | [首屏 Loading](./高级能力构建与升级.md#首屏-loading) | 已核对 loading.html、Vite 注入和 router ready 淡出链路 |
| 高级 / 搭配 UI 组件库 | [官方文档](https://fantastic-admin.hurui.me/guide/with-ui-libraries.md) | [搭配 UI 组件库](./高级能力构建与升级.md#搭配-ui-组件库) | 已记录正式应用移除 Arco 的事实；参考应用的 Provider、主题与 locale 同步仅作结构参考 |
| 其他 / 框架更新 | [官方文档](https://fantastic-admin.hurui.me/guide/upgrade.md) | [框架更新](./高级能力构建与升级.md#框架更新) | 已建立本地 Pro 6.3.0 基线上的 Git diff、选择迁移和完整回归流程 |
| 其他 / 常见问题 | [官方文档](https://fantastic-admin.hurui.me/guide/q-a.md) | [常见问题](./高级能力构建与升级.md#常见问题) | 已按当前 workspace、generated types、same-origin 与 fake 链路修正排障答案 |
| 其他 / 从 v5 迁移 | [官方文档](https://fantastic-admin.hurui.me/guide/migration-from-v5.md) | [从 v5 迁移](./高级能力构建与升级.md#从-v5-迁移) | 仅作为旧代码迁入参考，当前应用保持原生 v6 配置且不增加兼容层 |

## 5. 维护规则

- `web/package.json.version`、`web/pnpm-lock.yaml` 或 `web/apps/qsmds-arco/package.json` 变化时，先重新核对版本、命令、依赖和最后核对日期。
- `web/skills/*/SKILL.md` 或相关 `references/` 变化时，同步复核 Skill 的输入、落点、只读边界和验证方式。
- `web/apps/qsmds-arco/vite.config.ts`、`web/apps/qsmds-arco/vite/`、`web/apps/qsmds-arco/src/assets/`、`web/apps/qsmds-arco/public/`、`web/apps/qsmds-arco/src/iconify/` 或 `web/uno.config.ts` 变化时，复核工程基础章节。
- `web/apps/qsmds-arco/src/api/`、`web/openapi/openapi.json` 或 `docs/前端文档/接口接入规范.md` 变化时，复核 AxiosResponse、错误、重试、取消、fake DTO 和登录链路。
- `web/apps/qsmds-arco/src/router/`、`web/apps/qsmds-arco/src/store/modules/` 或 `web/packages/types/types.ts` 变化时，复核路由、菜单、权限、保活和 Store 责任边界。
- `web/apps/qsmds-arco/src/settings.ts`、`web/packages/settings/src/types.ts`、`web/packages/settings/src/default.ts`、`web/packages/settings/src/preferences.ts` 或 `web/packages/settings/src/utils.ts` 变化时，重新生成当前配置表并区分共享默认与正式应用覆盖。
- `web/apps/qsmds-arco/src/locales/`、`web/apps/qsmds-arco/src/slots/`、`web/apps/qsmds-arco/src/hotkeys/`、`web/packages/hotkeys/`、`web/apps/qsmds-arco/loading.html` 或 `web/apps/qsmds-arco/src/assets/fonts/` 变化时，复核对应高级能力及其运行状态。
- 当前官网说明与本地 `6.3.0` 不一致时，保留官方直接链接并明确差异，不把在线最新状态写成当前项目事实。
- 新增主题时，覆盖矩阵中必须同时给出唯一覆盖键、直接官方来源、有效本地落点和当前状态。
- 手册中不写真实 `.env`、token、密码、连接字符串、Cookie 或专业版授权信息；不伪造业务 API、路由、字段或数据结构。
