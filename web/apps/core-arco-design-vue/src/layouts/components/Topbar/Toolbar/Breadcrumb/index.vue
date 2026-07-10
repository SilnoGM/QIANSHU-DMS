<script setup lang="ts">
import { compile } from 'path-to-regexp'
import Breadcrumb from '../../../Breadcrumb/index.vue'
import BreadcrumbItem from '../../../Breadcrumb/item.vue'

defineOptions({
  name: 'ToolbarBreadcrumb',
})

const route = useRoute()

const appSettingsStore = useAppSettingsStore()
const appMenuStore = useAppMenuStore()

const { generateI18nTitle } = useAppMenu()

interface breadcrumb {
  path: string
  title?: string | (() => string)
}

// 面包屑备份
let breadcrumbListBackup: breadcrumb[] = []
const breadcrumbList = computed<breadcrumb[]>(() => {
  // 如果是刷新页面，则返回备份的面包屑，效果相当于刷新页面时面包屑不闪烁
  if (route.name === 'reload') {
    return breadcrumbListBackup
  }
  const list = []
  // 是否展示主页
  if (appSettingsStore.settings.app.home.enable) {
    list.push({
      path: appSettingsStore.settings.app.home.fullPath,
      title: appSettingsStore.settings.app.home.title,
    })
  }
  // 是否展示主导航
  if (route.fullPath !== appSettingsStore.settings.app.home.fullPath && appSettingsStore.settings.toolbar.breadcrumb.mainMenu && !['single'].includes(appSettingsStore.settings.menu.mode)) {
    const index = appMenuStore.allMenus.findIndex(item => item.children.some(r => route.fullPath.indexOf(`${r.path}/`) === 0 || route.fullPath === r.path))
    appMenuStore.allMenus[index]?.meta && list.push({
      path: '',
      title: appMenuStore.allMenus[index].meta?.title,
    })
  }
  route.matched.forEach((item) => {
    if (item.meta?.breadcrumb !== false) {
      list.push({
        path: item.path,
        title: item.meta?.title,
      })
    }
  })
  const findItem = appSettingsStore.customTitleList.find(item => item.fullPath === route.fullPath)
  if (findItem) {
    const lastItem = list.at(-1)
    if (lastItem) {
      lastItem.title = findItem.title
    }
  }
  breadcrumbListBackup = list.filter(item => generateI18nTitle(item.title))
  return breadcrumbListBackup
})

function pathCompile(path: string) {
  const toPath = compile(path)
  return toPath(route.params)
}
</script>

<template>
  <Breadcrumb
    v-if="appSettingsStore.mode === 'pc'" class="breadcrumb px-2 whitespace-nowrap" :class="{
      [`breadcrumb-${appSettingsStore.settings.toolbar.breadcrumb.style}`]: appSettingsStore.settings.toolbar.breadcrumb.style !== '',
    }"
  >
    <TransitionGroup name="breadcrumb">
      <BreadcrumbItem v-for="(item, index) in breadcrumbList" :key="`${index}_${item.path}_${item.title}`" :to="index < breadcrumbList.length - 1 && item.path !== '' ? pathCompile(item.path) : ''">
        {{ generateI18nTitle(item.title) }}
      </BreadcrumbItem>
    </TransitionGroup>
  </Breadcrumb>
</template>

<style scoped>
.breadcrumb {
  &.breadcrumb-modern {
    :deep(.breadcrumb-item) {
      .text {
        --uno: bg-muted;

        padding: 6px 16px;
        clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%, 8px 50%);

        [dir="rtl"] & {
          clip-path: polygon(8px 0, 100% 0, calc(100% - 8px) 50%, 100% 100%, 8px 100%, 0 50%);
        }

        &.is-link:hover {
          --uno: bg-muted;
        }
      }

      &:first-child .text {
        padding-inline-start: 12px;
        border-radius: 6px 0 0 6px;
        clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%);

        [dir="rtl"] & {
          border-radius: 0 6px 6px 0;
          clip-path: polygon(8px 0, 100% 0, 100% 100%, 8px 100%, 0 50%);
        }
      }

      &:last-child:not(:first-child) .text {
        --uno: bg-muted;

        padding-inline-end: 12px;
        border-radius: 0 6px 6px 0;
        clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%, 8px 50%);

        [dir="rtl"] & {
          border-radius: 6px 0 0 6px;
          clip-path: polygon(0 0, 100% 0, calc(100% - 8px) 50%, 100% 100%, 0 100%);
        }
      }

      .separator {
        display: none;
      }
    }
  }
}

/* 面包屑动画 */
.breadcrumb-enter-active {
  transition: transform 0.3s, opacity 0.3s;
}

.breadcrumb-enter-from {
  opacity: 0;
  transform: translateX(30px) skewX(-50deg);
}
</style>
