<script setup lang="ts">
import { descriptions as descriptionsExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.component.descriptions')" description="FaDescriptions" />
    <FaCodePreview
      v-for="example in descriptionsExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
