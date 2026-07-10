<script setup lang="ts">
import { animatedCountTo } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.animatedCountTo')" description="FaAnimatedCountTo / FaAnimatedCountToGroup" />
    <FaCodePreview
      v-for="example in animatedCountTo"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
