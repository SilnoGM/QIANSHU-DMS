<script setup lang="ts">
import { useHotkeyBindings } from '@/hotkeys'

defineOptions({
  name: 'ToolbarMenuSearch',
})

// 搜索面板带 pinyin-pro；首次打开前不加载，避免把拼音字典塞进布局首屏。
const Search = defineAsyncComponent(() => import('./search.vue'))

const appSettingsStore = useAppSettingsStore()
const isShow = ref(false)
// 首次打开后保持挂载，关闭动画仍由弹层自身控制；未打开过时连 chunk 都不加载。
const searchMounted = ref(false)
watch(isShow, (value) => {
  if (value) {
    searchMounted.value = true
  }
})

const useMobileStyle = computed(() => {
  return appSettingsStore.mode !== 'pc' || !appSettingsStore.settings.toolbar.menuSearch.hotkeys
})

useHotkeyBindings({
  'menuSearch.open': () => {
    isShow.value = true
  },
})
</script>

<template>
  <FaButton :variant="useMobileStyle ? 'ghost' : 'outline'" :size="useMobileStyle ? 'icon-sm' : undefined" :class="{ 'mx-2 px-3 h-9': !useMobileStyle }" @click="isShow = true">
    <FaIcon name="i-ri:search-line" class="size-4" />
    <template v-if="appSettingsStore.mode === 'pc' && !useMobileStyle">
      <FaKbdGroup v-if="appSettingsStore.settings.toolbar.menuSearch.hotkeys" class="-me-1">
        <FaKbd>{{ appSettingsStore.os === 'mac' ? '⌘' : 'Ctrl' }}</FaKbd>
        <FaKbd>K</FaKbd>
      </FaKbdGroup>
    </template>
  </FaButton>
  <Search v-if="searchMounted" v-model="isShow" />
</template>
