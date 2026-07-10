<i18n lang="yaml">
zh-cn:
  content: 注意看面包屑导航的变化
zh-tw:
  content: 注意看麵包屑導航的變化
en:
  content: Pay attention to the changes in breadcrumb navigation
</i18n>

<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageMain>
      {{ t('content') }}
    </FaPageMain>
  </div>
</template>
