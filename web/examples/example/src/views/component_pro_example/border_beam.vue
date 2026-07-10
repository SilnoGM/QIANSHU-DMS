<script setup lang="ts">
import { borderBeam as borderBeamExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.borderBeam')" description="FaBorderBeam" />
    <FaCodePreview
      v-for="example in borderBeamExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
