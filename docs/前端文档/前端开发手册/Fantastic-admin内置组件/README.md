# Fantastic-admin 内置组件

本分册把 Fantastic-admin 内置组件放回千树 DMS 的真实工程边界中：先确认本地是否公开导出，再查源码和类型，最后才用官网理解设计意图。它不是官网内容镜像，也不是鼓励在业务页面中优先使用 `Fa*` 的组件目录。

## 1. 适用范围与真相源

| 项目 | 当前基线 |
| --- | --- |
| Fantastic-admin | Fantastic-admin Pro `6.3.0` |
| 正式应用 | `web/apps/qsmds-arco` |
| 最后核对 | 2026-07-15 |
| 运行时公开入口 | `web/packages/components/src/index.ts` |
| 基础组件源码 | `web/packages/components/src/basic/*` |
| 自动导入接入 | `web/apps/qsmds-arco/vite/plugins.ts` |

可用状态按以下优先级判断：

1. `web/packages/components/src/index.ts` 的本地公开导出是唯一可用性真相；没有从这里导出的组件、composable 或 type，不得写成当前公共能力。
2. `web/packages/components/src/basic/<component>/index.ts`、`*.vue`、`types` 和 `README.md` 决定本地 API；README 缺漏或与实现不一致时，以源码/类型为准。
3. `web/apps/qsmds-arco/vite/plugins.ts`、`vite.config.ts` 以及生成的 `src/types/components.d.ts`、`auto-imports.d.ts` 只用于核对正式应用如何消费这些导出，不能反向制造公共 API。
4. [Fantastic-admin 组件官网](https://fantastic-admin.hurui.me/components/)的官网分类仅作参考，用于解释组件定位和上游概念；官网当前内容不得覆盖本仓库锁定的 Fantastic-admin Pro `6.3.0` 源码事实。

“基础版组件”和“专业版组件”只是与 `src/index.ts` 一致的源码导航，不代表优先级。专业版是当前正式基线中的正式能力，并非可以跳过的附录；是否采用仍由需求和[选型与使用规则](./选型与使用规则.md)决定。

## 2. 阅读路径

1. [选型与使用规则](./选型与使用规则.md)：先判断框架壳、标准业务交互、专业版特有能力和领域组件的职责归属。
2. [基础版组件](./基础版组件.md)：查询当前基础区段的 52 个公开运行时名称、真实 API、最小用法和 Arco 边界。
3. 专业版组件分册将在 Task 5 按本地专业版导出单独纳入；当前不创建尚不存在的目标链接。

## 3. 基础组件分类索引

| 分类 | 公开能力 | 入口 |
| --- | --- | --- |
| 提示与基础展示 | `FaAlert`、`FaAvatar`、`FaBadge`、`FaCard`、`FaDivider`、`FaTag`、`FaTrend` | [从 FaAlert 开始](./基础版组件.md#faalert) |
| 按钮与选择控件 | `FaButton`、`FaButtonGroup`、`FaCheckbox`、`FaCheckboxGroup`、`FaRadioGroup`、`FaSelect`、`FaSlider`、`FaSwitch`、`FaNumberField` | [从 FaButton 开始](./基础版组件.md#fabutton) |
| 容器与浮层 | `FaCollapsible`、`FaContextMenu`、`FaDrawer`、`useFaDrawer`、`FaDropdown`、`FaHoverCard`、`FaModal`、`useFaModal`、`FaPopover`、`FaTooltip` | [从 FaCollapsible 开始](./基础版组件.md#facollapsible) |
| 表单与输入 | `FaForm`、`FaFormItem`、`FaInput`、`FaInputOTP`、`FaLabel`、`FaTextarea`、`FaPasswordStrength` | [从 FaForm 开始](./基础版组件.md#faform) |
| 文件与图片 | `FaFileUpload`、`FaImagePreview`、`useFaImagePreview`、`FaImageUpload` | [从 FaFileUpload 开始](./基础版组件.md#fafileupload) |
| 框架页面容器 | `FaFixedBar`、`FaPageHeader`、`FaPageMain`、`FaSearchBar`、`FaScrollArea` | [从 FaFixedBar 开始](./基础版组件.md#fafixedbar) |
| 数据展示与导航 | `FaDescriptions`、`FaPagination`、`FaProgress`、`FaTable`、`FaTabs` | [从 FaDescriptions 开始](./基础版组件.md#fadescriptions) |
| 图标与键盘提示 | `FaIcon`、`FaKbd`、`FaKbdGroup` | [从 FaIcon 开始](./基础版组件.md#faicon) |
| 全局反馈 | `FaToast`、`useFaToast` | [从 FaToast 开始](./基础版组件.md#fatoast) |

同一源码目录可能公开多个运行时名称，例如 `button` 同时公开 `FaButton` 与 `FaButtonGroup`，`drawer` 同时公开 `FaDrawer` 与 `useFaDrawer`。检索和评审时应以公开名为单位，以源码目录为证据单位。

## 4. 自动导入摘要

正式应用通过 `unplugin-vue-components` 和 `FantasticAdminComponentsResolver()` 自动解析模板中的 `Fa*` 组件，通过 `unplugin-auto-import` 和 `FantasticAdminComponentsAutoImports` 自动引入 `useFa*` composable。生成声明分别位于：

- `web/apps/qsmds-arco/src/types/components.d.ts`
- `web/apps/qsmds-arco/src/types/auto-imports.d.ts`

自动导入只是一种应用构建接入，不改变 `web/packages/components/src/index.ts` 的公共边界。`import type`、共享包、Node 脚本、测试和 Vite 配置仍应显式导入；详细规则见[选型与使用规则](./选型与使用规则.md#6-自动导入与显式导入)。

## 5. 维护触发条件

出现以下任一变化时，必须重新运行动态覆盖测试并核对本分册：

- `web/packages/components/src/index.ts` 的基础/专业区段新增、删除、改名或移动导出。
- `web/packages/components/src/basic/*` 的 Props、Events、Slots、Expose、composable 返回值或 exported types 发生变化。
- `web/packages/components/resolver.ts`、正式应用 `vite/plugins.ts` 或生成类型声明改变自动导入名单。
- `web/package.json` 中 Fantastic-admin 版本变化，或正式应用不再是 `web/apps/qsmds-arco`。
- 官网组件页面发生变化；只更新解释和链接，不得未经源码核对直接改写本地 API。
- Arco Design Vue 的业务 UI 约定或正式应用的领域组件目录发生变化，需要重新评估职责边界。

维护时至少执行：

```bash
pnpm -C web exec node --test scripts/frontend-handbook.test.mjs
pnpm -C web exec eslint scripts/frontend-handbook.test.mjs
git diff --check
```

## 6. 来源

- [Fantastic-admin 内置组件介绍](https://fantastic-admin.hurui.me/components/)
- `web/packages/components/src/index.ts`
- `web/packages/components/src/basic/*`
- `web/packages/components/resolver.ts`
- `web/apps/qsmds-arco/vite/plugins.ts`
- `web/apps/qsmds-arco/vite.config.ts`
- `web/apps/qsmds-arco/src/types/components.d.ts`
- `web/apps/qsmds-arco/src/types/auto-imports.d.ts`
