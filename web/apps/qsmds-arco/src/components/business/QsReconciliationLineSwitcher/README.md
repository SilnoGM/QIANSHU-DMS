# QsReconciliationLineSwitcher

对账明细行切换器：折叠条带聚焦当前行（选中项放大），展开形态纵览全部行。用于按顺序逐条核对明细行的页面。

## 组件契约

- 受控：`v-model` 传入当前选中行的 `value`，组件不选择默认值；空数组时页面应传 `null`。
- `items` 必填，每项包含稳定 `value`（明细行 id）、展示 `label`（唛头）、状态 `status` 与可选 `statusLabel`。
- `statusTones` 把状态取值映射到语义色（`danger` / `success` / `warning` / `neutral`）；未登记的状态回落 `neutral`，组件内不出现任何状态字面量。
- `visibleSideCount` 控制折叠条带每侧可见项数，槽位数 = `2 * visibleSideCount + 1`，默认 3；非法值回落默认值。
- 折叠与展开是组件内部视图状态，形态切换不改变选中值。
- 上一条 / 下一条到数组首尾禁用，不循环；条带贴边铺满，不补空槽位，因此首尾处选中项会移动到条带两端。
- 每个唛头块底部有状态横条，颜色取自 tone 映射，与账单域「未核对红 / 已核对绿」口径一致。
- 窄容器下条带横向滚动，并把选中项对齐视口正中。
- 组件不读 API、Store、路由，不写业务数据；核对结果、请求与权限由页面负责。
- 每个槽位是原生 `button` 并带 `aria-pressed`，方向按钮与形态按钮带 `aria-label` / `aria-expanded`；方向键 `←` / `→` 等价于上一条 / 下一条，并尊重 `prefers-reduced-motion`。

## 示例

```vue
<QsReconciliationLineSwitcher
  v-model="selectedLineId"
  :items="lines"
  :status-tones="{ 未核对: 'danger', 已核对: 'success' }"
/>
```

## 设计来源

- 交互原型：`specs/reconciliation-line-switcher/prototype.html`
- 设计草案：`specs/reconciliation-line-switcher/design.md`
