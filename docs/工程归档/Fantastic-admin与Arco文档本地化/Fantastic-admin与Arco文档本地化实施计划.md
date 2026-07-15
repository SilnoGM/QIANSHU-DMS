# Fantastic-admin 与 Arco 文档本地化实施计划

> [!IMPORTANT]
> 本文已归档，仅用于追溯 Task 1–9 的执行顺序、TDD 证据与阶段提交，不再作为当前执行依据。
> 当前前端指导请使用[前端开发手册](../../前端文档/前端开发手册/README.md)，仓库协作流程请参阅[开发工作流](../../全局文档/开发工作流.md)。
> 任务时间线、偏差处理和验证证据请参阅[归档说明](./归档说明.md)。

> **归档记录：** 下方 `- [x]` 表示已由阶段 Commit、失败/通过测试或最终验证证明完成的步骤。

| 项目 | 内容 |
| --- | --- |
| 计划状态 | 已完成并归档 |
| 完成日期 | 2026-07-15 |
| 设计 Commit | `3dd847951e1b528915a8661ec448147e0dcb868b` |
| 计划 Commit | `81f227f8968701a10b78c87bf8b70c66fa02fd6c` |
| 最终实施 Commit | `9af8244130607eacf7bea90a0f8cff7dfc94c62b` |
| 归档说明 | [归档说明](./归档说明.md) |

**Goal:** 将 Fantastic-admin 专业版 `6.3.0`、本地内置组件和 Arco Design Vue `2.58.0` 的完整知识整理为千树 DMS 可检索、可验证、可维护的分层本地手册。

**Architecture:** 正式手册位于 `docs/前端文档/前端开发手册/`，以根 `README.md` 为唯一入口，再按 Fantastic-admin 指南、Fantastic-admin 内置组件和 Arco Design Vue 分册。官网解释设计意图，本地锁定版本、专业版源码和正式应用接入代码校正可用状态；`web/scripts/frontend-handbook.test.mjs` 分阶段锁定入口、版本、覆盖矩阵和相对链接。

**Tech Stack:** Markdown、Vue 3、TypeScript、Fantastic-admin Pro `6.3.0`、`@fantastic-admin/components`、Arco Design Vue `2.58.0`、Node.js `node:test`、Git。

---

## 实施基线

- 工作目录：`/Users/liguangda/Documents/develop/qianshu-dms`。
- 正式应用：`web/apps/qsmds-arco`；`web/examples/*` 只读参考。
- Fantastic-admin 官网：<https://fantastic-admin.hurui.me/guide/intro.html>、<https://fantastic-admin.hurui.me/components/>。
- Arco 官网：<https://arco.design/vue/docs/start>；Tag `2.58.0` Commit 为 `5a707cc60c1130d8dae3aefb2e93616541952a66`。
- Fantastic-admin 基础版 Tag `v6.3.0` Commit 为 `5a62b76046aad927afe739a72ddc743df7d46e33`；专业版差异以本仓库源码为准。
- 不复制官网全文，不修改业务代码、公共 API、数据结构、数据库 schema、依赖或真实 `.env`。
- 不记录许可证、购买凭据、账号或其他敏感信息。

## 文件映射

正式手册：

- Create: `docs/前端文档/前端开发手册/README.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin/README.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin/指引与开发准备.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin/AI技能.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin/工程基础.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin/服务端交互与登录.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin/路由导航与状态管理.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin/应用配置.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin/权限保活与国际化.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin/高级能力构建与升级.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin内置组件/README.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin内置组件/选型与使用规则.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin内置组件/基础版组件.md`
- Create: `docs/前端文档/前端开发手册/Fantastic-admin内置组件/专业版组件.md`
- Create: `docs/前端文档/前端开发手册/Arco-Design-Vue/README.md`
- Create: `docs/前端文档/前端开发手册/Arco-Design-Vue/接入基础与全局配置.md`
- Create: `docs/前端文档/前端开发手册/Arco-Design-Vue/通用与布局组件.md`
- Create: `docs/前端文档/前端开发手册/Arco-Design-Vue/数据录入组件.md`
- Create: `docs/前端文档/前端开发手册/Arco-Design-Vue/数据展示组件.md`
- Create: `docs/前端文档/前端开发手册/Arco-Design-Vue/反馈组件.md`
- Create: `docs/前端文档/前端开发手册/Arco-Design-Vue/导航与其他组件.md`

