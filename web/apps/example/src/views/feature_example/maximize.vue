<i18n lang="yaml">
zh-cn:
  description: 扩大可视范围和操作区域，能更专注于主页面上的操作
  button: '{0}最大化'
  enter: 进入
  exit: 退出
zh-tw:
  description: 扩大視覺範圍和操作區域，能更專注於主頁面上的操作
  button: '{0}最大化'
  enter: 進入
  exit: 退出
en:
  description: Expand the visual range and operation area, allowing for more focused attention on the main page
  button: '{0} Maximize'
  enter: Enter
  exit: Exit
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const appSettingsStore = useAppSettingsStore()

const mainPage = useAppPage()

function toggle() {
  mainPage.maximize(!appSettingsStore.mainPageMaximizeStatus)
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.maximize')" :description="t('description')" />
    <FaPageMain>
      <FaButton @click="toggle">
        {{ t('button', [appSettingsStore.mainPageMaximizeStatus ? t('exit') : t('enter')]) }}
      </FaButton>
    </FaPageMain>
  </div>
</template>
