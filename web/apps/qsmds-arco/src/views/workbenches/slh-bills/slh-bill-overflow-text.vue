<script setup lang="ts">
import type { HTMLAttributes } from 'vue'

defineOptions({ name: 'SlhBillOverflowText' })
withDefaults(defineProps<{
  text: string
  /** 文字角色：单号用默认的数据角色（等宽），地址这类正文传 `qs-type-body` 等。 */
  contentClass?: HTMLAttributes['class']
}>(), {
  contentClass: 'qs-type-data',
})
</script>

<template>
  <!-- 入仓单号常是多段单号拼接、地址可能很长：列内截断并把完整内容放进浮层。 -->
  <FaTooltip :text="text">
    <span class="block truncate" :class="contentClass">{{ text }}</span>
  </FaTooltip>
</template>