治理资产：

- Create: `web/scripts/frontend-handbook.test.mjs`
- Modify: `scripts/root-governance.test.mjs`
- Modify: `web/skills/fa-page-optimizer/SKILL.md`
- Modify: `web/skills/fa-page-optimizer/references/components-catalog.md`
- Modify: `docs/文档索引.md`
- Modify: `docs/工程归档/Fantastic-admin与Arco文档本地化/Fantastic-admin与Arco文档本地化设计.md`
- Modify: `docs/工程归档/Fantastic-admin与Arco文档本地化/Fantastic-admin与Arco文档本地化实施计划.md`
- Create: `docs/工程归档/Fantastic-admin与Arco文档本地化/归档说明.md`
- Modify: `docs/工程归档/归档索引.md`

## 统一内容模板

框架主题包含：功能定位、当前项目状态、使用步骤、关键配置或 API、项目示例、约束与常见问题、相关本地文档、官方来源。

组件条目包含：`## ComponentName 中文名称`、用途、项目状态、Vue 3 + TypeScript 最小示例、高频 Props/Events/Slots/Methods、选型注意事项、官方来源和本地源码路径。

## 分任务实施

### Task 1：建立入口与失败测试

**Files:** Create `web/scripts/frontend-handbook.test.mjs`、`docs/前端文档/前端开发手册/README.md`；Modify `docs/文档索引.md`。

- [x] **Step 1：确认版本和工作区**

```bash
git status --short
node -e "const fs=require('node:fs'); const root=JSON.parse(fs.readFileSync('web/package.json')); const lock=fs.readFileSync('web/pnpm-lock.yaml','utf8'); if(root.version!=='6.3.0'||!lock.includes('version: 2.58.0')) process.exit(1); console.log('Fantastic-admin 6.3.0 / Arco 2.58.0')"
```

Expected: Git 状态无输出，版本命令输出 `Fantastic-admin 6.3.0 / Arco 2.58.0`。

- [x] **Step 2：写入根入口失败测试**

```js
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const handbookRoot = `${projectRoot}/docs/前端文档/前端开发手册`

function readRequiredFile(filePath) {
  assert.equal(existsSync(filePath), true, `缺少前端开发手册文件：${filePath}`)
  return readFileSync(filePath, 'utf8')
}

test('前端开发手册入口固定版本、正式应用和三类知识域', () => {
  const index = readRequiredFile(`${projectRoot}/docs/文档索引.md`)
  const handbook = readRequiredFile(`${handbookRoot}/README.md`)
  assert.match(index, /\.\/前端文档\/前端开发手册\/README\.md/u)
  assert.match(handbook, /Fantastic-admin 专业版 `6\.3\.0`/u)
  assert.match(handbook, /`@arco-design\/web-vue@2\.58\.0`/u)
  assert.match(handbook, /web\/apps\/qsmds-arco/u)
  assert.match(handbook, /Fantastic-admin 内置组件/u)
  assert.match(handbook, /Arco Design Vue/u)
})
```

- [x] **Step 3：运行失败测试**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: FAIL，包含 `缺少前端开发手册文件`。

- [x] **Step 4：创建根入口并更新索引**

写入版本、正式应用、三类职责、来源优先级、更新触发条件和目标链接；根索引增加 `./前端文档/前端开发手册/README.md`。

- [x] **Step 5：复跑测试**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: PASS，`1` test、`0` fail。

- [x] **Step 6：提交**

```bash
git add web/scripts/frontend-handbook.test.mjs docs/文档索引.md docs/前端文档/前端开发手册/README.md
git diff --cached --check
git commit -m "docs: 建立前端开发手册入口"
```

### Task 2：Fantastic-admin 指引、Skills 与工程基础

**Files:** Create `Fantastic-admin/README.md`、`指引与开发准备.md`、`AI技能.md`、`工程基础.md`；Modify test。

