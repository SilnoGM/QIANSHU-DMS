<i18n lang="yaml">
zh-cn:
  info: 你现在可以切换到上个页面，然后打开点另一个按钮，然后注意看标签页
  id: 当前页面ID：
zh-tw:
  info: 現在你可以切換到上個頁面，然後打開點另一個按鈕，然後注意看標籤頁
  id: 當前頁面ID：
en:
  info: Now you can switch to the previous page, then open another button, then pay attention to the tab
  id: 'Current Page ID:'
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const route = useRoute()
</script>

<template>
  <FaPageMain>
    {{ t('info') }}
    <div>
      {{ t('id') }} {{ route.params.id }}
    </div>
  </FaPageMain>
</template>
