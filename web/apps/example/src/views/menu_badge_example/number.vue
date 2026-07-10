<i18n lang="yaml">
zh-cn:
  description: 基于 Pinia 实现动态设置
  intro: 控制数字展示长度，避免导航标记覆盖导航标题，为 0 时则隐藏
zh-tw:
  description: 基于 Pinia 實現動態設置
  intro: 控制數字展示長度，避免導航標記覆蓋導航標題，為 0 時則隱藏
en:
  description: Dynamic setting based on Pinia
  intro: Control the number of digits displayed to avoid navigation marks covering navigation titles, and hide when it is 0
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const menuBadgeStore = useMenuBadgeStore()

function plus() {
  menuBadgeStore.setNumber(menuBadgeStore.number + 1)
}

function minus() {
  menuBadgeStore.setNumber(menuBadgeStore.number - 1)
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.menuBadge.number')" :description="t('description')" />
    <FaPageMain :title="t('intro')">
      <FaButtonGroup>
        <FaButton variant="outline" :disabled="menuBadgeStore.number >= 10" @click="plus">
          <FaIcon name="i-ep:plus" />
        </FaButton>
        <FaButton variant="outline" :disabled="menuBadgeStore.number <= 0" @click="minus">
          <FaIcon name="i-ep:minus" />
        </FaButton>
      </FaButtonGroup>
    </FaPageMain>
  </div>
</template>
