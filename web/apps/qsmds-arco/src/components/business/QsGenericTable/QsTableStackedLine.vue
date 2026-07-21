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

// medium 与 semibold 需要覆盖直接子组件的默认字重，normal 则保留子组件自己的
// 字体约定，避免普通行意外削弱标签或其他领域组件的层级。
const weightClass = computed(() => ({
  medium: 'font-medium [&>*]:!font-medium',
  normal: 'font-normal',
  semibold: 'font-semibold [&>*]:!font-semibold',
})[props.weight])
</script>

<template>
  <div
    data-slot="qs-table-stacked-line"
    class="leading-5 flex gap-2 min-w-0 items-baseline"
    :class="nowrap && 'whitespace-nowrap'"
  >
    <span
      v-if="label"
      data-slot="qs-table-stacked-line-label"
      class="text-muted-foreground font-normal shrink-0"
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
      class="inline-flex shrink-0 items-center self-center"
      :class="suffixClass"
    >
      <slot name="suffix" />
    </span>
  </div>
</template>
