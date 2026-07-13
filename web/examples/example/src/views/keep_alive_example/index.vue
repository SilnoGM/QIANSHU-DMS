<i18n lang="yaml">
zh-cn:
  title: 该页面将始终保持活跃，重新回到该页面时，输入框中的内容将不会被重置
  input: 输入点什么
zh-tw:
  title: 該頁面將始終保持活躍，重新回到該頁面時，輸入框中的內容將不會被重置
  input: 輸入點什麼
en:
  title: This page will always be kept alive, and the content in the input box will not be reset when you return to this page
  input: Input something
</i18n>

<script setup lang="ts">
defineOptions({
  name: 'KeepAliveExample',
})

const { t } = useI18n()

const text = ref('')
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.keepAlive')" />
    <FaPageMain :title="t('title')">
      <FaInput v-model="text" :placeholder="t('input')" />
    </FaPageMain>
  </div>
</template>
