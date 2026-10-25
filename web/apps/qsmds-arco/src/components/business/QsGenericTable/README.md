# QsGenericTable

`QsGenericTable` 是以 `FaTable`（TanStack Table）为表格内核、以 `FaPagination` 为分页器的业务通用表格。组件只管理查询条件和展示状态，不请求 API，也不依赖 Store。

## 受控状态

- `v-model:page`：当前页，从 `1` 开始，默认值为 `1`。
- `v-model:page-size`：每页数量，默认值为 `20`。
- `v-model:search`：已应用的搜索词。
- `v-model:filters`：已应用的筛选条件。
- `v-model:sorting`：TanStack Table 排序状态。
- `v-model:expanded`：分组展开状态，类型为 `TableExpandedState`，默认 `true`（全部展开）。传 `{}` 可全部收起，或传以组键为键、布尔值为值的对象控制指定组。

翻页、搜索或筛选时恢复默认全部展开；同页数据更新与排序保留稳定组键对应的折叠状态。

查询、筛选、排序和分页变化后，业务页面通过对应事件请求数据。切换每页数量、搜索、筛选或排序时，组件会把页码归一到第一页。

筛选面板中的选择首先写入草稿，只有点击“应用筛选”才会更新 `v-model:filters`。无已应用条件时入口显示“筛选”；单个条件显示“已筛选：条件名称”；多个条件显示“已筛选：多个条件”，并使用激活状态提示当前结果受筛选影响。“重置”会清空已应用条件并恢复默认入口状态。

## 列与汇总

`columns` 在 `TableColumn` 基础上增加以下业务配置：

- `id`、`title`：稳定列标识与展示标题。
- `defaultVisible`：列是否默认显示。
- `fixed`：默认固定到 `left` 或 `right`。
- `align`：默认内容对齐，可选 `left`、`center`、`right`，未设置时使用 `left`。
- `copyable`：是否启用单元格复制入口，默认关闭。
- `copyMode`：复制入口形态，`button`（默认）显示复制图标，`text` 直接让单元格文本可点击复制，适合编号列。
- `mobileCellClass`：窄屏通用卡片的取值排版类；不传时沿用 `qs-type-body`，编号列可传 `qs-type-data-emphasis` 保持等宽字体。
- `sortable`：是否允许排序。
- `summary`：支持 `count`、`average`、`sum`，可通过 `component` 和 `componentProps` 指定汇总渲染组件。

行号列由组件生成，默认固定在最左侧且不参与列设置。`showRowNumber` 默认 `true`；业务编号需要作为最左列时可设为 `false`，同时隐藏桌面行号和默认移动卡片行号。其他页面不传此参数时保持原样，移动插槽的 `row-number` 仍可读取。行号按照 `(page - 1) * pageSize + rowIndex + 1` 连续计算。

`copyable: true` 默认会为桌面单元格追加复制按钮，按钮在悬停或键盘聚焦时显示；默认窄屏卡片始终显示复制入口。设置 `copyMode: 'text'` 后不再渲染按钮，而是让单元格文本本身可点击复制，并在悬停时提示“点击可复制”，适合订单号等编号列；成功和失败反馈由文本组件的 tooltip 与 `aria-live` 承担。复制内容取自列 `accessorKey` 或 `accessorFn` 的当前值。使用自定义 `mobile-row` 插槽时，业务页面可以按需组合 `CopyCellButton` 或 `QsCopyableText`。

“列设置”支持在运行时调整显隐、左右固定与内容对齐，表头、单元格和汇总内容会同步更新。“恢复默认”会还原 `columns` 中声明的初始状态。`columnSettingsChange` 事件返回每列的 `visible`、`fixed` 和 `align` 状态，业务页面可按需持久化。

已有页面需要保留自己的页头工具栏时，可将 `searchable`、`addable`、`showColumnSettings` 设为 `false`；筛选定义同时为空时，组件不会保留空工具栏间距。`showColumnSettings` 默认值为 `true`。

`query-leading` 插槽位于搜索框之前，用于日期范围等结构化查询控件。组件只负责工具栏
排列和响应式换行；插槽内容的状态、查询字段映射、分页重置和 API 请求仍由业务页面负责。
只有 `query-leading` 插槽而没有搜索、筛选、列设置或新增入口时，工具栏仍会正常显示。

默认汇总当前页 `data`；服务端分页场景可通过 `summaryValues` 传入全量数据汇总结果。页面也可以提供 `summary-{columnId}` 插槽覆盖桌面端表尾内容。

`summary`：可选全宽汇总区域，位于数据区域之后、分页之前，适合展示跨列矩阵等领域汇总；内容、响应式布局与业务语义由调用页面负责。

