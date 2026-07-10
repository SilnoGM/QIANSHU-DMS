<script setup lang="ts">
import { scratchOff as scratchOffExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.scratchOff')" description="FaScratchOff" />
    <FaCodePreview
      v-for="example in scratchOffExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
