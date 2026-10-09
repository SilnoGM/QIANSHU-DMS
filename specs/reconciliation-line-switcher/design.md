# 对账明细行切换组件（QsReconciliationLineSwitcher）设计说明

| 项目 | 说明 |
| --- | --- |
| 状态 | **已确认并实现**（2026-10-09 用户拍板 7 条口径；原型与组件均已浏览器实测） |
| 分支 | `feat/slh-reconciliation-line-switcher` |
| 原型 | `specs/reconciliation-line-switcher/prototype.html`（自包含，无需构建） |
| 组件 | `web/apps/qsmds-arco/src/components/business/QsReconciliationLineSwitcher/` |
| 组件库入口 | `/component-library/business/reconciliation-line-switcher` |

## 1. 目标与边界

在「对账明细行」这类**有序、可逐条核对**的集合上提供单条切换：折叠形态聚焦当前行（选中项放大），展开形态纵览全部行。组件只表达「选中了哪一行」，不承载核对写入、请求、权限或路由。

非目标：不做虚拟滚动、不做多选、不做分组、不内置任何状态字面量或状态色常量。

## 2. 接口契约

```ts
export type QsReconciliationLineSwitcherTone = 'danger' | 'success' | 'warning' | 'neutral'

export interface QsReconciliationLineSwitcherItem {
  /** 稳定标识（明细行 id）；组件把它用作列表 key 与 v-model 值。 */
  readonly value: string
  /** 面向用户展示的短标签，对账域传唛头。 */
  readonly label: string
  /** 状态取值，由调用方定义；组件只用它查 statusTones。 */
  readonly status: string
  /** 可选：无障碍朗读用的状态文案，缺省回退到 status。 */
  readonly statusLabel?: string
}
```

| 类型 | 名称 | 默认 / 说明 |
| --- | --- | --- |
| prop | `items` | 必填，顺序即左右顺序 |
| prop | `statusTones?: Record<string, QsReconciliationLineSwitcherTone>` | 默认 `{}`；未登记的状态回落 `neutral`（灰） |
| prop | `visibleSideCount?: number` | 默认 3；折叠条带槽位数 = `2 * 该值 + 1`；非法值回落默认值 |
| prop | `ariaLabel?: string` | 默认取 i18n `qsReconciliationLineSwitcher.ariaLabel` |
| model | `defineModel<string \| null>({ required: true })` | **受控**：选中值由页面持有 |
| 内部状态 | `expanded` | 折叠/展开为纯视图状态，默认折叠，不外露 |

**受控理由**：选中行通常要驱动对照面板、深链或路由参数，属页面职责；组件擅自选择默认值会制造第二个真相源。与 `QsStatusSwitchToolbar` 的既有约定一致。

**事件**：仅 `update:modelValue`。不做插槽，不做每侧项数以外的可配项。

文案在 `src/locales/lang/qs-reconciliation-line-switcher/{zh-cn,zh-tw,en}.json`，键为 `ariaLabel / previous / next / expand / collapse / empty / itemAriaLabel`，三语键由测试强制对齐。

## 3. 两种形态

### 3.1 折叠形态（默认）

```text
[‹ 上一条]  [槽1][槽2][槽3][槽4][槽5][槽6][槽7]  [下一条 ›]
                        [⌄ 展开]
```

- 槽位数量恒为 `2 * visibleSideCount + 1`，窗口**贴边铺满真实项**，不做空槽占位：首尾处选中项会随窗口移动到条带两端。
- 数组项数少于槽位数时返回全部下标，条带整体居中，宽度不随数据量跳动。
- 选中块：高 `3.25rem`、最小宽 `8.75rem`、字号 `1.125rem`、字重 600，`text-primary` + `border-primary/45` + `bg-primary/8`。
- 非选中块：高 `2.5rem`、最小宽 `6.5rem`、字号 `0.875rem`、字重 500，`text-muted-foreground` + `border-border` + `bg-background`，hover 转 `bg-muted` / `text-foreground`。
- 状态横条：每块底部居中绝对定位，`1.25rem × 0.25rem`、圆角 2px（沿用 `QsStatusSwitchToolbar` 选中指示条写法）；颜色取自 tone —— `danger` = `bg-destructive`、`success` = `bg-emerald-500 dark:bg-emerald-400`、`warning` = `bg-amber-500 dark:bg-amber-400`、`neutral` = `bg-muted-foreground`。
- 方向键 `←` / `→` 等价于上一条 / 下一条；焦点落在槽位上时跟随选中项，焦点在方向或形态按钮上时保持不变。
- 窄容器：条带视口 `overflow-x: auto` + 隐藏滚动条；选中变化、挂载、形态切换后把选中槽滚到视口正中（实测 390px 容器内选中槽中点与视口中点重合）。
- `prefers-reduced-motion: reduce` 时关闭过渡。

