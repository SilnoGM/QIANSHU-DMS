<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { useResizeObserver } from '@vueuse/core'

defineOptions({ name: 'SlhReconciliationOverflowText' })

const props = withDefaults(defineProps<{
  text: string
  /** 文字角色：默认数据角色（等宽），正文类字段可传 `qs-type-body` 等。 */
  contentClass?: HTMLAttributes['class']
}>(), {
  contentClass: 'qs-type-data',
})

const content = ref<HTMLElement | null>(null)
const truncated = ref(false)

/** 按需提示：只有真的被截断才给浮层，否则 hover 会重复弹出眼睛已经看到的同一段文字。 */
function measure() {
  const node = content.value
  truncated.value = node !== null && node.scrollWidth > node.clientWidth
}

// 文本换了要重算；列宽由外层网格决定，窄屏折叠时也要跟着重算。
watch(() => props.text, measure)
useResizeObserver(content, measure)
onMounted(measure)
</script>

<template>
  <FaTooltip :text="text" :disabled="!truncated">
    <span ref="content" class="block truncate" :class="contentClass">{{ text }}</span>
  </FaTooltip>
</template>
