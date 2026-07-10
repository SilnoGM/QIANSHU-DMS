<script setup lang="ts">
import { glowyCard } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.componentPro.glowyCard')" description="FaGlowyCard / FaGlowyCardWrapper" />
    <FaCodePreview
      v-for="example in glowyCard"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
