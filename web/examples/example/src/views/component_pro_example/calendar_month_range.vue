<script setup lang="ts">
import { calendarMonthRange as calendarMonthRangeExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.calendarMonthRange')" description="FaCalendarMonthRange" />
    <FaCodePreview
      v-for="example in calendarMonthRangeExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
