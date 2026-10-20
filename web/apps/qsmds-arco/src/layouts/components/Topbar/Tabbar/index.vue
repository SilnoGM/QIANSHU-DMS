<script setup lang="ts">
import type { TabbarRecordRaw } from '@fantastic-admin/types'
import { useMagicKeys } from '@vueuse/core'
import Sortable from 'sortablejs'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { useHotkeyBindings } from '@/hotkeys'
import { useSlots } from '@/slots'
import MoreAction from './moreAction.vue'

defineOptions({
  name: 'Tabbar',
})

const route = useRoute()
const router = useRouter()

const appSettingsStore = useAppSettingsStore()
const appTabbarStore = useAppTabbarStore()

const tabbar = useAppTabbar()
const mainPage = useAppPage()

const keys = useMagicKeys({ reactive: true })

const { t } = useI18n()
const { generateI18nTitle } = useAppMenu()

const tabbarMinWidth = computed(() => appSettingsStore.settings.tabbar.minMaxWidth[0] === 'unset' ? 'unset' : `${appSettingsStore.settings.tabbar.minMaxWidth[0]}px`)
const tabbarMaxWidth = computed(() => appSettingsStore.settings.tabbar.minMaxWidth[1] === 'unset' ? 'unset' : `${appSettingsStore.settings.tabbar.minMaxWidth[1]}px`)

const activedTabId = computed(() => tabbar.getId())
const isShowMoreAction = computed(() => appTabbarStore.list.length > 1 && (tabbar.checkCloseOtherSide() || tabbar.checkCloseLeftSide() || tabbar.checkCloseRightSide()))

const tabsRef = useTemplateRef('tabsRef')
const tabContainerRef = useTemplateRef('tabContainerRef')
const tabRef = useTemplateRef<HTMLElement[]>('tabRef')
const visibleTabIndex = ref<number[]>([])

const isAnimating = ref(false)
const isDragging = ref(false)
const isInit = ref(true)

useHotkeyBindings({
  'tabbar.prev': () => {
    if (appTabbarStore.list[0]?.tabId !== activedTabId.value) {
      const index = appTabbarStore.list.findIndex(item => item.tabId === activedTabId.value)
      index > 0 && router.push(appTabbarStore.list[index - 1].fullPath)
    }
  },
  'tabbar.next': () => {
    if (appTabbarStore.list.at(-1)?.tabId !== activedTabId.value) {
      const index = appTabbarStore.list.findIndex(item => item.tabId === activedTabId.value)
      index >= 0 && router.push(appTabbarStore.list[index + 1].fullPath)
    }
  },
  'tabbar.closeCurrent': () => {
    tabbar.closeById(activedTabId.value)
  },
  'tabbar.gotoVisibleIndex': ({ hotkey }) => {
    const number = Number(hotkey.split('+')[1])
    if (visibleTabIndex.value[number - 1] !== undefined) {
      router.push(appTabbarStore.list[visibleTabIndex.value[number - 1]].fullPath)
    }
  },
  'tabbar.gotoLast': () => {
    const last = appTabbarStore.list.at(-1)
    last && router.push(last.fullPath)
  },
})