- [x] **Step 1：增加第一批覆盖断言**

断言指引三项、AI Skills 介绍与九个 `fa-*` Skill、准备工作、开始、代码规范、术语、环境变量、资源、图标、构建预览、Composition API、JSX。

- [x] **Step 2：验证断言先失败**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: FAIL，首个缺失路径位于 `Fantastic-admin/`。

- [x] **Step 3：写 README 和覆盖矩阵第一部分**

记录官网栏目、直链、本地分册、项目状态、版本和核对日期。

- [x] **Step 4：写指引与开发准备**

覆盖文档说明、选择理由、更新日志、准备、开始、规范、术语，引用 `前端架构.md` 与 `应用边界规范.md`。

- [x] **Step 5：写 AI Skills 前三项**

`fa-crud-page-generator`、`fa-form-builder`、`fa-framework-settings`：输入、产物路径、参考应用保护、人工复核。

- [x] **Step 6：写 AI Skills 中间三项**

`fa-i18n-manager`、`fa-page-optimizer`、`fa-route-generator`：映射 `src/locales/`、`src/views/`、`src/router/`。

- [x] **Step 7：写 AI Skills 后三项**

`fa-slot-creator`、`fa-store-generator`、`fa-theme-customizer`：映射 `src/slots/`、`src/store/`、`src/settings.ts` 和 themes 包。

- [x] **Step 8：写工程基础**

结合 `.env.*.example`、`src/assets/`、`public/`、`FaIcon` 和正式命令，说明 `VITE_`、构建、Composition API、JSX。

- [x] **Step 9：测试并提交**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: PASS。

```bash
git add web/scripts/frontend-handbook.test.mjs docs/前端文档/前端开发手册/Fantastic-admin
git diff --cached --check
git commit -m "docs: 整理 Fantastic-admin 开发基础"
```

### Task 3：Fantastic-admin 运行链路、配置与高级能力

**Files:** Create 剩余五份 Fantastic-admin 分册；Modify README、test。

- [x] **Step 1：加入剩余覆盖断言**

加入服务端、登录、路由、状态；应用配置八项；权限、保活、i18n、内置 API、Slots、快捷键、Storage、开发工具、字体、Loading、UI 库；更新、FAQ、v5 迁移。总矩阵固定 49 个唯一键。

- [x] **Step 2：验证断言先失败**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: FAIL，报告第一份未创建分册。

- [x] **Step 3：写服务端交互与登录**

以 `src/api/client.ts`、`errors.ts`、`retry.ts`、`blob-error.ts`、account Store、`接口接入规范.md` 校正，不虚构接口。

- [x] **Step 4：写路由导航与状态**

覆盖 `routes.ts`、`modules/`、`guards.ts`、`extensions.ts`、菜单 Store、Meta、外链、Iframe、多级菜单和全部 app Store。

- [x] **Step 5：写应用配置**

从 `src/settings.ts`、`packages/settings/src/types.ts` 提取应用、主题、菜单、顶栏、标签栏、工具栏、页面真实配置。

- [x] **Step 6：写权限保活与国际化**

以 Guards、Store、`src/locales/` 为真相源，区分身份、路由、页面、按钮权限，并覆盖 Storage、快捷键。

- [x] **Step 7：写高级能力与升级**

覆盖内置 API、Slots、开发工具、字体、Loading、UI 适配、更新、FAQ、v5 迁移，明确当前是 `6.3.0`。

- [x] **Step 8：测试 49/49 并提交**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: PASS。

```bash
git add web/scripts/frontend-handbook.test.mjs docs/前端文档/前端开发手册/Fantastic-admin
git diff --cached --check
git commit -m "docs: 完善 Fantastic-admin 运行与配置手册"
```

### Task 4：Fantastic-admin 基础组件与选型

**Files:** Create 内置组件 README、选型规则、基础版组件；Modify test。

- [x] **Step 1：增加基础导出覆盖测试**

读取 `web/packages/components/src/index.ts` 基础部分，以 `/\b(?:Fa|useFa)[A-Z][A-Za-z0-9]+/gu` 提取公开名；选型文档断言“框架壳”“标准业务交互”“领域组件”“YAGNI”。

