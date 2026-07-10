<i18n lang="yaml">
zh-cn:
  description: 手动刷新当前页面
  intro: 该特性无视页面保活，意味着即便当前页面开启了页面保活，手动刷新也会强制清除当前页面内的组件和数据的状态。
  reload: 刷新
zh-tw:
  description: 手動刷新當前頁面
  intro: 该特性无视页面保活，意味着即便当前页面开启了页面保活，手动刷新也会强制清除当前页面内的组件和数据的状态。
  reload: 刷新
en:
  description: Manually refresh the current page
  intro: This feature ignores page keep-alive, meaning that even if the current page has page keep-alive enabled, manual refresh will force clear the state of the components and data within the current page.
  reload: Refresh
</i18n>

<script setup lang="ts">
defineOptions({
  name: 'FeatureExampleReload',
})

const { t } = useI18n()
const mainPage = useAppPage()

const text = ref('')

function reload() {
  mainPage.reload()
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.reload')" :description="t('description')" />
    <FaPageMain main-class="space-y-2">
      <p>{{ t('intro') }}</p>
      <FaInput v-model="text" />
      <FaButton @click="reload">
        {{ t('reload') }}
      </FaButton>
    </FaPageMain>
  </div>
</template>
