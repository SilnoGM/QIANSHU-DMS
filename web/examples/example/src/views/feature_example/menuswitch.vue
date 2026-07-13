<i18n lang="yaml">
zh-cn:
  description: 可切换并激活指定的导航
  tips: 该特性只有在导航模式为 side 和 head 时生效。
zh-tw:
  description: 可切換並激活指定的導航
  tips: 该特性只有在导航模式为 side 和 head 时生效。
en:
  description: Switch and activate the specified menu
  tips: This feature only takes effect when the menu mode is 'side' or 'head'.
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const appSettingsStore = useAppSettingsStore()
const appMenuStore = useAppMenuStore()

const appMenu = useAppMenu()

function switchToPrev() {
  appMenu.switchTo(appMenuStore.actived - 1 >= 0 ? appMenuStore.actived - 1 : appMenuStore.allMenus.length - 1)
}

function switchToNext() {
  appMenu.switchTo(appMenuStore.actived + 1 < appMenuStore.allMenus.length ? appMenuStore.actived + 1 : 0)
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.feature.menuswitch')" :description="t('description')" />
    <FaPageMain main-class="space-y-2">
      <p v-show="!['side', 'head'].includes(appSettingsStore.settings.menu.mode)">
        {{ t('tips') }}
      </p>
      <FaButtonGroup>
        <FaButton variant="outline" :disabled="!['side', 'head'].includes(appSettingsStore.settings.menu.mode)" @click="switchToPrev">
          <FaIcon name="i-mdi:arrow-left" />
        </FaButton>
        <FaButton variant="outline" :disabled="!['side', 'head'].includes(appSettingsStore.settings.menu.mode)" @click="switchToNext">
          <FaIcon name="i-mdi:arrow-right" />
        </FaButton>
      </FaButtonGroup>
    </FaPageMain>
  </div>
</template>