- [x] **Step 2：验证断言先失败**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: FAIL，指向内置组件目录。

- [x] **Step 3：写 README 与选型矩阵**

明确官网与本地导出差异；可用状态以 `src/index.ts` 为准。

- [x] **Step 4：写 Alert 至 ContextMenu**

`FaAlert`、`FaAvatar`、`FaBadge`、`FaButton`、`FaButtonGroup`、`FaCard`、`FaCheckbox`、`FaCheckboxGroup`、`FaCollapsible`、`FaContextMenu`。

- [x] **Step 5：写 Descriptions 至 Form**

`FaDescriptions`、`FaDivider`、`FaDrawer`、`useFaDrawer`、`FaDropdown`、`FaFileUpload`、`FaFixedBar`、`FaForm`、`FaFormItem`。

- [x] **Step 6：写 HoverCard 至 Modal**

`FaHoverCard`、`FaIcon`、`FaImagePreview`、`useFaImagePreview`、`FaImageUpload`、`FaInput`、`FaInputOTP`、`FaKbd`、`FaKbdGroup`、`FaLabel`、`FaModal`、`useFaModal`。

- [x] **Step 7：写 NumberField 至 Trend**

覆盖其余 `FaNumberField` 到 `FaTrend` 的全部基础公开组件、Composables 和主要类型。

- [x] **Step 8：测试并提交**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: PASS，基础公开名无遗漏。

```bash
git add web/scripts/frontend-handbook.test.mjs docs/前端文档/前端开发手册/Fantastic-admin内置组件
git diff --cached --check
git commit -m "docs: 整理 Fantastic-admin 基础组件"
```

### Task 5：Fantastic-admin 专业版组件

**Files:** Create `专业版组件.md`；Modify README、test。

- [x] **Step 1：增加专业版导出覆盖测试**

读取专业版部分并提取 `Fa*`、`useFa*`；README 断言“专业版是千树 DMS 正式能力”。

- [x] **Step 2：验证断言先失败**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: FAIL，指向 `专业版组件.md`。

- [x] **Step 3：写动画、视觉和 Calendar 组**

覆盖 Animated、Blur、Border、Flip、Glowy、六个 Calendar 和 Date 组件及公开类型。

- [x] **Step 4：写选择、代码和数据组**

覆盖 Cascader、Combobox、IconPicker、Mention、Tree、Code、CodePreview、CountTo、DigitalCard、Qrcode、Sparkline、TimeAgo、Timeline。

- [x] **Step 5：写布局、状态和流程组**

覆盖 Carousel、Empty、LayoutContainer、Loading、MultiStepLoader、Steps、StorageBox 及 Composables、类型。

- [x] **Step 6：写交互、背景和文本效果组**

覆盖 GradientButton、InteractiveButton、LinkPreview、SpotlightCard、Marquee、ParticlesBg、PatternBg、ScratchOff、ScrollingText、SmoothSwipe、SparklesText、TextHighlight、TextShiny。

- [x] **Step 7：测试并提交**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: PASS，专业版公开名无遗漏。

```bash
git add web/scripts/frontend-handbook.test.mjs docs/前端文档/前端开发手册/Fantastic-admin内置组件
git diff --cached --check
git commit -m "docs: 整理 Fantastic-admin 专业版组件"
```

### Task 6：Arco 接入、通用布局与数据录入

**Files:** Create Arco README、接入基础、通用布局、数据录入；Modify test。

- [x] **Step 1：增加第一批 28 个家族断言**

Button、Link、Typography、Divider、Grid、Layout、Space、AutoComplete、Cascader、Checkbox、ColorPicker、DatePicker、Form、Input、InputNumber、InputTag、Mention、Radio、Rate、Select、Slider、Switch、Textarea、TimePicker、Transfer、TreeSelect、Upload、VerificationCode；README 断言 `2.58.0`、`74`、官网和 Tag。

- [x] **Step 2：验证断言先失败**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: FAIL，指向 Arco 目录。

- [x] **Step 3：写 README 和 74 项矩阵**

