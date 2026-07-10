<script setup lang="ts">
import { useHotkeyBindings } from '@/hotkeys'
import { useSlots } from '@/slots'
import Logo from '../Logo/index.vue'
import Menu from '../Menu/index.vue'

defineOptions({
  name: 'MainSidebar',
})

defineProps<{
  enable: boolean
}>()

const route = useRoute()

const appSettingsStore = useAppSettingsStore()
const appMenuStore = useAppMenuStore()

const { generateI18nTitle, switchTo } = useAppMenu()

useHotkeyBindings({
  'menu.next': () => {
    switchTo(appMenuStore.actived + 1 < appMenuStore.allMenus.length ? appMenuStore.actived + 1 : 0)
  },
  'menu.prev': () => {
    switchTo(appMenuStore.actived - 1 >= 0 ? appMenuStore.actived - 1 : appMenuStore.allMenus.length - 1)
  },
})

function iconName(isActive: boolean, icon?: string | [string, string]) {
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
</script>

<template>
  <Transition name="main-sidebar">
    <div v-if="enable" class="main-sidebar-container">
      <Component :is="useSlots('main-sidebar-top')" />
      <Logo :show-title="false" class="sidebar-logo" />
      <Component :is="useSlots('main-sidebar-after-logo')" />
      <FaScrollArea :scrollbar="false" mask gradient-color="var(--g-main-sidebar-bg)" class="menu overscroll-contain flex-1">
        <!-- 侧边栏模式（含主导航） -->
        <div
          v-if="appSettingsStore.settings.menu.mode === 'side' || (appSettingsStore.mode === 'mobile' && appSettingsStore.settings.menu.mode !== 'single')" class="py-1 flex flex-col w-full transition-all of-hidden -mt-2" :class="{
            [`menu-active-${appSettingsStore.settings.menu.style}`]: appSettingsStore.settings.menu.style !== '',
          }"
        >
          <template v-for="(item, index) in appMenuStore.allMenus" :key="index">
            <div
              class="menu-item px-2 py-1 transition-all relative" :class="{
                active: index === appMenuStore.actived,
              }"
            >
              <FaTooltip v-if="item.children && item.children.length !== 0" :disabled="!generateI18nTitle(item.meta?.title)" :text="generateI18nTitle(item.meta?.title)" side="right">
                <div
                  class="group menu-item-container text-[var(--g-main-sidebar-menu-color)] py-4 rounded-lg flex gap-1 h-full w-full cursor-pointer transition-colors items-center justify-between relative hover-(text-[var(--g-main-sidebar-menu-hover-color)] bg-[var(--g-main-sidebar-menu-hover-bg)]) px-2!" :class="{
                    'text-[var(--g-main-sidebar-menu-active-color)]! bg-[var(--g-main-sidebar-menu-active-bg)]!': index === appMenuStore.actived,
                  }" @click="switchTo(index)"
                >
                  <div class="inline-flex flex-1 flex-col gap-1 w-full items-center justify-center">
                    <FaIcon v-if="iconName(index === appMenuStore.actived, item.meta?.icon)" :name="iconName(index === appMenuStore.actived, item.meta?.icon)!" class="menu-item-container-icon transition-transform group-hover-scale-120" />
                    <span class="text-sm text-center flex-1 w-full truncate transition-height transition-opacity transition-width empty:hidden">
                      {{ generateI18nTitle(item.meta?.title) }}
                    </span>
                  </div>
                  <FaBadge
                    v-if="item.meta?.badge"
                    :value="Array.isArray(item.meta.badge) ? (typeof item.meta.badge[0] === 'function' ? item.meta.badge[0]() : item.meta.badge[0]) : (typeof item.meta.badge === 'function' ? item.meta.badge() : item.meta.badge)"
                    :variant="Array.isArray(item.meta.badge) ? (typeof item.meta.badge[1] === 'function' ? item.meta.badge[1]() : item.meta.badge[1]) : undefined"
                    class="badge"
                    :class="{ dot: (Array.isArray(item.meta.badge) ? (typeof item.meta.badge[0] === 'function' ? item.meta.badge[0]() : item.meta.badge[0]) : (typeof item.meta.badge === 'function' ? item.meta.badge() : item.meta.badge)) === true }"
                  />
                </div>
              </FaTooltip>
            </div>
          </template>
        </div>
        <!-- 侧边栏精简/面板模式 -->
        <Menu
          v-else-if="['only-side', 'side-panel'].includes(appSettingsStore.settings.menu.mode)" :variant="appSettingsStore.settings.menu.mode === 'side-panel' ? 'panel' : 'default'" :menu="appMenuStore.allMenus" :value="route.meta.activeMenu || route.path" show-collapse-name collapse :dark="appSettingsStore.settings.menu.dark" class="-mt-2" :class="{
            [`menu-active-${appSettingsStore.settings.menu.style}`]: appSettingsStore.settings.menu.style !== '',
          }"
        />
      </FaScrollArea>
      <Component :is="useSlots('main-sidebar-after-menu')" />
      <div class="px-4 py-3 flex-center">
        <AppAccountButton only-avatar :button-variant="appSettingsStore.settings.menu.mode === 'side' ? 'secondary' : 'ghost'" class="p-2 size-12" />
      </div>
      <Component :is="useSlots('main-sidebar-bottom')" />
    </div>
  </Transition>
