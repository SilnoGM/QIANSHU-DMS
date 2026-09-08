<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const title = computed(() => typeof route.meta.title === 'string' ? t(route.meta.title) : '')
</script>

<template>
  <div>
    <FaPageMain>
      <h1 class="qs-type-section-title m-0">
        {{ title }}
      </h1>
      <p class="text-muted-foreground mb-0">
        {{ t('workbench.pending') }}
      </p>
    </FaPageMain>
  </div>
</template>
