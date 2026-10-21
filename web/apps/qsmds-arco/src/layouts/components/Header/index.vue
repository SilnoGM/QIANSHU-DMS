<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { useSlots } from '@/slots'
import Logo from '../Logo/index.vue'
import Menu from '../Menu/index.vue'

defineOptions({
  name: 'LayoutHeader',
})

defineProps<{
  enable: boolean
}>()

const route = useRoute()

const appSettingsStore = useAppSettingsStore()
const appMenuStore = useAppMenuStore()

// 顶栏空间不足时退回单头像；菜单身份块跟随该状态显示，避免身份信息完全消失。
const compactAccount = useMediaQuery('(max-width: 1365px)')

const { generateI18nTitle, switchTo } = useAppMenu()

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
  <Transition name="header">
    <header v-if="enable">
      <div class="header-container">
        <Component :is="useSlots('header-start')" />
        <Logo class="title" />
        <Component :is="useSlots('header-after-logo')" />
        <FaScrollArea :scrollbar="false" mask horizontal class="menu-container overscroll-contain flex-1 h-full">
          <!-- 顶部模式 -->
          <div
            v-if="appSettingsStore.settings.menu.mode === 'head'" class="menu flex h-full transition-all of-hidden" :class="{
              [`menu-active-${appSettingsStore.settings.menu.style}`]: appSettingsStore.settings.menu.style !== '',
            }"
          >
            <template v-for="(item, index) in appMenuStore.allMenus" :key="index">
              <div
                class="menu-item mx-1 py-2 transition-all relative" :class="{
                  active: index === appMenuStore.actived,
                }"
              >
                <FaTooltip v-if="item.children && item.children.length !== 0" :disabled="!generateI18nTitle(item.meta?.title)" :text="generateI18nTitle(item.meta?.title)" side="bottom">
                  <div
                    class="group menu-item-container text-[var(--g-header-menu-color)] px-3 rounded-lg flex gap-1 h-full w-full cursor-pointer transition-colors items-center justify-between relative hover-(text-[var(--g-header-menu-hover-color)] bg-[var(--g-header-menu-hover-bg)])" :class="{
                      'text-[var(--g-header-menu-active-color)]! bg-[var(--g-header-menu-active-bg)]!': index === appMenuStore.actived,
                    }" @click="switchTo(index)"
                  >
                    <div class="inline-flex flex-1 gap-1 items-center justify-center">
                      <FaIcon v-if="iconName(index === appMenuStore.actived, item.meta?.icon)" :name="iconName(index === appMenuStore.actived, item.meta?.icon)!" class="menu-item-container-icon transition-transform group-hover-scale-120" :class="{ 'size-6!': iconName(index === appMenuStore.actived, item.meta?.icon)?.startsWith('qs-') }" />
                      <span class="text-sm flex-1 w-full truncate transition-height transition-opacity transition-width empty:hidden">
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
          <!-- 顶部精简/面板模式 -->
          <Menu
            v-else-if="['only-head', 'head-panel'].includes(appSettingsStore.settings.menu.mode)" :variant="appSettingsStore.settings.menu.mode === 'head-panel' ? 'panel' : 'default'" :menu="appMenuStore.allMenus" :value="route.meta.activeMenu || route.path" mode="horizontal" show-collapse-name collapse :dark="appSettingsStore.settings.menu.dark" class="menu" :class="{
              [`menu-active-${appSettingsStore.settings.menu.style}`]: appSettingsStore.settings.menu.style !== '',
            }"
          />
        </FaScrollArea>
        <Component :is="useSlots('header-after-menu')" />
        <div class="flex-center">
          <AppAccountButton
            :identity="!compactAccount"
            :only-avatar="compactAccount"
            :show-menu-identity="compactAccount"
            :class="compactAccount ? 'p-2 size-12' : ''"
            dropdown-side="bottom"
          />
        </div>
        <Component :is="useSlots('header-end')" />
      </div>
    </header>
  </Transition>
</template>

<style scoped>
[data-app-layout-center-scope="outer"][data-app-layout-center] {
  header {
    width: var(--g-app-layout-center-width);
    max-width: 100%;
    padding-right: initial;
  }
}

header {
  position: fixed;
  top: var(--g-slots-layout-top-height);
  right: var(--scrollbar-width, 0);
  left: 0;
  z-index: 1020;
  display: flex;
  align-items: center;
  width: calc(100% - var(--scrollbar-width, 0px));
  height: var(--g-header-height);
  margin: 0 auto;
  color: var(--g-header-color);
  background-color: var(--g-header-bg);
  box-shadow: inset 0 -1px 0 0 oklch(var(--border));
  transition: width 0.3s, background-color 0.15s, box-shadow 0.15s;

  .header-container {
    display: flex;
    gap: 30px;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    max-width: var(--g-header-width);
    height: 100%;
    padding: 0 12px;
    margin: 0 auto;

    :deep(a.title) {
      position: relative;
      flex: 0;
      width: inherit;
      height: inherit;
      padding: 0;
      background-color: inherit;

      .logo {
        width: initial;
        max-width: initial;
        height: min(70%, 50px);
      }

      span {
        font-size: 20px;
        color: var(--g-header-color);
        letter-spacing: 1px;
      }
    }

    .menu-container {
      .menu-active {
        &-arrow {
          .item-container::before,
          :deep(.menu-item::before) {
            position: absolute;
            bottom: 0;
            left: 50%;
            z-index: 1;
            width: 0;
            height: 0;
            content: "";
            border-right: 5px solid transparent;
            border-bottom: 5px solid var(--g-header-bg);
            border-left: 5px solid transparent;
            opacity: 0;
            transform: translateX(-50%);
            transition: all 0.15s;
          }

          .item-container.active::before,
          :deep(.menu-item.active::before) {
            bottom: 8px;
            opacity: 1;
          }
        }

        &-line {
          .item-container::before,
          :deep(.menu-item::before) {
            position: absolute;
            bottom: 6px;
            left: 50%;
            z-index: 1;
            width: 0;
            height: 4px;
            content: "";
            background-color: var(--g-header-menu-active-bg);
            border-radius: 2px;
            box-shadow: 0 0 0 1px var(--g-header-bg);
            opacity: 0;
            transform: translateX(-50%);
            transition: all 0.15s;
          }

          .item-container.active::before,
          :deep(.menu-item.active::before) {
            width: 20px;
            opacity: 1;
          }
        }

        &-dot {
          .item-container::before,
          :deep(.menu-item::before) {
            position: absolute;
            bottom: 0;
            left: 50%;
            z-index: 1;
            width: 10px;
            height: 10px;
            content: "";
            background-color: var(--g-header-menu-active-bg);
            border-radius: 50%;
            box-shadow: 0 0 0 1px var(--g-main-sidebar-bg);
            opacity: 0;
            transform: translateX(-50%);
            transition: all 0.15s;
          }

          .item-container.active::before,
          :deep(.menu-item.active::before) {
            bottom: 4px;
            opacity: 1;
          }
        }
      }

      .menu {
        display: inline-flex;

        :deep(.menu-item) {
          .menu-item-container {
            color: var(--g-header-menu-color);

            &:hover {
              color: var(--g-header-menu-hover-color);
              background-color: var(--g-header-menu-hover-bg);
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
            color: var(--g-header-menu-active-color) !important;
            background-color: var(--g-header-menu-active-bg) !important;
          }
        }
      }
    }
  }
}

/* 头部动画 */
.header-enter-active,
.header-leave-active {
  transition: transform 0.3s;
}

.header-enter-from,
.header-leave-to {
  transform: translateY(calc(var(--g-header-height) * -1));
}
</style>
