<script setup lang="ts">
import { interactiveButton as interactiveButtonExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.interactiveButton')" description="FaInteractiveButton" />
    <FaCodePreview
      v-for="example in interactiveButtonExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
