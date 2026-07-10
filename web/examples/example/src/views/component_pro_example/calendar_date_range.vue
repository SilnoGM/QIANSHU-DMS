<script setup lang="ts">
import { calendarDateRange as calendarDateRangeExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.calendarDateRange')" description="FaCalendarDateRange" />
    <FaCodePreview
      v-for="example in calendarDateRangeExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
