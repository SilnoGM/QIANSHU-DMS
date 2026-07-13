<script setup lang="ts">
import { patternBg as patternBgExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.patternBg')" description="FaPatternBg" />
    <FaCodePreview
      v-for="example in patternBgExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
