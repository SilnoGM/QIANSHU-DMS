# Fantastic-admin 开发手册

## 1. 适用范围

本分册说明 Fantastic-admin 在千树 DMS 正式 Web 应用中的开发方式，覆盖指引、开发准备、项目级 AI Skills 和工程基础。它是项目化使用说明，不是官网全文镜像，也不替代源码、类型与 lockfile。

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
3. [AI 技能](./AI技能.md)：按真实任务选择本地 `web/skills/*`，确认输入、输出和人工复核边界。
4. [工程基础](./工程基础.md)：执行环境变量、资源、图标、构建、Composition API 和 JSX 约定。

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

## 5. 维护规则

- `web/package.json.version`、`web/pnpm-lock.yaml` 或 `web/apps/qsmds-arco/package.json` 变化时，先重新核对版本、命令、依赖和最后核对日期。
- `web/skills/*/SKILL.md` 或相关 `references/` 变化时，同步复核 Skill 的输入、落点、只读边界和验证方式。
- `web/apps/qsmds-arco/vite.config.ts`、`web/apps/qsmds-arco/vite/`、`src/assets/`、`public/`、`src/iconify/` 或 `web/uno.config.ts` 变化时，复核工程基础章节。
- 当前官网说明与本地 `6.3.0` 不一致时，保留官方直接链接并明确差异，不把在线最新状态写成当前项目事实。
- 新增主题时，覆盖矩阵中必须同时给出唯一覆盖键、直接官方来源、有效本地落点和当前状态。
- 手册中不写真实 `.env`、token、密码、连接字符串、Cookie 或专业版授权信息；不伪造业务 API、路由、字段或数据结构。
