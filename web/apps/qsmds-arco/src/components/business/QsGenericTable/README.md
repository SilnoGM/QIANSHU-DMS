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

已有页面需要保留自己的页头工具栏时，可将 `searchable`、`addable`、`showColumnSettings` 设为 `false`；筛选定义同时为空时，组件不会保留空工具栏间距。`showColumnSettings` 默认值为 `true`。

`query-leading` 插槽位于搜索框之前，用于日期范围等结构化查询控件。组件只负责工具栏
排列和响应式换行；插槽内容的状态、查询字段映射、分页重置和 API 请求仍由业务页面负责。
只有 `query-leading` 插槽而没有搜索、筛选、列设置或新增入口时，工具栏仍会正常显示。

默认汇总当前页 `data`；服务端分页场景可通过 `summaryValues` 传入全量数据汇总结果。页面也可以提供 `summary-{columnId}` 插槽覆盖桌面端表尾内容。

`summary`：可选全宽汇总区域，位于数据区域之后、分页之前，适合展示跨列矩阵等领域汇总；内容、响应式布局与业务语义由调用页面负责。

## 操作列

提供 `actions` 作用域插槽时，组件自动在业务列之后追加操作列；没有该插槽时不会生成空列，现有调用方的表格结构保持不变。操作列默认标题为“操作”、宽度为 `160`、固定在右侧，并且不参与排序、列显隐和汇总。

`actionColumn` 可配置 `title`、`width`、`minWidth`、`maxWidth`、`align` 和 `fixed`。`fixed` 默认是 `right`；显式传入 `false` 可取消固定，也可以沿用表格固定列契约传入 `left` 或 `right`。业务列不得使用保留标识 `__qs_generic_table_actions__`。

`actions` 插槽提供原始业务行 `row`、当前页内索引 `index` 和跨分页连续行号 `rowNumber`。按钮、权限判断、禁用条件、确认交互与数据写入均由业务页面负责，通用表格不预设“查看”“编辑”或“删除”等动作。

```vue
<QsGenericTable :columns="columns" :data="rows" :action-column="{ width: 168 }">
  <template #actions="{ row, rowNumber }">
    <FaButton
      variant="ghost"
      size="sm"
      :aria-label="`编辑第 ${rowNumber} 行`"
      @click="openEditor(row)"
    >
      编辑
    </FaButton>
  </template>
</QsGenericTable>
```

桌面端操作列遵循固定列的滚动边界样式；小于 `768px` 时，同一 `actions` 插槽会渲染在卡片底部。即使业务页面覆盖 `mobile-row`，操作区仍由组件追加，因此不需要重复维护一套窄屏操作逻辑。

## 排版约定

组件通过全局排版 Token 自动提供 `table-header` 表头和 `body` 普通正文。结构化数据必须由业务调用方显式声明：订单号、结算单号和金额使用 `qs-type-data-emphasis`，数量、百分比和日期时间使用 `qs-type-data`，来源、行号和辅助说明使用 `qs-type-meta`，状态标签使用 `qs-type-status-tag`。只有这些明确的数据角色启用 Mono 或 `tabular-nums`；普通中文值继续使用 Sans。

桌面列优先通过现有 `cellClass` 声明单值语义；复合内容和移动卡片通过 `cell-*`、`mobile-row` 插槽声明；日期时间和金额优先复用 `DateTimeDisplay`、`AmountDisplay`。右对齐只表达布局，组件不会根据 `align`、列名或文案推断数据语义。

## 复合单元格

需要在一列内展示主信息、辅助说明、两组金额或多个状态时，使用 `QsTableStackedCell` 与 `QsTableStackedLine` 组合现有的 `cell-{columnId}` 插槽。两个组件只管理纵向节奏和逐行样式，不内置订单、金额等业务语义。

`QsTableStackedLine` 支持 `label`、`tone`、`weight`、`nowrap`，以及 `labelClass`、`contentClass`、`suffixClass`。组件根节点也接受普通 `class`；`suffix` 插槽可放置复制、跳转等行内操作。

实际/标准、已收/未收等可比较数值应使用相同的字号、字重与 `tabular-nums`，只通过 `tone` 表达状态差异，避免颜色之外的排版变化干扰比较。

```vue
<template #cell-order="{ row }">
  <QsTableStackedCell class="group">
    <QsTableStackedLine content-class="qs-type-data-emphasis">
      {{ row.original.orderNo }}
      <template #suffix>
        <CopyCellButton label="订单号" :text="row.original.orderNo" />
      </template>
    </QsTableStackedLine>
    <QsTableStackedLine tone="muted" content-class="qs-type-meta">
      {{ row.original.orderSource }}
    </QsTableStackedLine>
  </QsTableStackedCell>
</template>
```

复合单元格仍由列的 `accessorKey` 或 `accessorFn` 决定排序和默认复制值。如果每一行需要复制不同内容，应像上例一样在对应行的 `suffix` 中组合 `CopyCellButton`。移动端自定义卡片可以在 `mobile-row` 插槽中复用同一组件。

## 响应式约定

桌面端使用 `FaTable`，列设置和筛选使用 `FaPopover`；小于 `768px` 时使用结构化列表，列设置和筛选进入底部 `FaDrawer`。业务页面可通过 `mobile-row` 插槽提供更贴合领域的窄屏行布局。

加载首屏使用骨架占位；已有数据刷新时保留旧数据并降低透明度。错误、重试、空数据和无搜索结果均由组件提供稳定状态，具体数据副作用由业务页面处理。
