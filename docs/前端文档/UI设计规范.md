# UI 设计规范与页面开发指南

本文将千树 DMS 当前 UI 实现归纳为新页面的开发基线：沿用 Zinc 中性色、Green 主色、本地 Noto 字体和 Fa/Qs 组件体系，以清晰的信息层级、高效的数据操作和明确的状态反馈保持页面一致。

适用范围：`web/apps/qsmds-arco`。核对日期：`2026-09-13`；源码基线：`25d6d3a0`。本文是现有实现的总结，不引入新主题、组件接口或业务流程。组件默认值不等于所有调用页面的最终值；具体页面允许在既有契约内按任务调整。

## 1. 使用方式与设计基调

开发前先确定页面的主要任务和数据层级，再选现有组件。本文负责选型与组合；完整 Props、Events、Slots 继续以组件源码、组件 README 和[前端开发手册](./前端开发手册/README.md)为准。发生冲突时，项目规则与当前正式应用源码优先于历史文档、参考应用和上游最新示例。

依据 [PRODUCT.md](../../PRODUCT.md)，典型用户是长时间处理业务数据的内部业务人员与管理员，主要在桌面端操作，也需要在窄屏完成查询、查看和关键操作。

- **任务优先**：首屏能看清“这是什么页面、当前条件是什么、下一步能做什么”。
- **克制且有密度**：用字号、字重、间距与语义色建立层级；列表和表单不采用营销式大标题、装饰渐变、持续动画或重复卡片堆叠。
- **一致的操作语言**：同类查询、编辑、确认、关闭和反馈复用同一套组件与行为。
- **状态明确**：加载、空结果、无权限、失败和提交中分别处理；重要状态同时有文字，不能只靠颜色或悬停理解。
- **业务语义可核对**：金额带币种，汇总注明范围，日期遵循既有格式与时区，状态名称和动作以已确认业务规则为准。

## 2. 视觉基础

### 2.1 主题与颜色

当前默认设置是亮色模式，亮暗两套均选择 Green 主色、Zinc 基础色。颜色值由主题包和应用设置生成，页面使用语义类，不复制主题数值为局部常量。

| 用途 | 应使用的 token / 类 | 使用规则 |
| --- | --- | --- |
| 页面及内容底色 | `bg-background`、`bg-card` | 外层工作区背景由框架管理；内容容器优先复用 `FaPageMain` |
| 普通文字 | `text-foreground` | 正文、普通字段值和主要标题 |
| 说明文字 | `text-muted-foreground` | 来源、帮助、补充说明，不用于弱化关键错误 |
| 主操作与选中态 | `bg-primary`、`text-primary-foreground`、`text-primary` | 使用 `FaButton` 或现有选中态组件，避免自行拼装交互状态 |
| 次级表面与悬停 | `bg-muted`、`bg-accent`、`text-accent-foreground` | 按组件语义消费，不将所有灰色区域替换成同一种底色 |
| 边框、输入与焦点 | `border-border`、`border-input`、`ring-ring` | 保留组件现有 focus-visible、错误和禁用样式 |
| 危险与错误 | `text-destructive`、按钮 `variant="destructive"` | 用于错误、删除、作废等语义；仍需明确的文字说明 |

主色当前为亮色 `oklch(0.527 0.154 150.069)`、暗色 `oklch(0.448 0.119 151.328)`；这些值用于识别现有主题，开发时仍消费 token。状态色沿用对应领域现有映射，不额外创建一套全项目状态色枚举，也不把 Green 主色等同于所有“成功”状态。

实现支持亮色、暗色与跟随系统，但默认工具栏未启用明暗切换按钮，不能只根据 `toolbar.layout` 中有 `colorScheme` 就判断入口已显示。Arco Provider 同步明暗模式；这不代表 Arco 的所有品牌色已映射为 Fa 的 Green 主色，使用回退组件时仍须检查实际外观。

来源：[应用设置](../../web/apps/qsmds-arco/src/settings.ts)、[基础色选择](../../web/apps/qsmds-arco/src/settings.theme.ts)、[框架默认设置](../../web/packages/settings/src/default.ts)、[主题定义](../../web/packages/themes/index.ts)、[Arco Provider](../../web/apps/qsmds-arco/src/ui/provider/index.vue)。

