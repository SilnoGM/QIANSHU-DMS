<i18n lang="yaml">
zh-cn:
  description: 注意看子级导航的图标切换
zh-tw:
  description: 注意看子級導航的圖標切換
en:
  description: Notice the icon switch of the child navigation
</i18n>

<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <FaPageHeader :title="t('route.menuIcon.child')" :description="t('description')" />
</template>
