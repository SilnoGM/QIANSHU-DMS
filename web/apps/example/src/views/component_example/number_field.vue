<script setup lang="ts">
import { numberField } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.component.numberField')" description="FaNumberField" />
    <FaCodePreview
      v-for="example in numberField"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
