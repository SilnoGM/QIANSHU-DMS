<script setup lang="ts">
import ComponentCatalogPage from '../shared/ComponentCatalogPage.vue'
import DateTimeFieldShowcase from './components/DateTimeFieldShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsDateTimeField' })

const principles = [
  {
    title: '值即接口契约',
    description: '日期输出 YYYY-MM-DD，时间输出规范化 UTC ISO；页面不再自行拼接或转换格式。',
    icon: 'i-lucide:braces',
  },
  {
    title: '固定业务时区',
    description: '选择与展示统一按 Asia/Shanghai 墙钟，浏览器本地时区不参与换算。',
    icon: 'i-lucide:globe-2',
  },
  {
    title: '边界双层校验',
    description: '日历禁用未来日期，时分秒在提交前再校验；服务端校验仍是最终边界。',
    icon: 'i-lucide:shield-check',
  },
] as const
</script>

<template>
  <ComponentCatalogPage
    title="日期时间字段"
    description="独立验收 QsDateTimeField 的日期、分钟、秒精度，以及空值、清除、未来时间与最早时间边界。"
    section-label="QsDateTimeField"
    headline="统一业务日期时间输入"
    summary="日期部分复用项目日历，时间部分使用可滚动的时间列弹层；组件负责业务时区、精度、边界和清除交互，页面只维护一个可直接提交的值。"
    route-path="/component-library/business/date-time-field"
    icon="i-lucide:calendar-clock"
    :principles="principles"
    stage-label="日期时间字段已展示"
    empty-description="日期时间字段示例尚未接入。"
  >
    <DateTimeFieldShowcase />
  </ComponentCatalogPage>
</template>
