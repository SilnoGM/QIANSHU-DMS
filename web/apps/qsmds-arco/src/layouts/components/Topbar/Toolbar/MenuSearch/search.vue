<script setup lang="ts">
import type { MenuRecordRaw } from '@fantastic-admin/types'
import { match } from 'pinyin-pro'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useHotkeyBindings } from '@/hotkeys'
import Breadcrumb from '@/layouts/components/Breadcrumb/index.vue'
import BreadcrumbItem from '@/layouts/components/Breadcrumb/item.vue'
import { resolveRoutePath } from '@/utils'

defineOptions({
  name: 'ToolbarMenuSearchModal',
})

const isShow = defineModel<boolean>({
  default: false,
})

const { t } = useI18n()

const router = useRouter()
const appSettingsStore = useAppSettingsStore()
const appRouteStore = useAppRouteStore()
const { generateI18nTitle } = useAppMenu()

interface listTypes {
  path: string
  query?: Record<string, any>
  icon?: string
  title?: string | (() => string)
  link?: string
}

const searchInput = ref('')
const sourceList = ref<listTypes[]>([])
const actived = ref(0)

const searchInputRef = useTemplateRef<HTMLInputElement>('searchInputRef')
const searchResultRef = useTemplateRef('searchResultRef')
const searchResultItemRef = useTemplateRef<HTMLElement[]>('searchResultItemRef')

const resultList = computed(() => {
  let result = []
  result = sourceList.value.filter((item) => {
    let flag = false
    if (searchInput.value !== '') {
      if (item.path.includes(searchInput.value)) {
        flag = true
      }
      if (
        generateI18nTitle(item.title).toString().includes(searchInput.value)
        || (match(generateI18nTitle(item.title).toString(), searchInput.value, { continuous: true })?.length ?? 0) > 0
      ) {
        flag = true
      }
      if (appRouteStore.getRouteMatchedByPath(item.path).some((b) => {
        return generateI18nTitle(b.meta?.title).toString().includes(searchInput.value)
          || (match(generateI18nTitle(b.meta?.title).toString(), searchInput.value, { continuous: true })?.length ?? 0) > 0
      })) { flag = true }
    }
    return flag
  })
  return result
})

useHotkeyBindings({
  'menuSearch.moveUp': () => {
    keyUp()
  },
  'menuSearch.moveDown': () => {
    keyDown()
  },
  'menuSearch.confirm': () => {
    keyEnter()
  },
  'menuSearch.close': () => {
    isShow.value = false
  },
}, () => isShow.value)

watch(() => isShow.value, async (val) => {
  if (val) {
    searchInput.value = ''
    actived.value = 0
    // QsGenericModal 统一自动聚焦；显式落到搜索框，保留命令面板打开即输入的效率。
    await nextTick()
    searchInputRef.value?.focus()
  }
})
watch(() => resultList.value, () => {
  actived.value = 0
  handleScroll()
})
watch(() => actived.value, () => {
  handleScroll()
})

onMounted(() => {
  initSourceList()
})

function initSourceList() {
  sourceList.value = []
  const appMenuStore = useAppMenuStore()
  appMenuStore.allMenus.forEach((item) => {
    getSourceList(item.children)
  })
}

function hasChildren(item: MenuRecordRaw) {
  let flag = true
  if (item.children?.every(i => i.meta?.menu === false)) {
    flag = false
  }
  return flag
}
function getSourceList(arr: MenuRecordRaw[], basePath?: string, icon?: string) {
  arr.forEach((item) => {
    if (item.meta?.menu !== false) {
      if (item.children && hasChildren(item)) {
        getSourceList(
          item.children,
          resolveRoutePath(basePath, item.path),
          item.meta?.icon
            ? (typeof item.meta.icon === 'string' ? item.meta.icon : item.meta.icon[0])
            : icon,
        )
      }
      else {
        sourceList.value.push({
          path: resolveRoutePath(basePath, item.path),
          query: item.meta?.query,
          icon: item.meta?.icon
            ? (typeof item.meta.icon === 'string' ? item.meta.icon : item.meta.icon[0])
            : icon,
          title: item.meta?.title,
          link: item.meta?.link,
        })
      }
    }
  })
}

function keyUp() {
  if (resultList.value.length) {
    actived.value -= 1
    if (actived.value < 0) {
      actived.value = resultList.value.length - 1
    }
  }
}
function keyDown() {
  if (resultList.value.length) {
    actived.value += 1
    if (actived.value > resultList.value.length - 1) {
      actived.value = 0
    }
  }
}
function keyEnter() {
  searchResultItemRef.value?.find(item => Number.parseInt(item.dataset.index!) === actived.value)?.click()
}

function handleScroll() {
  if (searchResultRef.value?.ref?.el?.viewportElement) {
    const contentDom = searchResultRef.value.ref.el.viewportElement
    let scrollTo = 0
    if (resultList.value.length > 0) {
      scrollTo = contentDom.scrollTop
      const activedOffsetTop = searchResultItemRef.value?.find(item => Number.parseInt(item.dataset.index!) === actived.value)?.offsetTop ?? 0
      const activedClientHeight = searchResultItemRef.value?.find(item => Number.parseInt(item.dataset.index!) === actived.value)?.clientHeight ?? 0
      const searchScrollTop = contentDom.scrollTop
      const searchClientHeight = contentDom.clientHeight
      if (activedOffsetTop + activedClientHeight > searchScrollTop + searchClientHeight) {
        scrollTo = activedOffsetTop + activedClientHeight - searchClientHeight
      }
      else if (activedOffsetTop <= searchScrollTop) {
        scrollTo = activedOffsetTop - 16
      }
    }
    contentDom.scrollTo({
      top: scrollTo,
    })
  }
}

