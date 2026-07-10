<i18n lang="yaml">
zh-cn:
  set: 标题设置为「 {0} 」
  reset: 标题重置
  setTitle: 测试标题
zh-tw:
  set: 標題設置為「 {0} 」
  reset: 標題重置
  setTitle: 測試標題
en:
  set: Set title to「 {0} 」
  reset: Reset title
  setTitle: Test title
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const mainPage = useAppPage()

function set() {
  mainPage.setCustomTitle(t('setTitle'))
}

function reset() {
  mainPage.resetCustomTitle()
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.title')" />
    <FaPageMain main-class="space-x-2">
      <FaButton @click="set">
        {{ t('set', [t('setTitle')]) }}
      </FaButton>
      <FaButton @click="reset">
        {{ t('reset') }}
      </FaButton>
    </FaPageMain>
  </div>
</template>
