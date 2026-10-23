<script setup lang="ts">
import Sortable from 'sortablejs'

defineOptions({
  name: 'ToolbarFavoritesPanel',
})

const emits = defineEmits<{
  onChoose: []
}>()

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const appFavoritesStore = useAppFavoritesStore()

const { generateI18nTitle } = useAppMenu()

const favoritesContainerRef = useTemplateRef('favoritesContainerRef')

watch(() => favoritesContainerRef.value, (val) => {
  if (!val) {
    return
  }
  const sortable = new Sortable(val, {
    animation: 200,
    ghostClass: 'op-0',
    draggable: '.draggable-item',
    onUpdate: (e) => {
      if (e.newIndex !== undefined && e.oldIndex !== undefined) {
        appFavoritesStore.sort(e.newIndex, e.oldIndex)
      }
    },
  })
  // 面板每次打开都会重新挂载；不销毁会让 document 级拖拽监听随打开次数累积。
  onWatcherCleanup(() => sortable.destroy())
})

function handleChoose(fullPath: string) {
  router.push(fullPath)
  emits('onChoose')
}
</script>

<template>
  <div class="favorites-container w-80">
    <div class="px-4 py-3 flex items-center justify-between">
      <div class="text-sm font-bold">
        {{ t('app.layouts.topbar.toolbar.favorites.title') }}
      </div>
      <template v-if="appFavoritesStore.canAdd(route.fullPath)">
        <FaIcon v-if="!appFavoritesStore.isAdd(route.fullPath)" class="text-xl cursor-pointer" name="i-mdi:star-plus-outline" :title="t('app.layouts.topbar.toolbar.favorites.add')" @click="appFavoritesStore.add(route)" />
        <FaIcon v-else class="text-xl cursor-pointer" name="i-mdi:star-remove" :title="t('app.layouts.topbar.toolbar.favorites.remove')" @click="appFavoritesStore.remove(route.fullPath)" />
      </template>
    </div>
    <FaScrollArea class="max-h-220px">
      <div v-if="appFavoritesStore.list.length > 0" ref="favoritesContainerRef" class="px-4 pb-4 flex flex-wrap gap-2 items-center justify-between">
        <div v-for="item in appFavoritesStore.list" :key="item.fullPath" :title="generateI18nTitle(item.title)" class="group draggable-item px-2 py-2 rounded-lg flex gap-1 w-[calc(50%-0.25rem)] cursor-pointer ring-1 ring-border ring-inset items-center relative hover-bg-accent" @click="handleChoose(item.fullPath)">
          <FaIcon v-if="item.icon" :name="item.icon" class="size-4" />
          <div class="text-sm pe-4 flex-1 truncate group-hover:[mask-image:linear-gradient(90deg,#000_calc(100%-80px),transparent)]">
            {{ generateI18nTitle(item.title) }}
          </div>
          <div class="text-secondary-foreground rounded-full h-5 w-5 hidden right-2 absolute hover:(bg-secondary ring-1) group-hover:flex-center">
            <FaIcon name="i-ep:delete" class="size-3" @click.stop="appFavoritesStore.remove(item.fullPath)" />
          </div>
        </div>
      </div>
      <div v-else class="text-secondary-foreground py-6 flex-col-center">
        <FaIcon name="i-tabler:mood-empty" class="size-10" />
        <p class="text-base m-2">
          {{ t('app.layouts.topbar.toolbar.favorites.empty') }}
        </p>
        <i18n-t v-show="appFavoritesStore.canAdd(route.fullPath)" keypath="app.layouts.topbar.toolbar.favorites.addToFavorites" tag="p" class="text-sm m-0 op-75 flex-center">
          <FaIcon name="i-mdi:star-plus-outline" class="text-secondary-foreground mx-1 size-5" />
        </i18n-t>
      </div>
    </FaScrollArea>
  </div>
</template>