## 分组展示

`grouping` 为可选能力；不传时保持平铺表格行为。启用后，`data` 表示**当前页完整的父组数组**，每组携带全部子行。组件不自行请求、切分、排序或聚合业务数据，也不根据相同字段自动生成分组。

从 `./logic` 导入 `QsGenericTableGrouping<TData>`：

| 配置 | 类型 | 用途 |
| --- | --- | --- |
| `getRows` | `(group: TData) => readonly TData[]` | 提取组内明细，保留调用方提供的顺序 |
| `getLabel` | `(group: TData) => string` | 默认组标题，同时为展开按钮提供可读标签 |

父组与子行沿用同一个 `TData`；可使用含可选 `children` 字段的行类型，或用可辨识联合类型表达两类数据。必须提供稳定的 `rowKey`，父组和子行分别保证键不重复，不能使用当前排序或分页后的数组下标作为业务键。只有一层分组，不递归解释子行中的嵌套数据。

### 分页、排序与汇总

- `pageSize`、`total` 均按**组数**计数；先按组筛选、排序和分页，再将当前页完整组传入 `data`。不得先把子行分页后重新拼组，否则同组明细可能被拆到不同页面。
- 排序事件仍由页面处理。页面决定组间排序，组内顺序保持 `getRows` 的返回顺序。
- `paginationUnit` 可自定义计数单位，例如“个采购单”。默认平铺为“条”，分组为“组”。
- 分组模式自动隐藏普通行号列，`group-header` 中的 `rowNumber` 为跨页连续组号。
- 默认列汇总只统计当前页全部子行，排除父组且不受折叠影响。金额字符串应像现有平铺示例一样通过 `sumMoneyValues` 精确计算，再传入 `summaryValues`；不要把父组总额与子行金额重复累计。

### 组头与子行插槽

组标题横跨可见列，组件负责展开按钮、键盘操作和展开状态。`group-header` 只定制标题内容，不必重复实现折叠按钮；窄屏复用同一插槽。

| `group-header` 参数 | 含义 |
| --- | --- |
| `row` | 原始父组对象 |
| `rows` | 完整子行数组 |
| `groupKey` | 从 `rowKey` 解析出的稳定组键 |
| `index` | 当前页内的组索引，从 `0` 开始 |
| `rowNumber` | 跨页连续组号，从 `1` 开始 |
| `expanded` | 当前组是否展开 |

分组模式下，`actions` 和 `mobile-row` 只渲染子行，原有 `row`、`index`、`rowNumber` 参数保留，并追加 `group`（父组对象）、`groupIndex`（当前页内组索引）和 `groupKey`；普通平铺模式下这三个分组参数均为 `undefined`。分组下 `index` 是组内子行索引，`rowNumber` 是所在组的跨页连续组号。`cell-*` 沿用 FaTable 的单元格上下文，子行数据仍通过 `row.original` 读取。

```vue
<script setup lang="ts">
import type { TableExpandedState } from '@fantastic-admin/components'
import type { QsGenericTableGrouping } from '@/components/business/QsGenericTable/logic'

interface DetailRow {
  id: string
  name: string
  amount: string
  children?: DetailRow[]
}

const expanded = ref<TableExpandedState>(true)
const grouping: QsGenericTableGrouping<DetailRow> = {
  getRows: group => group.children ?? [],
  getLabel: group => group.name,
}
// columns、pageGroups、totalGroups、page、pageSize 由页面维护；pageGroups 为已分页完整组。
</script>

<template>
  <QsGenericTable
    v-model:page="page"
    v-model:page-size="pageSize"
    v-model:expanded="expanded"
    row-key="id"
    :columns="columns"
    :data="pageGroups"
    :grouping="grouping"
    :total="totalGroups"
    pagination-unit="个批次"
  >
    <template #group-header="{ row, rows, rowNumber }">
      <span class="qs-type-data-emphasis">#{{ rowNumber }} {{ row.name }}</span>
      <span class="qs-type-meta">{{ rows.length }} 笔明细</span>
    </template>
    <template #actions="{ row, group }">
      <FaButton v-if="group" variant="ghost" size="sm" @click="openDetail(group, row)">
        查看
      </FaButton>
    </template>
  </QsGenericTable>
</template>
```

可交互示例见组件库“业务通用表格”下的“按批次分组”：24 个本地批次、每组两笔明细，演示整组分页、组排序、受控展开、空数据切换、自定义组头、子行操作和精确金额汇总。桌面表格与窄屏卡片使用同一份组数据。

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
