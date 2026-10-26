# QsDateTimeField

业务统一日期时间字段。日期部分复用 `FaDate` / `FaCalendarDate` 的日历语义，时间部分使用
`FaInput type="time"`；组件负责日期与时间的组合、业务时区、精度和边界校验，页面只读写
一个 API-ready 字符串。

## 值契约

`v-model` 不是本地墙钟字符串，而是可以直接提交给服务端的值；空字符串表示未选择。

| `precision` | v-model 格式 | 示例 |
|---|---|---|
| `date` | `YYYY-MM-DD` | `2026-10-26` |
| `minute` | UTC ISO，秒与毫秒归零 | `2026-10-26T06:30:00.000Z` |
| `second` | UTC ISO，保留毫秒 | `2026-10-26T06:30:45.123Z` |

组件内部固定使用 `Asia/Shanghai` 墙钟，与 `DateTimeDisplay`、服务端 `businessToday` 的
口径一致。浏览器本地时区不参与换算，因此同一笔数据在不同电脑上不会差 8 小时；无时区
的 ISO 字符串会被拒绝。

## Props

| 属性 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `precision` | `'date' \| 'minute' \| 'second'` | `'date'` | 选择精度；决定 v-model 格式与时间滚轮的列数 |
| `disabled` | `boolean` | `false` | 禁用触发器与面板 |
| `clearable` | `boolean` | `false` | 是否显示框内清除按钮 |
| `disableFuture` | `boolean` | `false` | 禁止未来日期与未来时刻；打开面板时按当前时刻重新计算 |
| `min` | `string` | - | 最早可选值，格式与 v-model 相同；同时约束日期与当天时刻 |
| `max` | `string` | - | 最晚可选值，格式与 v-model 相同；同时约束日期与当天时刻 |
| `placeholder` | `string` | 选择日期 / 选择日期时间 | 空值触发器文案 |
| `ariaLabel` | `string` | 同 placeholder | 触发器与面板的无障碍名称 |
| `triggerClass` | `string` | - | 追加到触发器的 class |

## Events

| 事件 | 说明 |
|---|---|
| `update:modelValue` | 选中或清除后写回 API-ready 值 |
| `change` | 值提交后触发；用于清除页面字段错误 |
| `blur` | 触发器失焦；兼容 `FaFormItem` 自动绑定 |
| `update:open` | 面板打开状态变化 |

## 交互

- `date`：点击日期即提交并关闭，和 `FaDate picker` 一致。
- `minute` / `second`：日期与时间先写入面板草稿，点“完成”才提交；取消、Esc、点击外部
  不会写值。
- 未选择日期前时间按钮禁用；改日期保留当前时间。
- 点击“时间”按钮会从主面板右侧弹出时间滚轮，空间不足时自动翻到左侧；时/分/秒三列
  支持滚轮、点击和键盘（方向键、PageUp/PageDown、Home/End）选择。
- 时间滚轮的“现在”只重置时间；“取消”只关闭滚轮；“确定”提交整个字段并关闭主面板。
- 主面板不设内部滚动，弹层同时使用 `sticky="always"` 与 `prioritize-position`，优先保证完整显示；视口高度小于面板
  完整高度时才会超出视口。
- `disableFuture` 下当天未来时刻会显示内联错误，“完成”不会提交该值；时间滚轮也会
  禁用当前日期下越界的小时/分钟/秒。
- `min` / `max` 的日期部分通过日历禁用，时刻部分在滚轮和提交前校验；服务端校验仍然是
  最终边界。

## 用法

```vue
<script setup lang="ts">
import QsDateTimeField from '@/components/business/QsDateTimeField/index.vue'

const orderDate = ref('')
const receivedAt = ref('')
</script>

<template>
  <FaFormItem name="orderDate" label="出单日期" required :auto-bind="false">
    <QsDateTimeField
      v-model="orderDate"
      precision="date"
      disable-future
      aria-label="出单日期"
    />
  </FaFormItem>

  <FaFormItem name="receivedAt" label="收款时间" required :auto-bind="false">
    <QsDateTimeField
      v-model="receivedAt"
      precision="minute"
      disable-future
      aria-label="收款时间"
    />
  </FaFormItem>
</template>
```

## 实现说明

当前 `packages/components` 的 `FaDate` 快照没有上游新版的 `withTime` 能力，因此本组件在
业务层组合 `FaCalendarDate`（内联日历）与自绘时间滚轮 `time-wheel-panel.vue`，没有修改
共享基座的日期组件。若后续基座升级到带 `withTime` 的版本，只需替换内部实现，`v-model`、
`precision` 与事件契约保持不变。

时间滚轮额外依赖 `FaPopover` 的 `sticky="always"` 与 `prioritize-position`：它们允许弹层整体
移动到视口内，而不是把内容压成内部滚动区。

## 注意

- 不要把本地的 `YYYY-MM-DDTHH:mm` 字符串直接赋给 `minute` / `second` 字段；组件只接受
  带时区的 ISO 值。
- 日期字段仍由页面做业务必填校验，组件只表达空/非空。
- 时间滚轮复用 `logic.ts` 的 `minuteRangeForHour`、`secondRangeForMinute` 和
  `clampTimeToBounds`，不要在页面重复实现越界判断。
