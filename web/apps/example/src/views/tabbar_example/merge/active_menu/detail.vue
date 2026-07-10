<i18n lang="yaml">
zh-cn:
  info: 注意看标签页
  button: 返回
zh-tw:
  info: 注意看標籤頁
  button: 返回
en:
  info: Pay attention to the tab
  button: Back
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const router = useRouter()
</script>

<template>
  <FaPageMain>
    {{ t('info') }}
    <FaButton @click="router.back()">
      {{ t('button') }}
    </FaButton>
  </FaPageMain>
</template>
