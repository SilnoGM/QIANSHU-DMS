# 千树 DMS 自定义组件库

## 1. 定位

本分册记录 `web/apps/qsmds-arco` 内已经形成稳定接口的应用级自定义组件。它是组件使用说明和维护入口，不是新的运行时包，也不会改变组件当前的导入方式。

这些组件服务于千树 DMS 正式 Web 应用，当前没有从 `web/packages/*` 公共导出，也没有注册为全局组件。调用方必须从组件源码目录显式导入；组件行为、类型和默认值以正式应用源码及测试为最终真相源。

组件分为两类：

| 分类 | 职责 | 当前组件 |
| --- | --- | --- |
| 基础组件 | 封装稳定、低业务耦合的只读展示规则，不读取业务 Store，不请求领域 API | [金额显示](./基础组件/金额显示.md)、[日期显示](./基础组件/日期显示.md) |
| 业务组件 | 组合基础组件和 Fantastic-admin 能力，提供可复用的业务交互骨架，但不内置具体业务动作或数据副作用 | [通用表格](./业务组件/通用表格.md)、[通用抽屉](./业务组件/通用抽屉.md) |

页面模板仍按[组件库建设方案](../../组件库建设方案.md)治理；当前没有需要纳入本分册的稳定页面模板说明书。

## 2. 目录结构

```text
自定义组件库/
├── README.md
├── 基础组件/
│   ├── 金额显示.md
│   └── 日期显示.md
└── 业务组件/
    ├── 通用表格.md
    └── 通用抽屉.md
```

代码目录与文档分类保持一致：

```text
web/apps/qsmds-arco/src/components/
├── base/
│   ├── AmountDisplay/
│   └── DateTimeDisplay/
└── business/
    ├── QsGenericTable/
    └── QsGenericDrawer/
```

## 3. 使用边界

- 优先复用本分册已有组件，不在业务页面重复实现相同的金额、日期时间、通用表格或任务抽屉规则。
- 基础组件只负责展示。币种口径、时区选择、字段权限和数据来源由业务调用方决定。
- `QsGenericTable` 只管理查询与展示状态，不请求 API、不读取 Store，也不自动搜索、筛选、排序或分页切片。
- 操作按钮、权限检查、确认交互、页面跳转和数据写入必须由 `actions` 插槽的调用方负责。
- `QsGenericDrawer` 只管理任务容器、稳定状态和关闭生命周期；Footer 按钮、表单、权限与数据写入由调用方负责。
- 组件内核不足以满足已确认需求时，先按[前端开发手册](../README.md#5-组件与代码边界)复核选型，再决定扩展现有组件或回退到下层能力。
- 排版角色统一遵循[全局排版规范](../../全局排版规范.md)，不得按列名、文案或对齐方式猜测金额、单号、日期等数据语义。

## 4. Showcase 路由

| 分类 | 组件 | 路由 |
| --- | --- | --- |
| 基础组件 | `AmountDisplay` | `/component-library/basic/amount-display` |
| 基础组件 | `DateTimeDisplay` | `/component-library/basic/date-time-display` |
| 业务组件 | `QsGenericTable` | `/component-library/business/generic-table` |
| 业务组件 | `QsGenericDrawer` | `/component-library/business/generic-drawer` |

组件库路由在开发环境自动注册。非开发构建只有在公开布尔变量 `VITE_ENABLE_COMPONENT_LIBRARY=true` 时才注册，生产环境默认不提供该入口。Showcase 用于接口和视觉验收，不代表组件已经接入真实业务页面。

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
  apps/qsmds-arco/test/views/amount-display.test.ts \
  apps/qsmds-arco/test/views/date-time-display.test.ts \
  apps/qsmds-arco/test/views/generic-table.test.ts \
  apps/qsmds-arco/test/views/generic-table-showcase.test.ts \
  apps/qsmds-arco/test/views/generic-drawer.test.ts \
  apps/qsmds-arco/test/views/generic-drawer-showcase.test.ts

pnpm -C web exec node --test scripts/frontend-handbook.test.mjs
pnpm -C web exec eslint scripts/frontend-handbook.test.mjs
git diff --check
```
