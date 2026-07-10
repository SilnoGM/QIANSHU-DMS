<i18n lang="yaml">
zh-cn:
  txt: 如果你能看到这段文字，说明该页面已经在新窗口中打开了
zh-tw:
  txt: 如果你能看到這段文字，說明該頁面已經在新窗口中打開了
en:
  txt: If you can see this text, it means that the page has already been opened in a new window
</i18n>

<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <FaPageMain>
    {{ t('txt') }}
  </FaPageMain>
</template>
