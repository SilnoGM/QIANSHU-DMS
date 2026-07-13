<script setup lang="ts">
import { drawer } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.component.drawer')" description="FaDrawer" />
    <FaCodePreview
      v-for="example in drawer"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