function onBeforeLeave(el: Element) {
  isAnimating.value = true
  const htmlEl = el as HTMLElement
  htmlEl.style.left = `${htmlEl.offsetLeft}px`
  htmlEl.style.top = `${htmlEl.offsetTop}px`
  htmlEl.style.width = `${htmlEl.offsetWidth}px`
}
let tabSortable: Sortable
onMounted(() => {
  nextTick(() => {
    isInit.value = false
  })
  tabSortable = new Sortable(tabContainerRef.value?.$el, {
    animation: 200,
    ghostClass: 'opacity-0',
    draggable: '.tab',
    handle: '.drag-handle',
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
})
watch([
  () => appSettingsStore.mode,
  () => appSettingsStore.langDirection,
], (val) => {
  nextTick(() => {
    tabSortable?.option('disabled', val[0] === 'mobile' || val[1] === 'rtl')
  })
}, {
  immediate: true,
})

watch(() => route, (val) => {
  if (appSettingsStore.settings.topbar.tabbar) {
    appTabbarStore.add(val)
    nextTick(() => {
      const index = appTabbarStore.list.findIndex(item => item.tabId === activedTabId.value)
      if (index !== -1) {
        const tabEl = tabRef.value?.find(item => Number.parseInt(item.dataset.index!) === index)
        const containerEl = tabsRef.value?.ref?.$el
        if (tabEl && containerEl) {
          const tabLeft = tabEl.offsetLeft
          const tabWidth = tabEl.offsetWidth
          const containerWidth = containerEl.clientWidth
          // 计算滚动位置，使标签页居中
          const scrollLeft = tabLeft - (containerWidth - tabWidth) / 2
          // 首次加载时直接定位到指定位置
          tabsRef.value?.scrollTo(scrollLeft, !isInit.value ? 'smooth' : undefined)
        }
        tabbarScrollTip()
      }
    })
  }
}, {
  immediate: true,
  deep: true,
})

function tabbarScrollTip() {
  if (tabContainerRef.value?.$el.clientWidth > (tabsRef.value?.ref?.$el.clientWidth ?? 0) && !localStorage.has('tabbarScrollTip')) {
    localStorage.setItem('tabbarScrollTip', '')
    const tips = useQsToast().info(t('app.layouts.topbar.tabbar.scrollTip.title'), {
      description: t('app.layouts.topbar.tabbar.scrollTip.description'),
      duration: Infinity,
      action: {
        label: t('app.layouts.topbar.tabbar.scrollTip.action'),
        onClick: () => useQsToast().dismiss(tips),
      },
    })
  }
}
function onTabbarDblclick(routeItem: TabbarRecordRaw) {
  switch (appSettingsStore.settings.tabbar.dblclickAction) {
    case 'reload':
      mainPage.reload()
      break
    case 'close':
      tabbar.closeById(routeItem.tabId)
      break
    case 'pin':
      if (routeItem.isPin) {
        appTabbarStore.unPin(routeItem.tabId)
      }
      else {
        appTabbarStore.pin(routeItem.tabId)
      }
      break
    case 'maximize':
      appSettingsStore.setMainPageMaximize()
      break
    case 'window':
      window.open(router.resolve(routeItem.fullPath).href, '_blank')
      break
  }
}
function contextMenuItems(routeItem: TabbarRecordRaw) {
  return [
    [
      {
        label: t('app.layouts.topbar.tabbar.reload'),
        icon: 'i-ri:refresh-line',
        disabled: routeItem.tabId !== activedTabId.value,
        handle: () => mainPage.reload(),
      },
      {
        label: t('app.layouts.topbar.tabbar.close'),
        icon: 'i-ri:close-line',
        disabled: !tabbar.checkClose(routeItem.tabId),
        handle: () => tabbar.closeById(routeItem.tabId),
      },
    ],
    [
      {
        label: routeItem.isPin ? t('app.layouts.topbar.tabbar.unpin') : t('app.layouts.topbar.tabbar.pin'),
        icon: routeItem.isPin ? 'i-lucide:pin-off' : 'i-lucide:pin',
        // 主页不允许被固定，因为如果固定主页且主页未启用，会导致登录时进入路由死循环状态
        disabled: routeItem.fullPath === appSettingsStore.settings.app.home.fullPath || routeItem.tabPermanent,
        handle: () => routeItem.isPin ? appTabbarStore.unPin(routeItem.tabId) : appTabbarStore.pin(routeItem.tabId),
      },
      {
        label: t('app.layouts.topbar.tabbar.maximize'),
        icon: 'i-ri:picture-in-picture-exit-line',
        handle: () => {
          if (routeItem.tabId !== activedTabId.value) {
            router.push(routeItem.fullPath)
          }
          appSettingsStore.setMainPageMaximize()
        },
      },
      {
        label: t('app.layouts.topbar.tabbar.newWindow'),
        icon: 'i-ci:window',
        handle: () => {
          window.open(router.resolve(routeItem.fullPath).href, '_blank')
        },
      },
    ],
    [
      {
        label: t('app.layouts.topbar.tabbar.closeOtherSide'),
        icon: 'i-mdi:close',
        disabled: !tabbar.checkCloseOtherSide(routeItem.tabId),
        handle: () => {
          tabbar.closeOtherSide(routeItem.tabId)
        },
      },
      {
        label: t('app.layouts.topbar.tabbar.closeLeftSide'),
        icon: 'i-mdi:arrow-expand-left',
        disabled: !tabbar.checkCloseLeftSide(routeItem.tabId),
        handle: () => {
          tabbar.closeLeftSide(routeItem.tabId)
        },
      },
      {
        label: t('app.layouts.topbar.tabbar.closeRightSide'),
        icon: 'i-mdi:arrow-expand-right',
        disabled: !tabbar.checkCloseRightSide(routeItem.tabId),
        handle: () => {
          tabbar.closeRightSide(routeItem.tabId)
        },
      },
    ],
  ]
}

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

function getVisibleTabs() {
  const containerWidth = tabsRef.value?.ref?.$el.clientWidth ?? 0
  const scrollLeft = tabsRef.value?.ref?.el?.viewportElement?.scrollLeft ?? 0
  visibleTabIndex.value = []
  if (tabRef.value) {
    for (let i = 0; i < tabRef.value.length; i++) {
      const tab = tabRef.value[i]
      const tabLeft = tab.offsetLeft
      const tabRight = tabLeft + tab.offsetWidth
      if (tabLeft < scrollLeft + containerWidth && tabRight > scrollLeft) {
        if (i >= 0 && i < appTabbarStore.list.length) {
          visibleTabIndex.value.push(i)
        }
      }
    }
  }
}
function getVisibleTabIndex(arrayIndex: number) {
  return visibleTabIndex.value.findIndex(visibleTab => visibleTab === arrayIndex) ?? -1
}
watch(() => keys.alt, (val) => {
  if (val) {
    getVisibleTabs()
  }
})
</script>

<template>
  <div class="tabbar">
    <Component :is="useSlots('tabbar-start')" />
    <div class="tabbar-container">
      <FaScrollArea
        ref="tabsRef" :scrollbar="false" mask horizontal class="tabs overscroll-contain" :class="{
          'tabs-ontop': appSettingsStore.settings.topbar.switchTabbarAndToolbar,
          [`tabs-${appSettingsStore.settings.tabbar.style}`]: appSettingsStore.settings.tabbar.style !== '',
        }"
      >
        <TransitionGroup ref="tabContainerRef" :name="!isInit && !isDragging ? 'tabbar' : undefined" tag="div" class="tab-container" :class="{ dragging: isDragging }" @before-leave="onBeforeLeave" @after-leave="isAnimating = false">
          <div
            v-for="(element, index) in appTabbarStore.list" :key="element.tabMerge === 'routeName' && element.routeName ? element.routeName : element.tabId"
            ref="tabRef" :data-index="index" class="tab" :class="{
              'tab-ontop': appSettingsStore.settings.topbar.switchTabbarAndToolbar,
              'actived': element.tabId === activedTabId,
              'pinned': element.tabPermanent || element.isPin,
            }" @click="!isAnimating && element.tabId !== activedTabId && router.push(element.fullPath)" @dblclick="!isAnimating && onTabbarDblclick(element)"
          >
            <FaContextMenu :items="contextMenuItems(element)">
              <div class="size-full">
                <div class="tab-dividers" />
                <div class="tab-background" />
                <FaTooltip :delay="1000" side="bottom">
                  <div class="tab-content">
                    <div :key="element.tabId" class="title">
                      <FaIcon v-if="appSettingsStore.settings.tabbar.icon && iconName(element.tabId === activedTabId, element.icon)" :name="iconName(element.tabId === activedTabId, element.icon)!" class="icon" />
                      {{ element.customTitleList.find(item => item.fullPath === element.fullPath)?.title || generateI18nTitle(element.title) }}
                    </div>
                    <div v-if="!element.tabPermanent && element.isPin" class="action-icon" @click.stop="appTabbarStore.unPin(element.tabId)" @dblclick.stop>
                      <FaIcon name="i-ri:pushpin-2-fill" />
                    </div>
                    <div v-else-if="!element.tabPermanent && appTabbarStore.list.length > 1" class="action-icon" @click.stop="tabbar.closeById(element.tabId)" @dblclick.stop>
                      <FaIcon name="i-ri:close-fill" />
                    </div>
                    <div v-show="appSettingsStore.settings.tabbar.hotkeys && keys.alt && getVisibleTabIndex(index) >= 0 && getVisibleTabIndex(index) < 9" class="hotkey-number">
                      {{ getVisibleTabIndex(index) + 1 }}
                    </div>
                    <div class="drag-handle" />
                  </div>
                  <template #content>
                    <div class="text-sm">
                      {{ element.customTitleList.find(item => item.fullPath === element.fullPath)?.title || generateI18nTitle(element.title) }}
                    </div>
                    <div class="text-accent/50">
                      {{ element.fullPath }}
                    </div>
                  </template>
                </FaTooltip>
              </div>
            </FaContextMenu>
          </div>
        </TransitionGroup>
      </FaScrollArea>
      <div class="border-s flex-shrink-0 whitespace-nowrap empty:hidden">
        <MoreAction v-if="isShowMoreAction" />
      </div>
    </div>
    <Component :is="useSlots('tabbar-end')" />
  </div>