### 2.2 字体与排版

普通中文、标题、说明、表单和操作使用 `--qs-font-sans`，即本地 `Noto Sans SC`；编码、单号、金额、数量与日期使用 `--qs-font-mono`，即 `Noto Sans Mono`，中文由 `Noto Sans SC` 承接。组件继承全局字体，不另建字体栈。

下表是高频角色速查，规格顺序为字号 / 行高 / 字重，像素按默认根字号 `16px` 换算。完整尺度与自动映射见[全局排版规范](./全局排版规范.md)，字体资产见[全局字体统一设计](./全局字体统一设计.md)。

| 内容 | 语义类 | 当前规格 |
| --- | --- | --- |
| 页面标题 | `qs-type-page-title` | 桌面 `24/32/600`，小于 `768px` 为 `20/28/600` |
| 业务分区 / 卡片组标题 | `qs-type-section-title` / `qs-type-component-title` | `18/28/600` / `16/24/600` |
| 正文 / 普通中文重点值 | `qs-type-body` / `qs-type-body-medium` | `14/20/400` / `14/20/500` |
| 说明 / 辅助信息 | `qs-type-description` / `qs-type-meta` | `14/20/400` / `12/16/400` |
| 表单控件 | `qs-type-form-control` | 桌面 `14/20/400`，小于 `768px` 为 `16/24/400` |
| 数量、百分比、日期 | `qs-type-data` | Mono，`14/20/400`，`tabular-nums` |
| 单号、编码、金额、数值汇总 | `qs-type-data-emphasis` | Mono，`14/20/500`，`tabular-nums` |
| 业务状态标签 | `qs-type-status-tag` | Sans，`12/16/600` |
| Modal / Drawer 标题 | `qs-type-dialog-title` | `18/24/600` |

`FaPageHeader`、Fa 表单控件、按钮、表头和弹出层标题已自动映射排版，调用方不必重复声明。表头是 `13/18/600` 的高密度特例。业务状态 Tag 必须显式增加 `qs-type-status-tag`；普通 Tag 不会自动升级为状态 Tag。

`qs-type-*` 只负责排版，不负责布局。不要同时保留冲突的 `text-*`、`font-*`、`leading-*`。`font-qs-data-mono` 只设置字体家族，新页面应优先使用完整数据角色。右对齐也不会自动启用 Mono。

来源：[globals.css](../../web/apps/qsmds-arco/src/assets/styles/globals.css)、[UnoCSS 配置](../../web/uno.config.ts)。

### 2.3 间距、圆角、层次与图标

| 对象 | 当前基线 | 开发用法 |
| --- | --- | --- |
| 页面头 | `FaPageHeader`：`px-5 py-4 mb-4 gap-5` | 标题、说明和页面级操作，不重复包一层同类页头 |
| 内容区 | `FaPageMain`：外层 `m-4`、内容 `p-4` | 默认内容卡片；可通过 `class` / `main-class` 调整已确认的布局 |
| 常用局部间距 | `gap-2`、`gap-3`、`gap-4`，即 `8/12/16px` | 作为组合建议，按按钮组、字段组、业务分区的层次使用；不是新的全局 token |
| 基础圆角 | `--radius = 0.5rem` | 默认 `rounded-sm/md/lg/xl = 4/6/8/12px`，随主题圆角设置变化 |
| 内容层次 | 边框、弱底色、适度留白 | 不给每组文字都加卡片；复杂分区沿用对应页面已有模式 |
| 浮层 | Qs Modal / Drawer 的 `shadow-xl` | 用于表达覆盖层级，不复制到普通列表行或每张内容卡片 |
| 图标 | `FaIcon`；导航使用 `qs-*` 品牌 SVG，工具操作使用现有 `i-lucide:*` 等通用图标 | 同类语义复用已有图标；纯图标按钮必须有可访问名称 |

默认按钮高度为 `36px`，`sm` 为 `32px`，`lg` 为 `40px`。不要通过缩小点击区域提高密度；移动端关键操作保持可点击、可识别。图标与禁用、悬停、焦点表现继续由组件管理。

