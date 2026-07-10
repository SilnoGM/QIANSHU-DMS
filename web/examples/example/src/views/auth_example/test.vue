<i18n lang="yaml">
zh-cn:
  txt: 你能看到这个页面，说明你有访问权限。
zh-tw:
  txt: 你能看到這個頁面，說明你有訪問權限。
en:
  txt: You can see this page, which means you have access permission.
</i18n>

<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <FaPageMain>
    {{ t('txt') }}
  </FaPageMain>
</template>
