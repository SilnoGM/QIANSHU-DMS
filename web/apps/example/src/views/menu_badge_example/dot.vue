<i18n lang="yaml">
zh-cn:
  description: 基于 Pinia 实现动态设置
zh-tw:
  description: 基于 Pinia 實現動態設置
en:
  description: Dynamic setting based on Pinia
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const menuBadgeStore = useMenuBadgeStore()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.menuBadge.dot')" :description="t('description')" />
    <FaPageMain>
      <FaSwitch v-model="menuBadgeStore.dot" />
    </FaPageMain>
  </div>
</template>