品牌 SVG 保留 LOGO 的树绿、木棕和黑色轮廓，不随文字颜色变成单色。导航中的 `qs-*` 品牌图标使用 `24px`，保持菜单行高；原有通用菜单图标维持 `20px`。造型、尺寸、清单及接入方法见[图标制作与使用规范](./图标制作与使用规范.md)；当前项目图标可在组件库 `/component-library/basic/icons` 检索和预览。

来源：[FaPageHeader](../../web/packages/components/src/basic/page-header/index.vue)、[FaPageMain](../../web/packages/components/src/basic/page-main/index.vue)、[按钮样式](../../web/packages/components/src/basic/button/button/index.ts)、[UnoCSS 圆角映射](../../web/uno.config.ts)。

## 3. 页面结构与组件选型

已有 Qs 组件封装了项目确认的交互，满足任务时直接复用。需要寻找新的底层能力时，按 [Web 协作规则](../../web/AGENTS.md)依次核对：Fantastic-admin 内置组件 → Arco Design Vue → 基于 Arco 的应用级自定义组件 → 基于原生 Vue 的自定义组件。只有上一级无法满足已确认契约时才回退。

| 页面任务 | 推荐组合 | 职责边界 |
| --- | --- | --- |
| 通用查询管理页 | `FaPageHeader + FaPageMain + QsGenericTable` | 页面持有 API、数据、权限和领域动作；表格持有查询与展示交互 |
| 按业务状态处理列表 | 上述组合 + `QsStatusSwitchToolbar` | 状态切换位于数据表格前，计数口径、分页重置和请求由页面负责 |
| 聚焦式新增 / 编辑 / 确认 | 领域表单 + `QsGenericModal` | 标题、校验、提交和关闭守卫由领域调用方组合 |
| 保留列表上下文查看详情 | 领域详情 + `QsGenericDrawer` | 订单优先检查现有 `QsSalesOrderDrawer` / `QsPurchaseOrderDrawer` |
| 长流程或复杂编辑 | 独立路由 + 分区表单 | 遵循已有页面的信息结构；不强行塞进小弹窗 |
| 主从配置管理 | 页面头 + 主列表 / 详情区 | 可参考字典管理双栏；窄屏需重排，不作为所有页面的默认布局 |

推荐列表结构：

```text
框架导航与工具栏（布局层管理）
└─ 业务页面
   ├─ FaPageHeader：标题、说明、页面级操作
   ├─ QsStatusSwitchToolbar：可选，单选业务状态
   ├─ FaPageMain
   │  └─ QsGenericTable
   │     ├─ 查询工具栏：日期等前置条件、搜索、筛选、列设置、新增
   │     ├─ 桌面表格 / 移动卡片 / 加载、错误、空结果
   │     └─ 汇总与分页
   └─ 领域 Modal / Drawer：由当前动作打开
```

同一“新增”动作只保留一个主要入口，可放页头或表格工具栏。保留页头查询栏的页面应显式关闭表格重复能力。`QsGenericTable` 已提供搜索、筛选、列设置、新增入口、分页和状态区，不在页面外再搭一套。

## 4. 列表、单元格与数据展示

### 4.1 查询和操作

- `QsGenericTable → FaTable → TanStack Table` 是当前通用列表实现，分页使用 `FaPagination`。
- 受控状态为 `page`、`pageSize`、`search`、`filters`、`sorting`。默认第一页、每页 `20`，可选 `20/50/100/200`。
- 表格不会自行请求 API，也不会替页面完成远程查询；页面接收 `search`、`filterChange`、`sortingChange`、`paginationChange` 请求数据，避免事件与 watcher 重复触发相同请求。
- 筛选先编辑草稿，点击“应用筛选”才生效。内置搜索、筛选、排序和页大小变更会回到第一页；`query-leading` 中自定义日期等条件的分页重置仍由页面负责。
- 列使用稳定 `id`、明确 `title` 和数据访问器；`rowKey` 使用稳定业务标识。默认行号最左、操作列最右；如业务单号承担首列导航，可沿用订单页面关闭行号。
- `actions` 插槽才会生成操作列，默认宽 `160px`，可按真实按钮数量调整。权限、禁用原因、确认框和写入由页面负责；桌面与移动端共享这组操作。