字段：英文家族、分类、分册、官方版本来源、接入状态、核对日期。

- [x] **Step 4：写 Provider、Locale、主题和 TypeScript**

以 `src/ui/provider/index.ts` 为真相源，覆盖 `app.use(ArcoVue)`、`arco.css`、三个 Locale、ConfigProvider 和全局反馈 API。

- [x] **Step 5：写通用与布局七个家族**

Button、Link、Typography、Divider、Grid、Layout、Space 及子组件。

- [x] **Step 6：写数据录入前半**

AutoComplete、Cascader、Checkbox、ColorPicker、DatePicker、Form、Input、InputNumber、InputTag、Mention。

- [x] **Step 7：写数据录入后半**

Radio、Rate、Select、Slider、Switch、Textarea、TimePicker、Transfer、TreeSelect、Upload、VerificationCode。

- [x] **Step 8：测试并提交**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: PASS，28 个家族全部命中。

```bash
git add web/scripts/frontend-handbook.test.mjs docs/前端文档/前端开发手册/Arco-Design-Vue
git diff --cached --check
git commit -m "docs: 整理 Arco 接入与数据录入组件"
```

### Task 7：Arco 数据展示、反馈、导航与其他

**Files:** Create 数据展示、反馈、导航与其他；Modify README、test。

- [x] **Step 1：加入剩余 46 个家族断言**

数据展示 19 个：Avatar、Badge、Calendar、Card、Carousel、Collapse、Comment、Descriptions、Empty、Image、List、Popover、Progress、Statistic、Table、Tag、Timeline、Tooltip、Tree。反馈 9 个：Alert、Drawer、Message、Modal、Notification、Popconfirm、Result、Skeleton、Spin。导航及其他 18 个：Affix、Anchor、BackTop、Breadcrumb、Dropdown、Menu、PageHeader、Pagination、Steps、Tabs、ConfigProvider、Icon、OverflowList、ResizeBox、Scrollbar、Split、Trigger、Watermark。

- [x] **Step 2：验证断言先失败**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: FAIL，首个缺失文件为数据展示分册。

- [x] **Step 3：写数据展示前半**

Avatar 至 List，并覆盖 AvatarGroup、CardGrid、CardMeta、CarouselItem、CollapseItem、DescriptionsItem、ImagePreview、ListItem。

- [x] **Step 4：写数据展示后半**

Popover 至 Tree，覆盖 Countdown、TableColumn、排序、过滤、行选择、大数据注意事项。

- [x] **Step 5：写反馈九个家族**

区分组件式与方法式 API、关闭时机、异步确认、局部和全局加载。

- [x] **Step 6：写导航十个家族**

Affix 至 Tabs，说明与 Fantastic-admin PageHeader、Tabs、路由标签栏的边界。

- [x] **Step 7：写其他八个家族**

ConfigProvider、Icon、OverflowList、ResizeBox、Scrollbar、Split、Trigger、Watermark；`Icon` 的实现入口对应包目录 `icon-component`。

- [x] **Step 8：测试 74/74 并提交**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: PASS，74 个家族全部命中。

```bash
git add web/scripts/frontend-handbook.test.mjs docs/前端文档/前端开发手册/Arco-Design-Vue
git diff --cached --check
git commit -m "docs: 完善 Arco 组件手册"
```

### Task 8：链接、选型与完整性收口

**Files:** Modify test、根 README、选型规则及测试指出的真实问题文件。

- [x] **Step 1：增加相对链接测试**

递归读取手册 Markdown，用支持平衡括号、转义与未闭合诊断的结构化扫描器提取非 HTTP、非锚点目标，按源目录 `resolve()` 后断言 `existsSync()`。

- [x] **Step 2：运行并修复断链**

Run: `pnpm -C web exec node --test scripts/frontend-handbook.test.mjs`
Expected: PASS；若先 FAIL，错误必须列出源文件和目标。

- [x] **Step 3：补齐十条任务导航**

新增页面、配置路由、接入登录、实现权限、选择表单、选择表格、上传文件、反馈状态、主题配置、构建升级。

- [x] **Step 4：补齐重叠组件对照**