</template>

<style scoped>
.main-sidebar-container {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  width: var(--g-main-sidebar-width);
  color: var(--g-main-sidebar-menu-color);
  background-color: var(--g-main-sidebar-bg);
  box-shadow: 1px 0 0 0 oklch(var(--border));
  transition: color 0.15s, background-color 0.15s, box-shadow 0.15s;

  [dir="rtl"] & {
    box-shadow: -1px 0 0 0 oklch(var(--border));
  }

  .sidebar-logo {
    background-color: var(--g-main-sidebar-bg);
    transition: background-color 0.15s;
  }

  .menu {
    .menu-active {
      &-arrow {
        .item-container::before,
        :deep(.menu-item::before) {
          position: absolute;
          inset-inline-end: -5px;
          top: 50%;
          z-index: 1;
          width: 0;
          height: 0;
          content: "";
          border-block: 5px solid transparent;
          border-inline-end: 5px solid var(--g-main-sidebar-bg);
          opacity: 0;
          transform: translateY(-50%);
          transition: all 0.15s;
        }

        .item-container.active::before,
        :deep(.menu-item.active::before) {
          inset-inline-end: 8px;
          opacity: 1;
        }
      }

      &-line {
        .item-container::before,
        :deep(.menu-item::before) {
          position: absolute;
          inset-inline-start: 6px;
          top: 50%;
          z-index: 1;
          width: 4px;
          height: 0;
          content: "";
          background-color: var(--g-main-sidebar-menu-active-bg);
          border-radius: 2px;
          box-shadow: 0 0 0 1px var(--g-main-sidebar-bg);
          opacity: 0;
          transform: translateY(-50%);
          transition: all 0.15s;
        }

        .item-container.active::before,
        :deep(.menu-item.active::before) {
          height: 20px;
          opacity: 1;
        }
      }

      &-dot {
        .item-container::before,
        :deep(.menu-item::before) {
          position: absolute;
          inset-inline-start: 0;
          top: 50%;
          z-index: 1;
          width: 10px;
          height: 10px;
          content: "";
          background-color: var(--g-main-sidebar-menu-active-bg);
          border-radius: 50%;
          box-shadow: 0 0 0 1px var(--g-main-sidebar-bg);
          opacity: 0;
          transform: translateY(-50%);
          transition: all 0.15s;
        }

        .item-container.active::before,
        :deep(.menu-item.active::before) {
          inset-inline-start: 4px;
          opacity: 1;
        }
      }
    }

    :deep(.menu-item) {
      .menu-item-container {
        aspect-ratio: 1 / 1;
        padding-block: 8px;
        color: var(--g-main-sidebar-menu-color);

        &:hover {
          color: var(--g-main-sidebar-menu-hover-color);
          background-color: var(--g-main-sidebar-menu-hover-bg);
        }

        .menu-item-container-icon {
          font-size: 20px !important;
        }

        .badge {
          position: absolute;
          inset-block-start: calc(0.5rem + 1px);
          inset-inline-end: 3px;
          display: inline-flex;
          transform: scale(0.75);

          &.dot {
            inset-block-start: 0.5rem;
            inset-inline-end: 2px;
            transform: scale(1);
          }

          > div > div {
            inset-inline-start: initial !important;
            inset-inline-end: 0;
          }
        }
      }

      &.active .menu-item-container {
        color: var(--g-main-sidebar-menu-active-color) !important;
        background-color: var(--g-main-sidebar-menu-active-bg) !important;
      }
    }
  }
}

/* 主侧边栏动画 */
.main-sidebar-enter-active,
.main-sidebar-leave-active {
  transition: 0.3s;
}

.main-sidebar-enter-from,
.main-sidebar-leave-to {
  transform: translateX(calc(var(--g-main-sidebar-width) * -1));

  [dir="rtl"] & {
    transform: translateX(var(--g-main-sidebar-width));
  }
}
</style>