主行操作优先明确文字，次级操作按现有页面放入更多菜单。按钮可使用当前实际支持的 `default`、`destructive`、`outline`、`secondary`、`ghost`、`link`，不要照搬历史示例中的 `expand`。

### 4.2 数据角色与移动端

| 内容 | 实现方式 |
| --- | --- |
| 普通中文值 | 默认 Sans；重点文字用 `qs-type-body-medium` |
| 单号 / 编码 | 桌面列 `cellClass: 'qs-type-data-emphasis'`；需要复制时使用 `copyable` 或 `CopyCellButton` |
| 金额 / 日期 | 优先 `AmountDisplay` / `DateTimeDisplay`；不要在每个页面重复拼接格式 |
| 一列多行信息 | `QsTableStackedCell + QsTableStackedLine`，明确主信息、辅助信息和数值角色 |
| 图片与产品提示 | `ImageGroup`；逐项 `tooltip` slot 使用无浮层的 `QsGoodTooltipContent`，按稳定图片 key 映射产品 |
| 业务状态 | `FaTag` 等既有展示组件 + `qs-type-status-tag` + 文字状态 |

**桌面与移动 slot 的行参数不同。** `cell-*` 接收 TanStack 行，业务数据在 `row.original`；`mobile-row` 和 `actions` 的 `row` 已是原始业务对象。默认移动卡片不会自动复用桌面的 `cell-*` 或 `cellClass`；有格式化金额、日期、图片或复杂状态时，必须显式组合 `mobile-row`。

以下仅演示插槽结构，`columns`、`rows`、币种与权限应接入目标页面的真实契约；不代表新增业务模型。Qs 和应用基础组件需显式导入：

```vue
<script setup lang="ts">
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

const currencyCatalog = useCurrencyCatalog()
const { t } = useI18n()
</script>

<template>
  <QsGenericTable :columns="columns" :data="rows" :addable="false">
    <template #cell-amount="{ row }">
      <AmountDisplay
        :value="row.original.amount"
        :currency="row.original.currency"
        :currencies="currencyCatalog.currencies.value"
      />
    </template>
    <template #mobile-row="{ row }">
      <div class="flex items-center justify-between gap-3">
        <span class="qs-type-data-emphasis">{{ row.code }}</span>
        <AmountDisplay
          :value="row.amount"
          :currency="row.currency"
          :currencies="currencyCatalog.currencies.value"
        />
      </div>
    </template>
    <template #actions="{ row }">
      <FaButton variant="ghost" size="sm" @click="openDetail(row)">
        {{ t('common.view') }}
      </FaButton>
    </template>
  </QsGenericTable>
</template>
```

示例中的 `t('common.view')` 是待接入文案占位，不能假设仓库已有该 key。`AmountDisplay` 必须同时接收 `value`、`currency`、`currencies`，货币目录通过应用已注入的 Provider 获取，并处理其加载失败状态。自定义移动卡片不要再复制 `actions`，表格会在卡片底部追加操作区。

Tooltip 只放补充信息，关键产品名称、状态和操作仍须直接可见。逐图提示不能嵌套自带浮层的 `QsGoodTooltip`；只有整组图片对应同一产品时，才用外层 `QsGoodTooltip` 并设置 `ImageGroup :tooltip="false"`。具体组合见 [ImageGroup README](../../web/apps/qsmds-arco/src/components/base/ImageGroup/README.md)。

### 4.3 金额与汇总口径

金额录入使用 `MoneyInput`，公开金额值为 `string | null`，币种单独传递；精度、负数和范围按业务规则校验。只读格式化不替代持久化校验。输入币种是否可选由业务控制，不因组件支持切换就放开订单币种修改。

`QsGenericTable` 默认汇总当前页 `data`；服务端全量结果可通过 `summaryValues` 或 `summary` 插槽传入。当前内置 `sum/average` 使用 `Number`，精确金额应使用现有 `sumMoneyValues` 或服务端精确汇总，不直接依赖通用数值汇总。不同币种分别统计，不将 TWD、MYR 等直接相加。

移动端默认列汇总区标题为“当前页汇总”。如果展示全量或跨币种领域汇总，优先使用 `summary` 插槽显式写清“当前条件下全部记录”等口径，避免值的范围与标题不符。

