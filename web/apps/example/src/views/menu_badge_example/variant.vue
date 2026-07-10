<i18n lang="yaml">
zh-cn:
  description: 基于 Pinia 实现动态设置
zh-tw:
  description: 基于 Pinia 實現動態設置
en:
  description: Dynamic setting based on Pinia
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const menuBadgeStore = useMenuBadgeStore()

function change(val: 'default' | 'secondary' | 'destructive') {
  menuBadgeStore.setVariant(val)
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.menuBadge.variant')" :description="t('description')" />
    <FaPageMain>
      <FaButtonGroup>
        <FaButton :variant="menuBadgeStore.variant === 'default' ? 'default' : 'outline'" @click="change('default')">
          default
        </FaButton>
        <FaButton :variant="menuBadgeStore.variant === 'secondary' ? 'default' : 'outline'" @click="change('secondary')">
          secondary
        </FaButton>
        <FaButton :variant="menuBadgeStore.variant === 'destructive' ? 'default' : 'outline'" @click="change('destructive')">
          destructive
        </FaButton>
      </FaButtonGroup>
    </FaPageMain>
  </div>
</template>
