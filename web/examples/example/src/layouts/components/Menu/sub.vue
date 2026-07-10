<script setup lang="ts">
import type { SubMenuProps } from './types'
import { useTextDirection, useTimeoutFn } from '@vueuse/core'
import { cn } from '@/utils'
import Item from './item.vue'
import { rootMenuInjectionKey } from './types'

defineOptions({
  name: 'SubMenu',
})

const props = withDefaults(
  defineProps<SubMenuProps>(),
  {
    level: 0,
  },
)

const itemRef = useTemplateRef('itemRef')
const subMenuRef = useTemplateRef('subMenuRef')
const rootMenu = inject(rootMenuInjectionKey)!
const documentDir = useTextDirection({
  observe: true,
})
const dir = computed(() => documentDir.value === 'rtl' ? 'rtl' : 'ltr')

const index = props.menu.path ?? rootMenu.getUseId(props.menu)

const expand = computed(() => rootMenu.expandMenus.includes(props.uniqueKey.at(-1)!))
const alwaysExpand = computed(() => rootMenu.alwaysExpandMenus.includes(props.uniqueKey.at(-1)!))

const transitionEvent = computed(() => {
  if (rootMenu.isMenuPopup) {
    return {
      enter(el: HTMLElement) {
        if (el.offsetHeight > window.innerHeight) {
          el.style.height = `${window.innerHeight}px`
        }
      },
      afterEnter: () => {},
      beforeLeave: (el: HTMLElement) => {
        el.style.maxHeight = `${el.offsetHeight}px`
        el.style.overflow = 'hidden'
      },
      leave: (el: HTMLElement) => {
        el.style.maxHeight = '0'
      },
      afterLeave(el: HTMLElement) {
        el.style.maxHeight = ''
        el.style.overflow = ''
      },
    }
  }
  if (CSS.supports('height', 'calc-size(auto, size)')) {
    return {}
  }
  return {
    enter(el: HTMLElement) {
      el.dataset.height = el.offsetHeight.toString()
      el.style.maxHeight = '0'
      el.style.overflow = 'hidden'
      void el.offsetHeight // 强制重排，确保浏览器应用初始状态
      requestAnimationFrame(() => {
        el.style.maxHeight = `${el.dataset.height}px`
      })
    },
    afterEnter(el: HTMLElement) {
      el.style.maxHeight = ''
      el.style.overflow = ''
    },
    enterCancelled(el: HTMLElement) {
      el.style.maxHeight = ''
      el.style.overflow = ''
    },
    beforeLeave(el: HTMLElement) {
      el.style.maxHeight = `${el.offsetHeight}px`
      el.style.overflow = 'hidden'
      void el.offsetHeight // 强制重排，确保浏览器应用初始状态
    },
    leave(el: HTMLElement) {
      requestAnimationFrame(() => {
        el.style.maxHeight = '0'
      })
    },
    afterLeave(el: HTMLElement) {
      el.style.maxHeight = ''
      el.style.overflow = ''
    },
    leaveCancelled(el: HTMLElement) {
      el.style.maxHeight = ''
      el.style.overflow = ''
    },
  }
})

const transitionClass = computed(() => {
  if (rootMenu.isMenuPopup) {
    return {
      enterActiveClass: 'ease-in-out duration-300',
      enterFromClass: 'opacity-0 translate-x-4',
      enterToClass: 'opacity-100',
      leaveActiveClass: 'ease-in-out duration-300',
      leaveFromClass: 'opacity-100',
      leaveToClass: 'opacity-0',
    }
  }
  return {
    enterActiveClass: 'ease-in-out duration-200',
    enterFromClass: cn('opacity-0 translate-y-2', CSS.supports('height', 'calc-size(auto, size)') && 'h-0'),
    enterToClass: 'opacity-100 translate-y-0',
    leaveActiveClass: 'ease-in-out duration-200',
    leaveFromClass: 'opacity-100 translate-y-0',
    leaveToClass: cn('opacity-0 translate-y-2', CSS.supports('height', 'calc-size(auto, size)') && 'h-0'),
  }
})

const hasChildren = computed(() => props.menu.children?.some((item: any) => item.meta?.menu !== false) ?? false)

function handleClick() {
  if (
    alwaysExpand.value
    || (rootMenu.isMenuPopup && hasChildren.value)
    || props.menu.meta?.link
    || props.menu.meta?.newWindow
  ) {
    return
  }
  if (hasChildren.value) {
    rootMenu.handleSubMenuClick(index, props.uniqueKey)
  }
  else {
    rootMenu.handleMenuItemClick(index)
  }
}

let timeout: (() => void) | undefined