Button、Card、Form、Input、Select、Table、Pagination、Modal/Drawer、Toast/Message、Tooltip/Popover、Tabs、Tag/Badge、Upload、ImagePreview、Tree、Steps、PageHeader。

- [x] **Step 5：扫描占位和敏感内容**

```bash
pnpm -C web exec node --test --test-name-pattern='前端开发手册全部分册不包含占位、虚构端点或硬编码敏感值|Task 6 文档策略扫描' scripts/frontend-handbook.test.mjs
```

Expected: 策略扫描测试 PASS，退出码 `0`。

**实施偏差记录：** 原始宽泛 `rg` 扫描在实施中会把 Vue 合法插值（例如 `{{ summary }}`）和安全空值（例如 `const password = ref('')`）误判为占位或硬编码敏感值，因此不再作为验收命令。最终由 `findArcoDocPolicyViolations()` 及其变异测试提供 fence-aware 扫描：忽略合法 Vue 插值与空值，同时拦截 TODO/TBD、占位标记、虚构 endpoint、Bearer、quoted/unquoted Cookie 和真实敏感赋值。

- [x] **Step 6：运行完整脚本测试并提交**

Run: `pnpm -C web run test:scripts:node`
Expected: 所有 `scripts/*.test.mjs` PASS，`0` fail。

```bash
git add web/scripts/frontend-handbook.test.mjs docs/前端文档/前端开发手册
git diff --cached --check
git commit -m "docs: 收口前端组件选型与文档验证"
```

### Task 9：归档与最终验证

**Files:** Modify 设计、计划、归档索引、`root-governance.test.mjs`；Create `归档说明.md`。

- [x] **Step 1：核对设计验收项**

核对分册、指南 49/49、本地组件动态导出 100%、Arco 74/74、专业版主线、版本差异、无复制与敏感信息、验证和提交范围。

- [x] **Step 2：更新设计与计划状态**

设计改为“已完成并归档”，写入完成日期和最终实施 Commit `9af8244130607eacf7bea90a0f8cff7dfc94c62b`；只勾选有证据的步骤。承载归档文件的提交 SHA 由提交动作生成，不在文档内自引用。

- [x] **Step 3：写归档说明和索引**

记录来源、时间线、设计 Commit `3dd847951e1b528915a8661ec448147e0dcb868b`、计划 Commit、阶段 Commit、失败处理、验证证据、正式入口、维护条件。

- [x] **Step 4：执行最终验证**

```bash
git diff --check
node --test scripts/root-governance.test.mjs
pnpm -C web exec node --test scripts/frontend-handbook.test.mjs
pnpm -C web run test:scripts:node
pnpm -C web exec node --test --test-name-pattern='前端开发手册全部分册不包含占位、虚构端点或硬编码敏感值|Task 6 文档策略扫描' scripts/frontend-handbook.test.mjs
pnpm -C web exec eslint scripts/frontend-handbook.test.mjs
git status --short
```

Expected: 检查退出码 `0`，测试 `0` fail，状态只显示 Task 9 的四份归档文档与一份根治理测试。

- [x] **Step 5：核对归档提交范围**

```bash
git add scripts/root-governance.test.mjs docs/工程归档/归档索引.md docs/工程归档/Fantastic-admin与Arco文档本地化
git diff --cached --check
git status --short
```

Expected: 暂存区仅包含本任务的 5 个归档收口文件，且 `git diff --cached --check` 无输出。

承载本归档的 Git 提交及复验证据由 Git 历史和最终交付报告保存，不纳入本文完成项。

## 计划自检

- 规格覆盖：信息架构、真相源、专业版主线、选型、模板、覆盖矩阵、维护和验收均映射到 Task 1 至 Task 9。
- 文件边界：不修改业务实现、依赖或接口契约。
- 测试顺序：每个知识域先增加失败断言，再补齐文档，不跨提交保留已知失败。
- 完整性：Fantastic-admin 指南 49 个唯一键；内置组件动态读取本地公开导出；Arco 固定 74 个 `2.58.0` 家族。
- 占位检查：没有待决定路径、版本、命令或验收条件。