function pageJump(path: listTypes['path'], query: listTypes['query'], link: listTypes['link']) {
  if (link) {
    window.open(link, '_blank')
  }
  else {
    router.push({
      path,
      query,
    })
  }
  isShow.value = false
}
</script>

<template>
  <QsGenericModal
    v-model="isShow"
    :title="t('app.layouts.topbar.toolbar.menuSearch.welcome')"
    size="lg"
    :closable="false"
  >
    <div class="mb-4 border border-border rounded-lg bg-muted/25 flex flex-shrink-0 h-11 items-center">
      <div class="flex-center h-full w-11">
        <FaIcon name="i-ri:search-line" class="text-foreground/50 size-4" />
      </div>
      <input
        ref="searchInputRef"
        v-model="searchInput"
        :placeholder="t('app.layouts.topbar.toolbar.menuSearch.input')"
        class="text-base text-foreground border-0 rounded-md bg-transparent flex-1 h-full min-w-0 focus-outline-none placeholder-foreground/40"
        @keydown.esc.prevent="isShow = false"
        @keydown.up.prevent="keyUp"
        @keydown.down.prevent="keyDown"
        @keydown.enter.prevent="keyEnter"
      >
      <FaButton
        v-if="appSettingsStore.mode === 'mobile'"
        type="button"
        variant="ghost"
        size="icon"
        class="border-s rounded-none h-full w-11"
        aria-label="关闭菜单搜索"
        @click="isShow = false"
      >
        <FaIcon name="i-carbon:close" class="size-4" />
      </FaButton>
    </div>

    <template v-if="appSettingsStore.mode === 'pc'" #footer>
      <div class="flex w-full items-center justify-between">
        <div class="flex gap-8">
          <div class="text-xs inline-flex gap-1 items-center">
            <FaKbd>⏎</FaKbd>
            <span>{{ t('app.layouts.topbar.toolbar.menuSearch.enter') }}</span>
          </div>
          <div class="text-xs inline-flex gap-1 items-center">
            <FaKbd>
              <FaIcon name="i-ant-design:caret-up-filled" />
            </FaKbd>
            <FaKbd>
              <FaIcon name="i-ant-design:caret-down-filled" />
            </FaKbd>
            <span>{{ t('app.layouts.topbar.toolbar.menuSearch.upDown') }}</span>
          </div>
        </div>
        <div v-if="appSettingsStore.settings.toolbar.menuSearch.hotkeys" class="text-xs inline-flex gap-1 items-center">
          <FaKbd>Esc</FaKbd>
          <span>{{ t('app.layouts.topbar.toolbar.menuSearch.esc') }}</span>
        </div>
      </div>
    </template>

    <FaScrollArea ref="searchResultRef" class="h-[min(50dvh,28rem)]">
      <template v-if="resultList.length > 0">
        <div v-for="(item, index) in resultList" ref="searchResultItemRef" :key="item.path" class="p-4" :data-index="index" @click="pageJump(item.path, item.query, item.link)" @mouseover="actived = index">
          <a class="border rounded-lg flex cursor-pointer items-center" :class="{ '-mt-4': index !== 0, 'bg-accent border-primary shadow-[0_0_0_1px_oklch(var(--primary))]': index === actived, 'op-50': index !== actived }">
            <div class="flex-center basis-16 -me-4">
              <FaIcon v-if="item.icon" :name="item.icon" class="size-5 transition" :class="{ 'scale-120 text-primary': index === actived }" />
            </div>
            <div class="px-4 py-3 flex flex-1 flex-col gap-1 truncate">
              <div class="text-base font-bold text-start truncate">{{ generateI18nTitle(item.title) }}</div>
              <Breadcrumb v-if="appRouteStore.getRouteMatchedByPath(item.path).length" class="truncate">
                <BreadcrumbItem v-for="(bc, bcIndex) in appRouteStore.getRouteMatchedByPath(item.path)" :key="bcIndex" class="text-xs">
                  {{ generateI18nTitle(bc.meta?.title) }}
                </BreadcrumbItem>
              </Breadcrumb>
            </div>
          </a>
        </div>
      </template>
      <template v-else-if="searchInput === ''">
        <div class="text-secondary-foreground/50 py-6 flex-col-center h-full">
          <FaIcon name="i-tabler:mood-smile" class="size-10" />
          <p class="text-base m-2">
            {{ t('app.layouts.topbar.toolbar.menuSearch.welcome') }}
          </p>
        </div>
      </template>
      <template v-else>
        <div class="text-secondary-foreground/50 py-6 flex-col-center h-full">
          <FaIcon name="i-tabler:mood-empty" class="size-10" />
          <p class="text-base m-2">
            {{ t('app.layouts.topbar.toolbar.menuSearch.empty') }}
          </p>
        </div>
      </template>
    </FaScrollArea>
  </QsGenericModal>
</template>