来源：[QsGenericTable README](../../web/apps/qsmds-arco/src/components/business/QsGenericTable/README.md)、[表格源码](../../web/apps/qsmds-arco/src/components/business/QsGenericTable/index.vue)、[汇总逻辑](../../web/apps/qsmds-arco/src/components/business/QsGenericTable/logic.ts)、[金额输入](./前端开发手册/自定义组件库/基础组件/金额输入.md)、[金额显示](./前端开发手册/自定义组件库/基础组件/金额显示.md)。

## 5. 表单、详情与弹出层

表单优先复用当前公开导出的 `FaForm + FaFormItem` 及对应输入组件；label、帮助与校验消息由 `FaFormItem` 契约处理，不引用未公开导出的 `FaFormField` 等名称。回退 Arco 表单时，必须重新核对校验、提交与 slot 语义，不能只替换标签名。控件有明确 label，必填、格式限制和错误贴近字段；placeholder 不替代 label。

`FaForm` 使用 `model`、`validationSchema` 与 `submit`；`required` 标记不替代实际校验。`FaFormItem` 默认自动绑定第一个子节点，遇到布局容器或复合控件时使用 `:auto-bind="false"` 并显式维护数据、事件和禁用状态。长表单可按需启用 `scrollToError`。

字典选择优先 `QsDictionarySelect`，地区选择优先 `QsRegionSelector`，产品选择优先 `QsProductSelector`。这类领域组件的 Provider、权限、有效性和数据映射继续按各自契约接入，不在页面内另建同类选择器。例如供应商选择使用 `service_provider.supplier` 的稳定字典值。

| 表面 | 当前默认值与尺寸 | 开发要求 |
| --- | --- | --- |
| `QsGenericModal` | 默认 `md`；`sm/md/lg/xl` 最大宽度为 `30/35/45/56rem` | 聚焦任务；窄屏两侧各留 `12px`，正文独立滚动 |
| `QsGenericDrawer` | 默认右侧、`md`；右侧桌面 `sm/md/lg/xl` 宽度为 `24/30/40/48rem` | 上下文详情或侧滑任务；小于 `768px` 的右侧抽屉占满视口宽度 |
| 底部 Drawer | 调用方设置 `placement="bottom"`，最大高度 `calc(100dvh - 1rem)` | 按页面任务用于窄屏；不会仅因屏幕变窄就自动改为底部 |

当前两个 Qs 通用弹出层都只支持 `sm/md/lg/xl`，不传入不存在的 `full`。Modal 桌面最大宽度类从 `sm` 断点生效；Drawer 右侧尺寸类从 `md` 生效。不要把两者尺寸和断点混用。

- 标题始终明确，说明只解释当前任务；保留键盘焦点、Escape 和关闭后的焦点恢复。
- Header / Footer 保持稳定，正文负责滚动；避免内容再套固定高度滚动区而形成双滚动条。
- 绑定 `loading`、`error`、`submitting`。组件提供加载与失败表面，重试按钮由调用方放入 `error-actions` 插槽，组件没有 `retry` 事件；Footer 的取消、提交、危险确认也由调用方提供。
- `submitting` 会阻止关闭并禁用 Footer 交互，但不会自动禁用正文表单；页面仍需绑定 `FaForm :disabled="submitting"` 或对应控件状态。成功后先释放提交状态，再请求关闭，避免被关闭守卫拦住。失败后保留表单并展示可理解的错误。
- Footer 插槽从首次渲染起稳定存在，将按钮显示条件放在插槽内部，避免异步加载后遗漏底部操作。
- 未保存变更等场景通过 `beforeClose` 控制；其异常会阻止关闭，调用方负责说明原因。不要假设所有弹出层都自动有取消 / 保存按钮。

来源：[Modal 契约](../../web/apps/qsmds-arco/src/components/business/QsGenericModal/logic.ts)、[Drawer 契约](../../web/apps/qsmds-arco/src/components/business/QsGenericDrawer/logic.ts)、[Fa 表单选型](./前端开发手册/Fantastic-admin内置组件/选型与使用规则.md)、[自定义组件手册](./前端开发手册/自定义组件库/README.md)。

