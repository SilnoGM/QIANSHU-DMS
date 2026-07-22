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
- `copyable`：是否显示单元格复制入口，默认关闭。
- `sortable`：是否允许排序。
- `summary`：支持 `count`、`average`、`sum`，可通过 `component` 和 `componentProps` 指定汇总渲染组件。

行号列由组件生成，始终固定在最左侧且不可隐藏。行号按照 `(page - 1) * pageSize + rowIndex + 1` 连续计算。

`copyable: true` 会为桌面单元格追加复制按钮，按钮在悬停或键盘聚焦时显示；默认窄屏卡片始终显示复制入口。复制内容取自列 `accessorKey` 或 `accessorFn` 的当前值，成功后图标短暂变为勾选，失败时显示错误状态。使用自定义 `mobile-row` 插槽时，业务页面可以像组件库示例一样组合 `CopyCellButton`，让自定义卡片保持同样的反馈。

“列设置”支持在运行时调整显隐、左右固定与内容对齐，表头、单元格和汇总内容会同步更新。“恢复默认”会还原 `columns` 中声明的初始状态。`columnSettingsChange` 事件返回每列的 `visible`、`fixed` 和 `align` 状态，业务页面可按需持久化。

默认汇总当前页 `data`；服务端分页场景可通过 `summaryValues` 传入全量数据汇总结果。页面也可以提供 `summary-{columnId}` 插槽覆盖桌面端表尾内容。

## 排版约定

组件内置 13px 表头、14px 正文、12px 辅助信息的紧凑层级，并为表体、汇总和分页统一开启 `tabular-nums`。普通业务文字使用全局 `Noto Sans SC`；订单号、结算单号等编码可在插槽中使用 `font-mono`；数量、百分比和金额保持全局比例字体，并使用 `font-medium tabular-nums` 提升纵向比较效率。右对齐只表达列布局，不应被用来替代数字的 `tabular-nums` 语义。

## 复合单元格

需要在一列内展示主信息、辅助说明、两组金额或多个状态时，使用 `QsTableStackedCell` 与 `QsTableStackedLine` 组合现有的 `cell-{columnId}` 插槽。两个组件只管理纵向节奏和逐行样式，不内置订单、金额等业务语义。

`QsTableStackedLine` 支持 `label`、`tone`、`weight`、`nowrap`，以及 `labelClass`、`contentClass`、`suffixClass`。组件根节点也接受普通 `class`；`suffix` 插槽可放置复制、跳转等行内操作。

实际/标准、已收/未收等可比较数值应使用相同的字号、字重与 `tabular-nums`，只通过 `tone` 表达状态差异，避免颜色之外的排版变化干扰比较。

```vue
<template #cell-order="{ row }">
  <QsTableStackedCell class="group">
    <QsTableStackedLine weight="semibold" content-class="font-mono">
      {{ row.original.orderNo }}
      <template #suffix>
        <CopyCellButton label="订单号" :text="row.original.orderNo" />
      </template>
    </QsTableStackedLine>
    <QsTableStackedLine tone="muted" content-class="text-xs">
      {{ row.original.orderSource }}
    </QsTableStackedLine>
  </QsTableStackedCell>
</template>
```

复合单元格仍由列的 `accessorKey` 或 `accessorFn` 决定排序和默认复制值。如果每一行需要复制不同内容，应像上例一样在对应行的 `suffix` 中组合 `CopyCellButton`。移动端自定义卡片可以在 `mobile-row` 插槽中复用同一组件。

## 响应式约定

桌面端使用 `FaTable`，列设置和筛选使用 `FaPopover`；小于 `768px` 时使用结构化列表，列设置和筛选进入底部 `FaDrawer`。业务页面可通过 `mobile-row` 插槽提供更贴合领域的窄屏行布局。

加载首屏使用骨架占位；已有数据刷新时保留旧数据并降低透明度。错误、重试、空数据和无搜索结果均由组件提供稳定状态，具体数据副作用由业务页面处理。
