<script setup lang="ts">
import { animatedBeam as animatedBeamExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.animatedBeam')" description="FaAnimatedBeam" />
    <FaCodePreview
      v-for="example in animatedBeamExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
