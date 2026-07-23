<script setup lang="ts">
import type { HTMLAttributes } from 'vue'

defineOptions({ name: 'QsTableStackedLine' })

const props = withDefaults(defineProps<{
  contentClass?: HTMLAttributes['class']
  label?: string
  labelClass?: HTMLAttributes['class']
  nowrap?: boolean
  suffixClass?: HTMLAttributes['class']
  tone?: StackedLineTone
  weight?: StackedLineWeight
}>(), {
  contentClass: undefined,
  label: undefined,
  labelClass: undefined,
  nowrap: false,
  suffixClass: undefined,
  tone: 'default',
  weight: 'normal',
})

type StackedLineTone = 'danger' | 'default' | 'muted' | 'success' | 'warning'
type StackedLineWeight = 'medium' | 'normal' | 'semibold'

const slots = useSlots()

// 语义色同时覆盖内容插槽中的直接子组件，确保 AmountDisplay 等自带前景色的
// 展示组件仍能服从当前行的状态；suffix 独立渲染，不会误改复制按钮的反馈色。
const toneClass = computed(() => ({
  danger: 'text-destructive [&>*]:!text-destructive',
  default: 'text-foreground',
  muted: 'text-muted-foreground [&>*]:!text-muted-foreground',
  success: 'text-primary [&>*]:!text-primary',
  warning: 'text-warning [&>*]:!text-warning',
})[props.tone])

// medium 与 semibold 仍是复合行的显式覆盖能力；normal 不再生成局部字重，
// 让 data-emphasis 等语义角色可以可靠覆盖根节点继承的正文默认值。
const weightClass = computed(() => ({
  medium: 'font-medium [&>*]:!font-medium',
  normal: undefined,
  semibold: 'font-semibold [&>*]:!font-semibold',
})[props.weight])
</script>

<template>
  <div
    data-slot="qs-table-stacked-line"
    class="qs-type-body flex gap-2 min-w-0 items-baseline"
    :class="nowrap && 'whitespace-nowrap'"
  >
    <span
      v-if="label"
      data-slot="qs-table-stacked-line-label"
      class="qs-type-meta shrink-0"
      :class="labelClass"
    >
      {{ label }}
    </span>
    <span
      data-slot="qs-table-stacked-line-content"
      class="min-w-0"
      :class="[toneClass, weightClass, contentClass]"
    >
      <slot />
    </span>
    <span
      v-if="slots.suffix"
      data-slot="qs-table-stacked-line-suffix"
      class="inline-flex shrink-0 h-5 items-center self-center"
      :class="suffixClass"
    >
      <slot name="suffix" />
    </span>
  </div>
</template>
