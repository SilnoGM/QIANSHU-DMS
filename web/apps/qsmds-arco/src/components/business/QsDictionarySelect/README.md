# QsDictionarySelect

`QsDictionarySelect` 是正式应用内的业务中立字典单选组件。它通过既有
Dictionary Catalog Consumer 读取平铺字典，组合安全的加载、历史值、搜索、
表单与无障碍语义；组件不直接调用 API，也不读取 Store 或权限。

## 显式导入

该组件位于应用级 `components/business`，不会新增 barrel 或扩大深层自动扫描。
调用方应显式导入：

```ts
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
```

```vue
<QsDictionarySelect
  v-model="workflowStatus"
  dictionary-code="workflow.status"
  id="workflow-status"
  name="workflowStatus"
  aria-label="流程状态"
/>
```

## 公共 API

### Props

| Prop | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `dictionaryCode` | `string` | 必填 | 响应式字典编码；按既有规范归一化 |
| `modelValue` | `string \| null` | `null` | 稳定字典 value；`null` 表示未选择 |
| `placeholder` | `string` | `请选择` | 搜索 input 的占位文案 |
| `clearable` | `boolean` | `false` | 仅在可信可交互状态允许显式清空 |
| `disabled` | `boolean` | `false` | 同时禁用真实 input、按钮、重试和表单代理 |

### Emits 与 Expose

- `update:modelValue(value: string | null)`：选择时提交原始字符串，显式清空时提交
  `null`。加载、重试、code 切换和外部 model 更新不会伪造事件。
- `focus(event: FocusEvent)`、`blur(event: FocusEvent)`：只转发真实 combobox input
  的原始事件。
- `focus()`、`blur()`：供表单滚动和调用方编程控制。caller disabled 时 `focus()`
  安全 no-op；内部 unavailable 时焦点落到可见状态或 retry。

本期固定为单选和本地搜索，不提供 `multiple`、`provider`、`options`、slots、
远程搜索或领域映射参数。

## 状态与搜索

- `loading` 显示“正在加载字典选项”，禁止选择和清空。
- `ready` 只允许选择 `effectiveEnabled=true` 的条目。
- `empty` 仅在可信 Catalog 没有有效候选时显示“暂无可用选项”。
- 非空 Catalog 的搜索结果为空时，Popover 显示“无匹配选项”。搜索同时匹配
  Label 和 value，忽略边缘空白及大小写，不发起远程请求。
- `missing` 显示“未配置该字典类型”；`invalid` 显示“字典编码配置无效”。
- `error` 只展示安全错误文案和“重试加载”；其他状态不提供重试。

交互 session 使用规范化后的 `dictionaryCode`。切换到不同 code 或 invalid 会关闭
旧 Popover、清空旧搜索；仅改变大小写或边缘空白不会重建交互。加载或失效期间先以
raw 安全回显，Catalog 重新可信后会重建内部 Combobox，把同一 value 刷新成当前
Label；这些阶段切换始终保留外部 `modelValue`，也不会主动 emit。

## 历史值

有效项保持 Server 顺序。可信 Catalog 中的停用值或未知值会以 disabled option
追加到末尾并保留精确 raw value；加载、缺失或错误期间只显示 raw，不提前宣称
“已停用”或“未知”。空字符串是可回显、可提交的历史 raw，只有 `null` 表示未选择。

## 表单与 Attr 路由

- `class`、`style` 和所有安全 `data-*` 只落到稳定 root。组件不会覆盖
  `FaFormControl` 注入的 `data-slot="form-control"`。
- `id`、`tabindex` 与白名单表单 ARIA 只进入真实 combobox input；底层 Reka
  继续拥有 `aria-expanded`、`aria-controls`、`aria-autocomplete` 和当前候选语义。
- `aria-describedby` 会合并调用方说明与当前状态说明；loading 的
  `aria-busy="true"`、内部错误和本地 required 错误优先于调用方冲突值，状态恢复后
  自动还原调用方或 `FaForm` 注入值。
- 带 `name` 且 `modelValue !== null` 时，隐藏提交代理向 `FormData` 写入精确 raw；
  搜索文本和展示 Label 永不提交。caller disabled 时禁用字段不提交。
- `required` 或 `aria-required="true"` 会创建无 name 的视觉隐藏验证代理。它只把
  `null` 判为空；空字符串使用内部 `present` sentinel，因此不会与未选择混淆。
  原生 `invalid` 会阻止焦点停在隐藏节点，转回真实 input、状态或 retry。

## 响应式、主题与 Popover 边界

组件只使用现有语义 token，继承 light/dark 主题。Desktop control 高度为 `36px`；
小于等于 `640px` 时，真实搜索 input、clear、trigger、retry 与 Popover option 的
触控目标至少为 `44px`。长 Label/value 可以在 viewport 内换行，加载图标和
Popover 动效在 Reduced Motion 下停止持续动画。

`FaCombobox` 的 Popover 由 Teleport 拥有；组件通过公共 `contentClass` 传入唯一的
`qs-dictionary-select__content` ownership 类，只在该类下约束 option 尺寸、换行与
动效，不使用会影响其他 Combobox 的裸全局选择器。

## 安全边界

字典下拉只是可选值与历史值的 UI，不是授权或数据完整性边界。调用页面负责字段级
业务校验、保存和领域映射；Server 必须继续使用自己的字典有效性校验确认新增或变更
值，不能因为前端候选可见便信任提交。组件不得记录 Token、Cookie、账号、连接串或
完整错误响应。
