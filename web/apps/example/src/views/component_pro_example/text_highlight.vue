<script setup lang="ts">
import { textHighlight as textHighlightExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.textHighlight')" description="FaTextHightlight" />
    <FaCodePreview
      v-for="example in textHighlightExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
