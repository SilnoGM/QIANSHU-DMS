<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IconLibraryShowcase from './components/IconLibraryShowcase.vue'

defineOptions({ name: 'ComponentLibraryIcons' })

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('iconLibrary.title')" :description="t('iconLibrary.description')" />
    <FaPageMain>
      <IconLibraryShowcase />
    </FaPageMain>
  </div>
</template>
