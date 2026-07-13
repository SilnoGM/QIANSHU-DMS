<script setup lang="ts">
import { spotlightCard as spotlightCardExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.spotlightCard')" description="FaSpotlightCard" />
    <FaCodePreview
      v-for="example in spotlightCardExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
