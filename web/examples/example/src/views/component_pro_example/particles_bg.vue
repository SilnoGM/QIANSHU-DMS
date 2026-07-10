<script setup lang="ts">
import { particlesBg as particlesBgExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.particlesBg')" description="FaParticlesBg" />
    <FaCodePreview
      v-for="example in particlesBgExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