### 3.2 展开形态

- 全部选项 `flex-wrap` **左对齐**换行（gap `0.5rem`），块尺寸与非选中块一致。
- 选中项：同款绿色文字 / 边框 / 浅绿底 + 字重 600，**不放大**。
- 左右切换按钮消失；底部居中改为「⌃ 收起」。
- 形态切换不改变选中值（同一份模型值，实测往返保持）。

### 3.3 边界情况处理

| 情况 | 处理 |
| --- | --- |
| 空数组 | 条带区显示「暂无可切换的明细行」；上一条 / 下一条 / 展开全部 `disabled`；模型值应为 `null` |
| 仅 1 项 | 两个方向按钮都禁用；展开后仅 1 块 |
| 少于槽位数 | 只显示实际存在的项，容器宽度稳定 |
| 选中首项 / 末项 | 对应方向按钮 `disabled` + `opacity-45`，**不循环**（对账是顺序核对，循环会误导为「还有未核对项」） |
| 选中值不在 items 中（含 `null` 但 items 非空） | 条带平铺前 N 项、无放大项、方向按钮禁用；点击任一块即完成选中 |
| items 变化导致原选中项消失 | 组件不擅自改值，按上一条口径渲染；由页面负责校正模型值 |

## 4. 纯逻辑与测试

`logic.ts` 导出可单测的纯函数：

```ts
export const LINE_SWITCHER_DEFAULT_SIDE_COUNT = 3
export const LINE_SWITCHER_TONE_BAR_CLASSES: Readonly<Record<QsReconciliationLineSwitcherTone, string>>
/** 贴边铺满的下标窗口；项数不足时返回全部下标。 */
export function buildLineSwitcherWindow(itemCount: number, selectedIndex: number, sideCount: number): readonly number[]
/** 归一化每侧项数：非有限值或负数回落默认值，小数向下取整，0 合法。 */
export function resolveLineSwitcherSideCount(value: number | undefined): number
/** 到首尾返回 null（按钮据此禁用），不循环。 */
export function resolveLineSwitcherStep(selectedIndex: number, itemCount: number, delta: -1 | 1): number | null
/** 未登记的状态回落 neutral。 */
export function resolveLineSwitcherTone(status: string, tones: Readonly<Record<string, QsReconciliationLineSwitcherTone>>): QsReconciliationLineSwitcherTone
```

测试：`web/apps/qsmds-arco/test/views/qs-reconciliation-line-switcher.test.ts`（7 个用例，含三语键对齐）；路由契约在 `test/api/component-library-routes.test.ts`。

## 5. 组件库展示

- 路由：`router/modules/component.library.ts` 的 `componentLibraryBusiness` 下 `reconciliation-line-switcher` → `views/component_library/business/reconciliation-line-switcher.vue`，图标 `qs-bill-reconciliation-check`。
- 展示页：`ComponentCatalogPage` 壳 + `ReconciliationLineSwitcherShowcase.vue`，fixture 在 `views/component_library/business/fixtures/reconciliation-line-switcher.fixture.ts`。
- 场景：默认 12 条、首项 / 末项边界按钮、恰好 7 条、3 条、1 条、0 条、每侧 1 项、状态码取值 + 未登记状态回落、390px 窄容器；深浅色由整页主题覆盖。
- 图标清单已按 `node scripts/generate-icon-inventory.mjs` 重生成。

## 6. 已确认决议（2026-10-09）

1. 命名 `QsReconciliationLineSwitcher`。
2. 状态色走 `statusTones` 映射，item 形状保持 `{ value, label, status }`。
3. 条带**永远显示满槽位**（贴边铺满、不补空槽位），首尾处选中项移动到两端。
4. 上一条 / 下一条到边界**禁用**，不循环。
5. 展开形态**左对齐**换行。
6. 底部按钮**图标 + 文字**。
7. 每侧可见项数**可配**（`visibleSideCount`，默认 3）；深色下选中项绿色**沿用主题** `--primary`。
