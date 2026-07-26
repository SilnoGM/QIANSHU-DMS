# MoneyInput 金额输入

`MoneyInput` 是应用级基础组件，以 `FaInput` 为输入内核，面向数据库
`DECIMAL/NUMERIC`、API 十进制字符串以及前端精确汇总场景。

## 数据协议

金额公共值固定为 `string | null`，币种通过独立的命名模型保存：

```ts
type MoneyAmount = string | null
type CurrencyCode = 'CNY' | 'TWD' | 'MYR' | 'USD'
```

- `"1234.50"`：合法金额。
- `null`：业务空值。
- `""`、`"1,234.50"`、`"¥12.00"`、`"1e3"`：非法持久化金额。
- 币种通过独立的 `v-model:currency` 命名模型传递，不写入金额值。
- `currency` 默认使用 `CNY`，右侧下拉可切换四个已支持币种。
- API 应使用 JSON string 传递金额，不要先转换为 JavaScript `number`。

推荐数据流：

```text
MoneyInput -> { amount: "1234.50", currency: "CNY" }
           -> AmountDisplay / 同币种 sumMoneyValues
```

## 基础用法

```vue
<script setup lang="ts">
import type { CurrencyCode } from '@/components/base/AmountDisplay/format'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'

const amount = ref<string | null>(null)
const currency = ref<CurrencyCode>('CNY')
</script>

<template>
  <MoneyInput
    v-model="amount"
    v-model:currency="currency"
    :precision="2"
    min="0.00"
  />
  <AmountDisplay :value="amount" :currency="currency" />
</template>
```

## Props

| 属性 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `modelValue` | `string \| null` | `null` | 无分组符、无币种符号的金额字符串 |
| `currency` | `CNY \| TWD \| MYR \| USD` | `CNY` | 通过 `v-model:currency` 双向绑定的独立币种 |
| `precision` | `number` | `2` | 小数位，必须是 `0..100` 的整数 |
| `allowNegative` | `boolean` | `false` | 是否允许负数 |
| `min` | `string` | - | 精确最小值 |
| `max` | `string` | - | 精确最大值 |
| `clearable` | `boolean` | `true` | 是否允许清空为 `null` |
| `disabled` | `boolean` | `false` | 禁用状态 |
| `readonly` | `boolean` | `false` | 只读状态 |
| `placeholder` | `string` | 根据精度生成 | 输入占位文本 |

原生 `name`、`aria-*`、`autocomplete`、`input` 和 `change` 等属性或事件会继续
转交给 `FaInput` 内的真实 `<input>`，不会重复落到输入组外层，可以直接作为
`FaFormItem` 的第一个控件使用。

切换币种只更新 `currency`，不会换算或改写金额字符串。调用方应把二者分别提交：

```ts
{
  amount: '1234.50',
  currency: 'USD',
}
```

`disabled` 或 `readonly` 时币种下拉同步锁定。不同币种不能直接汇总；业务必须先
统一币种或使用明确汇率完成换算，再调用 `sumMoneyValues`。

## 校验

`validateMoneyString` 先执行严格语法校验，再使用 `decimal.js` 做精确比较和
固定精度规范化。错误码包括：

- `INVALID_FORMAT`
- `PRECISION_EXCEEDED`
- `NEGATIVE_NOT_ALLOWED`
- `BELOW_MIN`
- `ABOVE_MAX`

组件在失焦后设置 `aria-invalid` 和 `data-validation-code`，同时发出
`validation` 事件。提交逻辑也可以直接复用纯函数：

```ts
import { validateMoneyString } from '@/components/base/MoneyInput/logic'

const result = validateMoneyString(amount.value, {
  precision: 2,
  min: '0.00',
})
```

`readonly` 状态只执行校验并发出 `blur`，不会在失焦时补零或写回 `v-model`。

## 精确汇总

列汇总使用 `sumMoneyValues`，返回固定精度字符串：

```ts
import { sumMoneyValues } from '@/components/base/MoneyInput/logic'

const total = sumMoneyValues(
  ['0.10', '0.20', '9007199254740993.21'],
  { precision: 2 },
)
// "9007199254740993.51"
```

`null` 不参与计算；非法金额会抛出带稳定错误码的 `MoneyValidationError`，不会
静默按零处理。汇总内部按当前批次的金额位数、精度和行数创建隔离的 Decimal
计算精度，不依赖默认 20 位有效数字。需要把精确金额放进 `QsGenericTable` 时，
可通过既有 `summaryValues` 传入该字符串，再交给 `AmountDisplay` 渲染。

当前 `AmountDisplay` 的货币展示契约固定为两位小数，因此二者直接配对时应保留
`MoneyInput` 默认的 `precision=2`。非两位金额仍可录入和计算，但展示层需要使用
与该业务精度一致的组件，不能假定 `AmountDisplay` 会保留额外小数位。
