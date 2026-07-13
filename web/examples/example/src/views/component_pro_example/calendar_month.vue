<script setup lang="ts">
import { calendarMonth as calendarMonthExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.calendarMonth')" description="FaCalendarMonth" />
    <FaCodePreview
      v-for="example in calendarMonthExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