## 6. 状态反馈与操作文案

| 状态 | 页面应呈现的结果 |
| --- | --- |
| 首次加载 | 将 `loading` 交给对应组件；表格无数据时显示骨架，不同时显示“暂无数据” |
| 已有数据刷新 | 表格保留旧数据、降低透明度并阻止数据区指针操作，避免闪成空列表；具体动作仍按请求状态防重复 |
| 查询失败 | 在对应内容区显示错误和重试；必要说明用 `FaAlert`，不要只留一次性 Toast |
| 无数据 | 说明当前没有记录；有创建权限且符合流程时给出下一步 |
| 筛选无结果 | 说明当前条件没有匹配记录，并允许调整或清除条件 |
| 无权限 | 页面级 `FaEmpty` 或既有权限提示；不伪装为空列表，不继续请求无权资源 |
| 提交中 | 保留上下文，按钮 loading / disabled，防止重复提交并遵循关闭守卫 |
| 成功 | 使用现有 Toast 反馈，并刷新受影响的数据或按流程关闭表面 |
| 危险操作 | 确认文案包含对象、动作及后果；执行后同步列表 / 详情状态 |
| 辅助数据失败 | 在受影响区域提示并按依赖程度禁用相关操作，不误报主列表加载失败 |

轻提示优先复用 `QsToast` 或页面既有 Fa Toast，宿主由 `App.vue` 挂载一次，不新增第二个 Toast 容器。Toast 用于短时反馈，不替代字段错误、持续失败、权限提示或加载表面。

新文案按 Web 规则进入 i18n，技术标识仍用英文。按钮使用“新增、保存、取消、查看、重试”等明确动作；同类流程沿用已有术语。现有页面的 i18n 覆盖并不完整，不能把存量中文硬编码当成新代码标准。前端隐藏按钮只改善体验，不替代服务端鉴权。

来源：[QsToast](../../web/apps/qsmds-arco/src/components/base/QsToast/README.md)、[App.vue](../../web/apps/qsmds-arco/src/App.vue)、[用户列表](../../web/apps/qsmds-arco/src/views/system/users/index.vue)、[接口接入规范](./接口接入规范.md)。

## 7. 响应式、无障碍与动效

响应式通过结构重排保留任务，不把桌面表格整体缩小。

- **导航与内容断点不同**：框架按移动 UA 或桌面窗口小于 `1024px` 进入移动模式；通用表格小于 `768px` 使用卡片；表单控件同样在小于 `768px` 使用 `16px` 字号。
- **桌面**：列宽服务于内容，金额和数量按需要右对齐；长表格的滚动留在表格区域，固定列不能遮挡正文或操作。
- **窄屏**：卡片优先呈现主标识、关键状态、金额 / 日期与动作；次要内容可换行或进入详情。查询工具栏允许换行，长单号不能撑宽整个页面。
- **状态导航**：`QsStatusSwitchToolbar` 支持局部横向浏览及更多提示，该局部滚动不等于允许整个页面横向溢出。
- **键盘**：交互元素使用真实 button / input 等语义，Tab 可到达主操作，焦点可见；纯图标按钮有 `aria-label`，状态不能仅靠颜色表达。
- **动效**：默认页面 `fade` 入场 `200ms`、离场 `150ms`；Qs 浮层入场 `220ms`、离场 `180ms`。沿用组件，不给每块内容追加入场编排。新增非必要动效应尊重 `prefers-reduced-motion`，不能推定现有所有动效已覆盖。

来源：[布局设置 Store](../../web/apps/qsmds-arco/src/store/modules/app/settings.ts)、[布局动效](../../web/apps/qsmds-arco/src/layouts/index.vue)、[状态工具栏](../../web/apps/qsmds-arco/src/components/business/QsStatusSwitchToolbar/README.md)。

## 8. 新页面开发顺序与参考入口

