# FaCombobox 组合框

输入搜索 + 下拉选择组件，支持分组、清空、空状态文案、自定义筛选和虚拟化列表。

## 使用场景

- 可搜索的表单下拉选择
- 城市/地区/人员选择
- 数据量较大的远端或本地选项选择
- 需要自定义关键词匹配规则的选择器
- 输入筛选 + 单选确认的配置项

## Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `disabled` | `boolean` | `false` | 是否禁用 |
| `clearable` | `boolean` | `false` | 是否显示清空按钮 |
| `clearAriaLabel` | `string` | `'清空选择'` | 清空图标按钮的可访问名称 |
| `position` | `'inline' \| 'popper'` | `'popper'` | 下拉内容定位方式 |
| `options` | `(Option \| GroupOption)[]` | **必需** | 选项数据 |
| `placeholder` | `string` | - | 输入框占位文本 |
| `emptyText` | `string` | `''` | 空状态文案 |
| `filter` | `(searchValue: string, option: Option) => boolean` | - | 自定义筛选函数 |
| `inputAttrs` | `ComboboxInputAttrs` | - | 只传给真实搜索 input 的 `id`、`tabindex` 与安全表单 ARIA 白名单 |
| `triggerAriaLabel` | `string` | `'展开或收起选项'` | 展开/收起图标按钮的可访问名称 |
| `virtualList` | `boolean` | `false` | 是否启用虚拟化列表 |
| `class` | `HTMLAttributes['class']` | - | 自定义 CSS 类 |

`ComboboxInputAttrs` 是 `index.vue` 内部的结构类型，不是新的包级 named export。它只允许以下属性：

```ts
type ComboboxInputAttrs = Pick<
  InputHTMLAttributes,
  | 'id'
  | 'tabindex'
  | 'aria-label'
  | 'aria-labelledby'
  | 'aria-describedby'
  | 'aria-invalid'
  | 'aria-required'
  | 'aria-errormessage'
  | 'aria-busy'
>
```

组件还会在运行时重新投影这份白名单，避免 JavaScript 调用方绕过类型后注入 `name`、`value`、`onInput` 或组合框内部属性。`aria-expanded`、`aria-controls`、`aria-autocomplete` 和 `aria-activedescendant` 继续由 Reka 管理，不能通过 `inputAttrs` 覆盖。

### Option 接口

```ts
interface Option {
  label: string
  value: AcceptableValue
  disabled?: boolean
}
```

### GroupOption 接口（分组选项）

```ts
interface GroupOption {
  label: string
  options: Option[]
}
```

## Slots

| 名称 | 说明 |
|------|------|
| `empty` | 自定义空状态内容 |

## Events

| 事件名 | 说明 | 回调参数 |
|--------|------|----------|
| `change` | 选中值变化时触发 | `value: AcceptableValue \| undefined` |
| `clear` | 点击清空按钮时触发 | - |
| `focus` | 真实 combobox input 获得焦点时触发 | `event: FocusEvent` |
| `blur` | 真实 combobox input 失去焦点时触发 | `event: FocusEvent` |

## Expose

| 方法 | 说明 |
|------|------|
| `focus()` | 聚焦真实 combobox input |
| `blur()` | 让真实 combobox input 失焦 |

## 注意事项

1. **v-model 绑定**：使用 `v-model` 实现选中值的双向绑定
2. **单选组件**：当前组件仅支持单选，不支持多选
3. **选项数据结构**：`options` 支持普通选项和分组选项两种格式
4. **默认筛选**：未传入 `filter` 时，组件使用不区分大小写的 `label.includes(searchValue)` 匹配
5. **自定义筛选**：`filter` 会同时作用于普通列表和虚拟列表，返回 `true` 时保留该选项，返回 `false` 时隐藏该选项
6. **虚拟化列表**：数据量较大时建议开启 `virtual-list`，减少渲染压力
7. **分组限制**：开启 `virtual-list` 后会按扁平选项渲染，不显示分组标题
8. **清空按钮**：`clearable` 模式下，仅当组件有选中值或输入内容且获得焦点或悬停时显示清空按钮
9. **空状态**：可通过 `emptyText` 设置简单文案，也可以使用 `empty` 插槽自定义内容
10. **z-index**：下拉内容的 z-index 默认为 2000，确保在其他内容上方显示
11. **表单边界**：搜索 input 不承载业务 `name`、提交值或任意输入事件；业务值提交由上层表单组件独立负责
12. **ARIA 所有权**：`inputAttrs` 只补充 Label、说明、校验和 busy 语义，不覆盖 Reka 拥有的展开、候选控制和当前候选语义
13. **按钮名称**：清空按钮使用 `data-slot="combobox-clear"`，清空和展开按钮始终具有可配置的显式可访问名称
14. **选项身份**：primitive value 使用“类型 + 值”作为渲染身份，对象 value 使用组件实例内 `WeakMap` identity；重复 Label 不会复用同一个 Vue key
15. **焦点方法**：`focus()`、`blur()` 与同名事件都只操作或报告真实 input，不使用全局 DOM 查询
