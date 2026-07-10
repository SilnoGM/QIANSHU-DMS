<script setup lang="ts">
defineOptions({
  name: 'ToolbarPageReload',
})

const appSettingsStore = useAppSettingsStore()
const { t } = useI18n()
const mainPage = useAppPage()

const isAnimating = ref(false)

function handleClick(event: MouseEvent) {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
    location.reload()
    return
  }
  if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    isAnimating.value = true
    mainPage.reload()
  }
}
</script>

<template>
  <FaTooltip side="bottom">
    <template #content>
      <div class="flex-col-center gap-2">
        <i18n-t keypath="app.layouts.topbar.toolbar.pageReload.tooltip1" tag="p" class="flex-center gap-1">
          <FaKbd>{{ appSettingsStore.os === 'mac' ? '⌘' : 'Ctrl' }}</FaKbd>
        </i18n-t>
        <p>{{ t('app.layouts.topbar.toolbar.pageReload.tooltip2') }}</p>
      </div>
    </template>
    <FaButton variant="ghost" size="icon-sm" @click="handleClick" @animationend="isAnimating = false">
      <FaIcon name="i-iconoir:refresh-double" class="size-4" :class="{ animation: isAnimating }" />
    </FaButton>
  </FaTooltip>
</template>

<style scoped>
.animation {
  animation: animation 1s;
}

@keyframes animation {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}
</style>
