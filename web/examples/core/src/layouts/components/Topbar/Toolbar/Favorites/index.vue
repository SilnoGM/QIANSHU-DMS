<script setup lang="ts">
import Panel from './panel.vue'

defineOptions({
  name: 'ToolbarFavorites',
})

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
      <Panel @on-choose="open = false" />
    </template>
  </FaPopover>
</template>
