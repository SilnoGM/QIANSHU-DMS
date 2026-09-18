# QsStatusSwitchToolbar

状态切换工具栏用于页面头与数据表格之间的单选状态筛选，视觉规格来源于 Figma 中的 `QsStatusSwitchToolbar` / `QsStatusSwitchItem` 组件。

## 组件契约

- 使用 `v-model` 传入当前状态值，组件不会擅自选择默认状态。
- 使用 `items` 传入状态项；每项包含稳定 `value`、显示 `label`，以及可选 `count`、`disabled`。
- 标签最小宽度为 140px，长名称按内容自动加宽且不压缩，避免文字与相邻标签重叠。
- 状态过多时横向滚动，并在右侧仍有隐藏内容时展示“浏览更多状态”按钮。
- 组件不读取 API、Store 或 Router；筛选请求和路由同步由页面负责。
- 每个状态均使用原生 `button`，支持键盘焦点、`disabled` 与 `aria-pressed`。
- 用户启用减少动态效果时，取消平滑滚动和颜色过渡。

## 示例

```vue
<QsStatusSwitchToolbar
  v-model="activeStatus"
  :items="[
    { value: 'ALL', label: '全部订单', count: 128 },
    { value: 'CONFIRMED', label: '已确认', count: 36 },
  ]"
/>
```

## 设计来源

- Figma file key: `H7dwIIhtw216G6nAKJQs5k`
- Component node: `4:129`
