<script setup lang="ts">
import type { TabbarRecordRaw } from '@fantastic-admin/types'
import { match } from 'pinyin-pro'
import Sortable from 'sortablejs'

defineOptions({
  name: 'TabbarMoreAction',
})

const router = useRouter()

const appSettingsStore = useAppSettingsStore()
const appTabbarStore = useAppTabbarStore()

const tabbar = useAppTabbar()

const { t } = useI18n()
const { generateI18nTitle } = useAppMenu()

const open = ref(false)

const searchInput = ref('')
const searchInputRef = useTemplateRef('searchInputRef')
watch(open, (val) => {
  if (val) {
    nextTick(() => {
      searchInputRef.value?.ref?.focus()
    })
  }
  else {
    searchInput.value = ''
  }
})

const resultList = computed(() => {
  let result = []
  result = appTabbarStore.list.filter((item) => {
    let flag = false
    if (
      generateI18nTitle(item.title).toString().includes(searchInput.value)
      || (match(generateI18nTitle(item.title).toString(), searchInput.value, { continuous: true })?.length ?? 0) > 0
    ) {
      flag = true
    }
    return flag
  })
  return result
})

const activedTabId = computed(() => tabbar.getId())

const dropdownTabContainerRef = useTemplateRef('dropdownTabContainerRef')

const isDragging = ref(false)
let tabSortable: Sortable
watch(() => dropdownTabContainerRef.value, (val) => {
  if (val) {
    tabSortable = new Sortable(val, {
      animation: 200,
      ghostClass: 'opacity-0',
      draggable: '.tab',
      onStart: () => {
        isDragging.value = true
      },
      onEnd: () => {
        isDragging.value = false
      },
      onMove: (e) => {
        return e.dragged.classList.contains('pinned') ? e.related.classList.contains('pinned') : !e.related.classList.contains('pinned')
      },
      onUpdate: (e) => {
        if (e.newIndex !== undefined && e.oldIndex !== undefined) {
          appTabbarStore.sort(e.newIndex, e.oldIndex)
        }
      },
    })
    if (appSettingsStore.mode === 'mobile') {
      tabSortable.option('disabled', true)
    }
  }
  else {
    tabSortable.destroy()
  }
})
watch(searchInput, (val) => {
  nextTick(() => {
    tabSortable.option('disabled', !!val)
  })
})

function iconName(isActive: boolean, icon: TabbarRecordRaw['icon']) {
  let name
  if (icon) {
    if (isActive) {
      name = typeof icon === 'string' ? icon : icon[1]
    }
    else {
      name = typeof icon === 'string' ? icon : icon[0]
    }
  }
  return name
}

function handleClick(fullPath: string) {
  router.push(fullPath)
  open.value = false
}
</script>

<template>
  <FaDropdown
    v-model:open="open" align="end" :items="[
      [
        { label: t('app.layouts.topbar.tabbar.closeOtherSide'), icon: 'i-mdi:close', handle: () => tabbar.closeOtherSide(), disabled: !tabbar.checkCloseOtherSide() },
        { label: t('app.layouts.topbar.tabbar.closeLeftSide'), icon: 'i-mdi:arrow-expand-left', handle: () => tabbar.closeLeftSide(), disabled: !tabbar.checkCloseLeftSide() },
        { label: t('app.layouts.topbar.tabbar.closeRightSide'), icon: 'i-mdi:arrow-expand-right', handle: () => tabbar.closeRightSide(), disabled: !tabbar.checkCloseRightSide() },
      ],
    ]" class="p-0 min-w-auto"
  >
    <div class="bg-background flex-center size-[var(--g-tabbar-height)] cursor-pointer transition-background-color hover:bg-accent/80">
      <FaIcon name="i-ri:more-2-fill" class="size-4" />
    </div>
    <template #footer>
      <div class="flex flex-col gap-2 max-h-80 w-40">
        <FaInput ref="searchInputRef" v-model="searchInput" class="w-full">
          <template #start>
            <FaIcon name="i-ri:search-line" class="size-4" />
          </template>
        </FaInput>
        <FaScrollArea :scrollbar="false" mask class="overscroll-contain">
          <div ref="dropdownTabContainerRef" class="tabs space-y-1" :class="{ dragging: isDragging }">
            <div
              v-for="element in resultList" :key="element.tabMerge === 'routeName' && element.routeName ? element.routeName : element.tabId" class="tab px-2 rounded-md h-8 relative" :class="{
                'bg-accent': element.tabId === activedTabId,
                'pinned': element.tabPermanent || element.isPin,
              }"
            >
              <div :key="element.tabId" class="title" :title="element.customTitleList.find(item => item.fullPath === element.fullPath)?.title || generateI18nTitle(element.title)" @click="handleClick(element.fullPath)">
                <FaIcon v-if="appSettingsStore.settings.tabbar.icon && iconName(element.tabId === activedTabId, element.icon)" :name="iconName(element.tabId === activedTabId, element.icon)!" />
                {{ element.customTitleList.find(item => item.fullPath === element.fullPath)?.title || generateI18nTitle(element.title) }}
              </div>
              <div v-if="!element.tabPermanent && element.isPin" class="action-icon" @click.stop="appTabbarStore.unPin(element.tabId)" @dblclick.stop>
                <FaIcon name="i-ri:pushpin-2-fill" />
              </div>
              <div v-else-if="!element.tabPermanent && resultList.length > 1" class="action-icon" @click.stop="tabbar.closeById(element.tabId)" @dblclick.stop>
                <FaIcon name="i-ri:close-fill" />
              </div>
            </div>
          </div>
        </FaScrollArea>
      </div>
    </template>
  </FaDropdown>
</template>

<style scoped>
.tabs {
  &:not(.dragging) {
    .tab:hover {
      &:not(.actived) {
        --uno: bg-accent;
      }

      .action-icon {
        opacity: 1;
      }
    }
  }

  .tab {
    transition: background-color 0.3s;

    &:hover {
      .title {
        --uno: opacity-100;

        margin-inline-end: 20px;
        mask-image: linear-gradient(to right, #000 calc(100% - 44px), transparent);

        [dir="rtl"] & {
          mask-image: linear-gradient(to left, #000 calc(100% - 44px), transparent);
        }
      }
    }

    * {
      user-select: none;
    }

    .title {
      --uno: opacity-70 transition;

      position: relative;
      display: flex;
      gap: 5px;
      align-items: center;
      height: 100%;
      overflow: hidden;
      font-size: 14px;
      white-space: nowrap;
      cursor: pointer;
      mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent);

      [dir="rtl"] & {
        mask-image: linear-gradient(to left, #000 calc(100% - 24px), transparent);
      }

      i {
        flex-shrink: 0;
        font-size: 16px;
      }
    }

    .action-icon {
      --uno: transition absolute inset-e-2 top-1/2 -translate-y-1/2 rounded-full z-10 w-5 h-5 flex-center text-xs "text-[var(--g-tabbar-tab-color)]" op-0 hover:(border bg-secondary);
    }
  }
}
</style>
