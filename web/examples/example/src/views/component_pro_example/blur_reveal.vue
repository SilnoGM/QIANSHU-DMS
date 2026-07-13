<script setup lang="ts">
import { blurReveal as blurRevealExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.blurReveal')" description="FaBlurReveal" />
    <FaCodePreview
      v-for="example in blurRevealExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