</template>

<style scoped>
.tabbar {
  position: relative;
  display: flex;
  align-items: center;
  height: var(--g-tabbar-height);
  background-color: var(--g-tabbar-bg);
  box-shadow: 0 1px 0 0 oklch(var(--border)), 0 -1px 0 0 oklch(var(--border));

  .tabbar-container {
    display: flex;
    flex: 1;
    min-width: 0;
    height: 100%;

    .tabs {
      flex: 1;
      align-items: end;
      white-space: nowrap;

      &.tabs-ontop {
        align-items: start;
      }

      .tab-container {
        position: relative;

        &:not(.dragging) {
          .tab {
            &:not(.actived):hover {
              z-index: 3;

              &::before,
              &::after {
                content: none;
              }

              & + .tab .tab-dividers::before {
                opacity: 0;
              }

              .tab-content {
                .title,
                .action-icon {
                  color: var(--g-tabbar-tab-hover-color);
                }
              }

              .tab-background {
                background-color: var(--g-tabbar-tab-hover-bg);
              }
            }
          }
        }

        .tab {
          position: relative;
          display: inline-block;
          min-width: v-bind(tabbarMinWidth);
          max-width: v-bind(tabbarMaxWidth);
          height: var(--g-tabbar-height);
          font-size: 14px;
          line-height: calc(var(--g-tabbar-height) - 2px);
          vertical-align: bottom;
          pointer-events: none;
          cursor: pointer;

          * {
            user-select: none;
          }

          & + .tab:hover,
          & + .tab.actived {
            .tab-dividers::before {
              opacity: 0;
            }
          }

          &.actived {
            z-index: 5;

            &::before,
            &::after {
              content: none;
            }

            & + .tab .tab-dividers::before {
              opacity: 0;
            }

            .tab-content {
              .title,
              .action-icon {
                color: var(--g-tabbar-tab-active-color);
              }
            }

            .tab-background {
              background-color: var(--g-tabbar-tab-active-bg);
            }
          }

          .tab-dividers {
            position: absolute;
            inset-inline: -1px;
            top: 50%;
            z-index: 0;
            height: 14px;
            transform: translateY(-50%);

            &::before {
              position: absolute;
              inset-inline-start: 1px;
              top: 0;
              bottom: 0;
              display: block;
              width: 1px;
              content: "";
              background-color: oklch(var(--border));
              opacity: 1;
              transition: opacity 0.3s, background-color 0.15s;
            }
          }

          &:first-child .tab-dividers::before {
            opacity: 0;
          }

          .tab-background {
            position: absolute;
            top: 0;
            left: 0;
            z-index: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            transition: background-color 0.15s;
          }

          .tab-content {
            display: flex;
            width: 100%;
            height: 100%;
            pointer-events: all;

            .title {
              display: flex;
              flex: 1;
              gap: 5px;
              align-items: center;
              height: 100%;
              padding: 0 10px;
              margin-inline-end: 10px;
              overflow: hidden;
              color: var(--g-tabbar-tab-color);
              white-space: nowrap;
              mask-image: linear-gradient(to right, #000 calc(100% - 20px), transparent);
              transition: margin-inline-end 0.3s;

              [dir="rtl"] & {
                mask-image: linear-gradient(to left, #000 calc(100% - 20px), transparent);
              }

              &:has(+ .action-icon) {
                margin-inline-end: 28px;
              }

              .icon {
                flex-shrink: 0;
              }
            }

            .action-icon {
              --uno: transition absolute inset-e-2 top-1/2 -translate-y-1/2 rounded-full z-10 w-5 h-5 flex-center text-xs "text-[var(--g-tabbar-tab-color)]" hover:(border bg-secondary);
            }

            .hotkey-number {
              --uno: border bg-secondary absolute inset-e-2 top-1/2 -translate-y-1/2 rounded-full z-10 w-5 h-5 flex-center text-xs "text-[var(--g-tabbar-tab-color)]";
            }

            .drag-handle {
              position: absolute;
              inset: 0;
              z-index: 9;
            }
          }
        }
      }

      &.tabs-fashion {
        .tab-container {
          &:not(.dragging) {
            .tab:not(.actived):hover {
              .tab-background {
                &::before,
                &::after {
                  background-color: var(--g-tabbar-tab-hover-bg);
                }
              }
            }
          }

          .tab {
            height: calc(var(--g-tabbar-height) - 6px);
            margin-inline: 10px -10px;

            &:last-child {
              margin-inline-end: 0;
            }

            &.tab-ontop .tab-background {
              transform: rotate(180deg);
            }

            .tab-background {
              border-radius: 10px 10px 0 0;

              &::before,
              &::after {
                position: absolute;
                bottom: 0;
                width: 10px;
                height: 10px;
                content: "";
                background-color: transparent;
                mask-size: 10px;
                transition: background-color 0.15s;
              }

              &::before {
                left: -10px;
                mask-image: url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M0 100c55.228 0 100-44.772 100-100v100H0z' fill='%23F8EAE7'/%3E%3C/svg%3E");
              }

              &::after {
                right: -10px;
                mask-image: url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M100 100C44.772 100 0 55.228 0 0v100h100z' fill='%23F8EAE7'/%3E%3C/svg%3E");
              }
            }

            &.actived {
              .tab-background {
                &::before,
                &::after {
                  background-color: var(--g-tabbar-tab-active-bg);
                }
              }
            }
          }
        }
      }

      &.tabs-card {
        .tab-container {
          .tab {
            height: calc(var(--g-tabbar-height) - 10px);
            margin: 5px 0 5px 5px;

            .tab-dividers {
              display: none;
            }

            .tab-background {
              border-radius: 5px;
            }
          }
        }
      }

      &.tabs-square {
        .tab-container {
          &::after {
            position: absolute;
            /* stylelint-disable-next-line declaration-property-value-no-unknown */
            inset-inline-start: anchor(--actived start);
            bottom: 0;
            z-index: 10;
            /* stylelint-disable-next-line declaration-property-value-no-unknown */
            width: anchor-size(--actived width);
            height: 2px;
            content: "";
            transition: width 0.3s, inset-inline-start 0.3s;

            --uno: bg-primary;
          }

          &:has(> .tab.tab-ontop) {
            &::after {
              top: 0;
              bottom: unset;
            }

            .tab {
              .tab-background {
                top: 0;
                bottom: unset;
              }
            }
          }

          .tab {
            &:not(.actived):hover {
              .tab-background {
                height: 100%;
              }
            }

            .tab-background {
              top: unset;
              bottom: 0;
              height: 0;
              background-color: var(--g-tabbar-tab-hover-bg);
              transition: height 0.3s;
            }

            &.actived {
              anchor-name: --actived;

              .tab-background {
                height: 100%;
                background-color: var(--g-tabbar-tab-active-bg);
              }
            }
          }
        }
      }
    }
  }
}

/* 标签栏动画 */
.tabs {
  .tabbar-move,
  .tabbar-enter-active,
  .tabbar-leave-active {
    transition: all 0.3s;
  }

  .tabbar-enter-from,
  .tabbar-leave-to {
    opacity: 0;
    transform: translateY(30px);
  }

  &.tabs-ontop {
    .tabbar-enter-from,
    .tabbar-leave-to {
      opacity: 0;
      transform: translateY(-30px);
    }
  }

  .tabbar-leave-active {
    position: absolute !important;
  }
}
</style>
