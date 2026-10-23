<script setup lang="ts">
defineOptions({
  name: 'ToolbarFavorites',
})

// 面板内含 sortablejs；只在用户第一次打开收藏时加载。
const Panel = defineAsyncComponent(() => import('./panel.vue'))

const open = ref(false)

const appFavoritesStore = useAppFavoritesStore()

appFavoritesStore.recoveryStorage()
</script>

<template>
  <FaPopover v-model:open="open" class="p-0">
    <FaButton variant="ghost" size="icon-sm">
      <FaIcon name="i-uiw:star-off" class="size-4" />
    </FaButton>
    <template #panel>
      <Panel v-if="open" @on-choose="open = false" />
    </template>
  </FaPopover>
</template>
