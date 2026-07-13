<script setup lang="ts">
const { t } = useI18n()

const route = useRoute()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.menuQuery')" />
    <FaPageMain>
      {{ route.query }}
    </FaPageMain>
  </div>
</template>
