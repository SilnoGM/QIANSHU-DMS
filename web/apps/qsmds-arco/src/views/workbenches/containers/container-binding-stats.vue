<script setup lang="ts">
import type { ContainerBindingStats } from './binding-stats.logic'

defineProps<{ stats: ContainerBindingStats }>()

const { t } = useI18n()
</script>

<template>
  <span class="inline-flex gap-1.5 whitespace-nowrap items-center">
    <span class="qs-type-data" :class="stats.toneClass">{{ stats.bound }}/{{ stats.total }}</span>
    <!-- 状态用标签承载，避免方括号文案在不同语言/字号下与数字挤在一起；标签文字固定走正文字体栈。 -->
    <FaTag variant="outline" class="font-sans" :class="stats.tagClass">
      {{ t(stats.labelKey) }}
    </FaTag>
  </span>
</template>
