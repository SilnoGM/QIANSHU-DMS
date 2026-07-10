<script setup lang="ts">
import { gradientButton as gradientButtonExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.gradientButton')" description="FaGradientButton" />
    <FaCodePreview
      v-for="example in gradientButtonExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
