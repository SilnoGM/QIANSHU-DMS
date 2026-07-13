<script setup lang="ts">
import { calendarYearRange as calendarYearRangeExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.calendarYearRange')" description="FaCalendarYearRange" />
    <FaCodePreview
      v-for="example in calendarYearRangeExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
