# 千树 DMS 自定义组件库

## 1. 定位

本分册记录 `web/apps/qsmds-arco` 内已经形成稳定接口的应用级自定义组件。它是组件使用说明和维护入口，不是新的运行时包，也不会改变组件当前的导入方式。

这些组件服务于千树 DMS 正式 Web 应用，当前没有从 `web/packages/*` 公共导出，也没有注册为全局组件。调用方必须从组件源码目录显式导入；组件行为、类型和默认值以正式应用源码及测试为最终真相源。

组件分为两类：

| 分类 | 职责 | 当前组件 |
| --- | --- | --- |
| 基础组件 | 封装稳定、低业务耦合的输入、展示与反馈规则，不读取业务 Store，不请求领域 API | [金额输入](./基础组件/金额输入.md)、[金额显示](./基础组件/金额显示.md)、[日期显示](./基础组件/日期显示.md)、[轻提示](./基础组件/轻提示.md)、[图片组](./基础组件/图片组.md) |
| 业务组件 | 组合基础组件和 Fantastic-admin 能力，提供可复用的业务交互骨架，但不内置具体业务动作或数据副作用 | [通用表格](./业务组件/通用表格.md)、[通用抽屉](./业务组件/通用抽屉.md)、[通用模态框](./业务组件/通用模态框.md)、[产品提示](./业务组件/产品提示.md)、[海运柜次卡片](./业务组件/海运柜次卡片.md) |

页面模板仍按[组件库建设方案](../../组件库建设方案.md)治理；当前没有需要纳入本分册的稳定页面模板说明书。

## 2. 目录结构

```text
自定义组件库/
├── README.md
├── 基础组件/
│   ├── 金额输入.md
│   ├── 金额显示.md
│   ├── 日期显示.md
│   ├── 轻提示.md
│   └── 图片组.md
└── 业务组件/
    ├── 通用表格.md
    ├── 通用抽屉.md
    ├── 通用模态框.md
    ├── 产品提示.md
    └── 海运柜次卡片.md
```

代码目录与文档分类保持一致：

```text
web/apps/qsmds-arco/src/components/
├── base/
│   ├── MoneyInput/
│   ├── AmountDisplay/
│   ├── DateTimeDisplay/
│   ├── QsToast/
│   └── ImageGroup/
└── business/
    ├── QsGenericTable/
    ├── QsGenericDrawer/
    ├── QsGenericModal/
    ├── QsGoodTooltip/
    └── QsOceanContainerList/
```

## 3. 使用边界

