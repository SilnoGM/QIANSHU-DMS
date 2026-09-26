<script setup lang="ts">
defineOptions({ name: 'SlhBillOverflowText' })
defineProps<{ text: string }>()
</script>

<template>
  <!-- 入仓单号常是多段单号拼接，列内截断并把完整内容放进浮层。 -->
  <FaTooltip :text="text">
    <span class="qs-type-data block truncate">{{ text }}</span>
  </FaTooltip>
</template>
