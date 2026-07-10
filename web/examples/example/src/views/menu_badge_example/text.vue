<i18n lang="yaml">
zh-cn:
  description: 基于 Pinia 实现动态设置
  intro: 控制文字展示长度，避免导航标记覆盖导航标题
  change: 切换
  clear: 清空
zh-tw:
  description: 基于 Pinia 實現動態設置
  intro: 控制文字展示長度，避免導航標記覆蓋導航標題
  change: 切换
  clear: 清空
en:
  description: Dynamic setting based on Pinia
  intro: Control the length of text display to avoid navigation marks covering navigation titles
  change: Switch
  clear: Clear
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const menuBadgeStore = useMenuBadgeStore()

function change() {
  menuBadgeStore.setText(menuBadgeStore.text === 'HOT' ? 'NEW' : 'HOT')
}
function clear() {
  menuBadgeStore.setText('')
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.menuBadge.text')" :description="t('description')" />
    <FaPageMain :title="t('intro')">
      <FaButtonGroup>
        <FaButton variant="outline" @click="change">
          {{ t('change') }}
        </FaButton>
        <FaButton variant="outline" @click="clear">
          {{ t('clear') }}
        </FaButton>
      </FaButtonGroup>
    </FaPageMain>
  </div>
</template>