- 优先复用本分册已有组件，不在业务页面重复实现相同的金额、日期时间、轻提示、图片组、产品提示、通用表格或任务容器规则。
- 基础组件只负责已声明的输入、展示或反馈规则。币种口径、时区选择、字段权限、提交策略和数据来源由业务调用方决定。
- 精确金额使用 `string | null`；输入通过 `MoneyInput` 校验，显示使用 `AmountDisplay`，计算使用 `sumMoneyValues`。
- `QsGenericTable` 只管理查询与展示状态，不请求 API、不读取 Store，也不自动搜索、筛选、排序或分页切片。
- `QsOceanContainerList` 展示整柜概览与个人明细，个人数据授权、查询和缓存由调用方负责；组件不在客户端推断销售归属。
- 操作按钮、权限检查、确认交互、页面跳转和数据写入必须由 `actions` 插槽的调用方负责。
- `QsGenericDrawer` 只管理任务容器、稳定状态和关闭生命周期；Footer 按钮、表单、权限与数据写入由调用方负责。
- `QsGenericModal` 只管理聚焦任务容器、稳定状态和关闭生命周期；Footer 按钮、表单、权限与数据写入由调用方负责。
- `QsToast` 通过 `useQsToast()` 提供受控轻提示 API；调用方只提供文案、时长和动作，不替换内部视觉组件。
- `ImageGroup` 只管理图片缩略图、逐图 Tooltip、溢出和整组预览，不认识产品、SKU 或附件领域字段。
- `QsGoodTooltip` 提供完整 Tooltip 包装器，`QsGoodTooltipContent` 提供可复用的左图右文内容层。`ImageGroup` 每张图片对应不同 SPU / SKU 时，通过逐项 `tooltip` 插槽按稳定 `item.key` 渲染内容层；只有整组对应同一产品、使用外层包装器时才传入 `:tooltip="false"`。
- 组件内核不足以满足已确认需求时，先按[前端开发手册](../README.md#5-组件与代码边界)复核选型，再决定扩展现有组件或回退到下层能力。
- 排版角色统一遵循[全局排版规范](../../全局排版规范.md)，不得按列名、文案或对齐方式猜测金额、单号、日期等数据语义。

## 4. Showcase 路由

| 分类 | 组件 | 路由 |
| --- | --- | --- |
| 基础组件 | `AmountDisplay` | `/component-library/basic/amount-display` |
| 基础组件 | `MoneyInput` | `/component-library/basic/money-input` |
| 基础组件 | `DateTimeDisplay` | `/component-library/basic/date-time-display` |
| 基础组件 | `QsToast` | `/component-library/basic/toast` |
| 基础组件 | `ImageGroup` | `/component-library/basic/image-group` |
| 图标示例 | `FaIcon` 与项目图标资产 | `/component-library/basic/icons` |
| 业务组件 | `QsGenericTable` | `/component-library/business/generic-table` |
| 业务组件 | `QsGenericDrawer` | `/component-library/business/generic-drawer` |
| 业务组件 | `QsGenericModal` | `/component-library/business/generic-modal` |
| 业务组件 | `QsGoodTooltip` | `/component-library/business/good-tooltip` |
| 业务组件 | `QsOceanContainerList` | `/component-library/business/ocean-container-list` |

组件库路由在开发环境自动注册。非开发构建只有在公开布尔变量 `VITE_ENABLE_COMPONENT_LIBRARY=true` 时才注册，生产环境默认不提供该入口。Showcase 用于接口和视觉验收，不代表组件已经接入真实业务页面。

图标示例页复用 Fantastic-admin `FaIcon`，不新增自定义图标组件。品牌导航 SVG、通用图标的选择边界、制作和清单维护见[图标制作与使用规范](../../图标制作与使用规范.md)。

## 5. 真相源

同一事实发生冲突时，按以下顺序判断：

1. `web/apps/qsmds-arco/src/components/` 中的组件实现和类型。
2. `web/apps/qsmds-arco/test/views/` 中的组件契约测试。
3. `web/apps/qsmds-arco/src/views/component_library/` 中的 Showcase。
4. 本分册和组件目录中的说明文档。
5. 阶段设计或工程归档。

文档不能把 Showcase 文案、历史设计或尚未实现的设想写成当前公共接口。

## 6. 维护要求

出现以下任一变化时，应同步更新对应说明书：

- Props、`v-model`、Events、Slots、公开类型、默认值或空值行为发生变化。
- 格式化、舍入、日期解析、时区、汇总或响应式规则发生变化。
- Showcase 路由、环境开关或组件源码路径发生变化。
- 组件开始读取 API、Store、权限上下文，或被抽取到 `web/packages/*`。
- 新增真实业务调用方后，现有成熟度和边界结论不再准确。

基础验证命令：

```bash
pnpm -C web exec tsx --test \
  apps/qsmds-arco/test/views/money-input.test.ts \
  apps/qsmds-arco/test/views/amount-display.test.ts \
  apps/qsmds-arco/test/views/date-time-display.test.ts \
  apps/qsmds-arco/test/views/qs-toast.test.ts \
  apps/qsmds-arco/test/views/image-group.test.ts \
  apps/qsmds-arco/test/views/qs-good-tooltip.test.ts \
  apps/qsmds-arco/test/views/qs-good-tooltip-showcase.test.ts \
  apps/qsmds-arco/test/views/generic-table.test.ts \
  apps/qsmds-arco/test/views/generic-table-showcase.test.ts \
  apps/qsmds-arco/test/views/generic-drawer.test.ts \
  apps/qsmds-arco/test/views/generic-drawer-showcase.test.ts \
  apps/qsmds-arco/test/views/generic-modal.test.ts \
  apps/qsmds-arco/test/views/generic-modal-showcase.test.ts

pnpm -C web exec node --test scripts/frontend-handbook.test.mjs
pnpm -C web exec eslint scripts/frontend-handbook.test.mjs
git diff --check
```
