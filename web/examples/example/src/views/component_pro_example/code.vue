<script setup lang="ts">
import { code as codeExamples, codePreview as codePreviewExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()

const examples = [
  ...codeExamples,
  ...codePreviewExamples.map(example => ({
    ...example,
    title: `CodePreview - ${example.title}`,
  })),
]
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.code')" description="FaCode / FaCodePreview" />
    <FaCodePreview
      v-for="example in examples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
