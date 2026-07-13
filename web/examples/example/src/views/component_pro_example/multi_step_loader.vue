<script setup lang="ts">
import { multiStepLoader as multiStepLoaderExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.multiStepLoader')" description="FaMultiStepLoader" />
    <FaCodePreview
      v-for="example in multiStepLoaderExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