function handleMouseenter() {
  if (!rootMenu.isMenuPopup) {
    return
  }
  if (rootMenu.props.variant === 'panel' && props.level !== 0) {
    return
  }
  rootMenu.mouseInMenu = props.uniqueKey
  timeout?.()
  ;({ stop: timeout } = useTimeoutFn(() => {
    if (hasChildren.value) {
      rootMenu.openMenu(index, props.uniqueKey)
      nextTick(() => {
        requestAnimationFrame(() => {
          const el = itemRef.value?.ref
          const subMenuEl = subMenuRef.value?.$el
          if (!el || !subMenuEl) {
            return
          }
          const rect = el.getBoundingClientRect()
          const { top, left, width, height } = rect
          let menuTop = 0
          let menuLeft = 0
          if (rootMenu.props.mode === 'vertical' || props.level !== 0) {
            menuTop = top + el.scrollTop - 5 // 4px padding + 1px border
            menuLeft = (dir.value === 'ltr' ? left : document.documentElement.clientWidth - rect.right) + width + 4
            // 处理边界情况
            if (menuTop + subMenuEl.offsetHeight > window.innerHeight) {
              menuTop = Math.max(0, window.innerHeight - subMenuEl.offsetHeight)
            }
          }
          else {
            menuTop = top + height + 3
            menuLeft = dir.value === 'ltr' ? left : document.documentElement.clientWidth - rect.right
            menuLeft -= 5 // 4px padding + 1px border
            // 处理边界情况
            if (menuTop + subMenuEl.offsetHeight > window.innerHeight) {
              subMenuEl.style.height = `${window.innerHeight - menuTop}px`
            }
          }
          // 处理边界情况
          if (menuLeft + subMenuEl.offsetWidth > document.documentElement.clientWidth) {
            menuLeft = (dir.value === 'ltr' ? left : document.documentElement.clientWidth - rect.right) - width
          }
          // 设置样式
          Object.assign(subMenuEl.style, {
            top: `${menuTop}px`,
            insetInlineStart: `${menuLeft}px`,
            willChange: 'transform',
            transform: 'translateZ(0)',
          })
        })
      })
    }
    else {
      const path = props.menu.children ? rootMenu.subMenus[index].indexPath.at(-1)! : rootMenu.items[index].indexPath.at(-1)!
      rootMenu.openMenu(path, rootMenu.subMenus[path].indexPath)
    }
  }, 300))
}

function handleMouseleave() {
  if (!rootMenu.isMenuPopup) {
    return
  }
  if (rootMenu.props.variant === 'panel' && props.level !== 0) {
    return
  }
  rootMenu.mouseInMenu = []
  timeout?.()
  ;({ stop: timeout } = useTimeoutFn(() => {
    requestAnimationFrame(() => {
      if (rootMenu.mouseInMenu.length === 0) {
        rootMenu.closeMenu(props.uniqueKey)
      }
      else {
        if (hasChildren.value) {
          !rootMenu.mouseInMenu.includes(props.uniqueKey.at(-1)!) && rootMenu.closeMenu(props.uniqueKey.at(-1)!)
        }
      }
    })
  }, 300))
}

function handlePanelMouseenter() {
  timeout?.()
}
</script>

<template>
  <Item ref="itemRef" :unique-key="uniqueKey" :item="menu" :level="level" :sub-menu="hasChildren" :expand :always-expand @click="handleClick" @mouseenter="handleMouseenter" @mouseleave="handleMouseleave" />
  <template v-if="hasChildren">
    <!-- panel 变体：宽面板 + columns 布局，level > 0 直接内联渲染 -->
    <template v-if="rootMenu.props.variant === 'panel'">
      <Teleport to="body" :disabled="level !== 0">
        <Transition v-if="level === 0" v-bind="transitionClass" v-on="transitionEvent">
          <FaScrollArea
            v-show="expand" ref="subMenuRef" mask
            class="sub-menu overscroll-contain border rounded-lg bg-[var(--g-sub-sidebar-bg)] w-150 shadow-xl z-3000 2xl:w-200 fixed!"
            :class="{ dark: rootMenu.props.dark }"
            @mouseenter="handlePanelMouseenter"
            @mouseleave="handleMouseleave"
          >
            <div class="p-2 px-3 columns-3 2xl:columns-4">
              <div v-for="item in menu.children" :key="item.path ?? rootMenu.getUseId(item)" class="w-full break-inside-avoid">
                <SubMenu v-if="item.meta?.menu !== false" :unique-key="[...uniqueKey, item.path ?? rootMenu.getUseId(item)]" :menu="item" :level="level + 1" />
              </div>
            </div>
          </FaScrollArea>
        </Transition>
        <template v-else>
          <template v-for="item in menu.children" :key="item.path ?? rootMenu.getUseId(item)">
            <SubMenu v-if="item.meta?.menu !== false" :unique-key="[...uniqueKey, item.path ?? rootMenu.getUseId(item)]" :menu="item" :level="level + 1" />
          </template>
        </template>
      </Teleport>
    </template>
    <!-- default 变体：窄竖列弹出 -->
    <template v-else>
      <Teleport to="body" :disabled="!rootMenu.isMenuPopup">
        <Transition v-bind="transitionClass" v-on="transitionEvent">
          <FaScrollArea
            v-if="expand" ref="subMenuRef" :scrollbar="false" :mask="rootMenu.isMenuPopup"
            :class="cn('sub-menu static h-[calc-size(auto,size)] rounded-lg', {
              'bg-[var(--g-sub-sidebar-bg)]': rootMenu.isMenuPopup,
              'border shadow-xl fixed z-3000 w-[200px]': rootMenu.isMenuPopup,
              'py-1 overscroll-contain': rootMenu.isMenuPopup,
              'dark': rootMenu.props.dark,
            })"
          >
            <template v-for="item in menu.children" :key="item.path ?? rootMenu.getUseId(item)">
              <SubMenu v-if="item.meta?.menu !== false" :unique-key="[...uniqueKey, item.path ?? rootMenu.getUseId(item)]" :menu="item" :level="level + 1" />
            </template>
          </FaScrollArea>
        </Transition>
      </Teleport>
    </template>
  </template>
</template>