1. **确认任务与事实**：页面目标、所属导航、权限、字段含义、币种 / 时区、查询与汇总范围。接口和领域状态以正式契约为准。
2. **选取同类参考**：先确定列表、详情、配置或编辑模式，再复用对应页面的结构；只复制已核对的组件组合，不连带复制无关业务逻辑。
3. **建立最小骨架**：页头、内容容器、主要任务区、必要弹出层。保留框架导航职责，确定每个动作的唯一入口。
4. **接入数据与状态**：受控查询、权限、加载 / 失败 / 空结果、提交反馈与关闭守卫一并实现。
5. **补充展示语义**：桌面列与移动卡片分别标注数据角色；复用金额、日期、图片、字典等现有组件。
6. **验证后交付**：检查亮暗、桌面和窄屏、键盘与长内容边界；行为变更按项目规则使用有意义的失败测试与定向验证。

| 参考对象 | 可复用的结构 | 注意事项 |
| --- | --- | --- |
| [用户管理](../../web/apps/qsmds-arco/src/views/system/users/index.vue) | 标准列表、权限入口、操作弹窗与窄屏卡片 | 账号保护与角色规则属于本领域 |
| [销售订单](../../web/apps/qsmds-arco/src/views/operations/sales-orders/index.vue) | 状态工具栏、复合单元格、业务详情与条件查询 | 不把订单专属动作和宽度当成通用默认 |
| [采购订单](../../web/apps/qsmds-arco/src/views/operations/purchase-orders/index.vue) | 待办模式、状态切换、日期条件、领域汇总 | 部分操作仍有建设中提示，不能据此宣称流程已完整实现 |
| [字典管理](../../web/apps/qsmds-arco/src/views/system/basic-data/dictionaries/index.vue) | 主从配置页、类别与条目分区 | 按数据关系选用双栏，不套用到全部管理页 |
| [组件库路由](../../web/apps/qsmds-arco/src/router/modules/component.library.ts) | 独立组件 Showcase、边界场景和真实导入方式 | DEV 默认可用；非开发环境需显式开启；仍受应用认证影响 |

组件库中的“页面模板”目前是说明性占位，不是可直接复制的完整 CRUD 模板。组件 Showcase 用于观察组件契约，正式业务页面用于学习领域组合；两者不能互相替代。

工程入口：页面放在 `src/views/`，领域组件在 `src/components/business/`，应用基础组件在 `src/components/base/`。这些路径相对正式应用。嵌套的 Qs / 基础组件应显式导入；自动注册扫描 `src/components/*/index.vue`，不能假定更深目录自动注册。Fa 组件经 resolver 接入。详见 [Vite 插件配置](../../web/apps/qsmds-arco/vite/plugins.ts)。

## 9. 开发验收清单

- [ ] 页面标题、说明、查询条件与主要动作清楚；不存在重复查询栏或重复新增入口。
- [ ] 复用现有组件、主题色与全局字体；普通中文没有被误设为 Mono。
- [ ] 金额、日期、单号与状态使用正确语义；汇总范围明确，不跨币种直接相加。
- [ ] 桌面单元格与移动卡片分别检查；复制、查看和主要动作在触控与键盘下可用。
- [ ] 加载、错误重试、空结果、无权限、禁用和提交中均有正确表现。
- [ ] Modal / Drawer 长内容可滚动，Footer 可达；提交失败保留输入，成功可关闭，焦点恢复正常。
- [ ] 以桌面及 `390×844` 窄屏作为建议检查尺寸，覆盖亮色与受控暗色；临时主题 / 视口状态检查后恢复。
- [ ] 检查实际 `font-family`、字号、行高、字重、数据 `tabular-nums`；页面根元素满足 `document.documentElement.scrollWidth <= document.documentElement.clientWidth`，允许表格等局部容器按设计滚动；控制台无本次新增异常。
- [ ] 运行与改动匹配的定向测试；需要完整 Web 验证时，在仓库根执行 `pnpm -C web check`、`pnpm -C web build`，共享组件变更另查参考应用影响。

本次文档整理已核对主题、排版、组件源码和代表性页面。运行中的前端返回 HTTP 200；浏览器只读检查到登录页，其正文为 Noto Sans SC、`14px/20px`，当前亮色且无页面水平溢出。业务页面的完整视觉、暗色、窄屏和操作流程未在本次重新验收，上述清单是后续开发要求，不是本次测试通过记录。

主题、全局排版、组件公开契约或代表性页面模式发生变化时，应同时复核本文受影响段落、对应专项文档和[文档索引](../文档索引.md)。
