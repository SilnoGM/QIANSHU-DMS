<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import DateTimeDisplayShowcase from './components/DateTimeDisplayShowcase.vue'

defineOptions({ name: 'ComponentLibraryDateTimeDisplay' })

const principles = [
  {
    title: '明确时区来源',
    description: '字符串输入必须携带 Z 或 UTC offset，展示时区通过明确的 IANA 标识传入。',
    icon: 'i-lucide:globe-2',
  },
  {
    title: '保持输入语义',
    description: 'Date、ISO 8601 字符串和 Unix 毫秒都表达同一时刻，不在组件内读取业务状态。',
    icon: 'i-lucide:braces',
  },
  {
    title: '统一异常反馈',
    description: '空值、非法日期和无效时区稳定显示占位符，避免不同运行环境产生歧义。',
    icon: 'i-lucide:shield-check',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="日期显示"
    description="独立验收 DateTimeDisplay 的日期、时间、时区和非法输入边界。"
    section-label="DateTimeDisplay"
    headline="让同一时刻得到确定结果"
    summary="日期组件只负责稳定展示。调用方明确输入时刻、输出格式和 IANA 时区，组件统一使用 24 小时制，并为无效输入提供一致占位反馈。"
    route-path="/component-library/basic/date-time-display"
    icon="i-lucide:clock-3"
    :principles="principles"
    stage-label="日期组件已展示"
    empty-description="日期组件示例尚未接入。"
  >
    <DateTimeDisplayShowcase />
  </ComponentCatalogPage>
</template>
