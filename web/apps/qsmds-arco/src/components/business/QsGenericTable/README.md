# QsGenericTable

`QsGenericTable` 是以 `FaTable`（TanStack Table）为表格内核、以 `FaPagination` 为分页器的业务通用表格。组件只管理查询条件和展示状态，不请求 API，也不依赖 Store。

## 受控状态

- `v-model:page`：当前页，从 `1` 开始，默认值为 `1`。
- `v-model:page-size`：每页数量，默认值为 `20`。
- `v-model:search`：已应用的搜索词。
- `v-model:filters`：已应用的筛选条件。
- `v-model:sorting`：TanStack Table 排序状态。

查询、筛选、排序和分页变化后，业务页面通过对应事件请求数据。切换每页数量、搜索、筛选或排序时，组件会把页码归一到第一页。

筛选面板中的选择首先写入草稿，只有点击“应用筛选”才会更新 `v-model:filters`。无已应用条件时入口显示“筛选”；单个条件显示“已筛选：条件名称”；多个条件显示“已筛选：多个条件”，并使用激活状态提示当前结果受筛选影响。“重置”会清空已应用条件并恢复默认入口状态。

## 列与汇总

`columns` 在 `TableColumn` 基础上增加以下业务配置：

- `id`、`title`：稳定列标识与展示标题。
- `defaultVisible`：列是否默认显示。
- `fixed`：默认固定到 `left` 或 `right`。
- `align`：默认内容对齐，可选 `left`、`center`、`right`，未设置时使用 `left`。
- `sortable`：是否允许排序。
- `summary`：支持 `count`、`average`、`sum`，可通过 `component` 和 `componentProps` 指定汇总渲染组件。

行号列由组件生成，始终固定在最左侧且不可隐藏。行号按照 `(page - 1) * pageSize + rowIndex + 1` 连续计算。

“列设置”支持在运行时调整显隐、左右固定与内容对齐，表头、单元格和汇总内容会同步更新。“恢复默认”会还原 `columns` 中声明的初始状态。`columnSettingsChange` 事件返回每列的 `visible`、`fixed` 和 `align` 状态，业务页面可按需持久化。

默认汇总当前页 `data`；服务端分页场景可通过 `summaryValues` 传入全量数据汇总结果。页面也可以提供 `summary-{columnId}` 插槽覆盖桌面端表尾内容。

## 响应式约定

桌面端使用 `FaTable`，列设置和筛选使用 `FaPopover`；小于 `768px` 时使用结构化列表，列设置和筛选进入底部 `FaDrawer`。业务页面可通过 `mobile-row` 插槽提供更贴合领域的窄屏行布局。

加载首屏使用骨架占位；已有数据刷新时保留旧数据并降低透明度。错误、重试、空数据和无搜索结果均由组件提供稳定状态，具体数据副作用由业务页面处理。
