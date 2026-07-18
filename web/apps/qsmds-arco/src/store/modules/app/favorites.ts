import type { MenuRecordRaw } from '@fantastic-admin/types'
import type { RouteLocationNormalized } from 'vue-router'
import apiApp from '@/api/modules/app'
import { resolveRoutePath } from '@/utils'

interface FavoritesItem {
  fullPath: string
  title?: string | (() => string)
  icon?: string
}

export const useAppFavoritesStore = defineStore(
  'appFavorites',
  () => {
    const appAccountStore = useAppAccountStore()
    const appMenuStore = useAppMenuStore()

    const storageTo = ref<'local' | 'server'>('local')

    const list = ref<FavoritesItem[]>([])

    function hasChildren(item: MenuRecordRaw) {
      let flag = true
      if (item.children?.every(i => i.meta?.menu === false)) {
        flag = false
      }
      return flag
    }
    function getSourceListByMenus(arr: MenuRecordRaw[], basePath?: string) {
      const list: string[] = []
      arr.forEach((item) => {
        if (item.meta?.menu !== false) {
          if (item.children && hasChildren(item)) {
            list.push(...getSourceListByMenus(item.children, resolveRoutePath(basePath, item.path)))
          }
          else {
            list.push(item.path as string ?? resolveRoutePath(basePath, item.path))
          }
        }
      })
      return list
    }

    const flatSidebarMenu = computed(() => {
      const list: string[] = []
      appMenuStore.allMenus.forEach((item) => {
        list.push(...getSourceListByMenus(item.children))
      })
      return list
    })

    // 判断路由是否可添加进收藏夹
    function canAdd(fullPath: FavoritesItem['fullPath']) {
      return flatSidebarMenu.value.includes(fullPath)
    }
    // 判断路由是否已经添加进收藏夹
    function isAdd(fullPath: FavoritesItem['fullPath']) {
      return list.value.some(item => item.fullPath === fullPath)
    }
    // 新增收藏
    function add(route: RouteLocationNormalized) {
      const meta = route.matched.at(-1)?.meta
      const lastMetaIcon = route.matched?.findLast(item => item.meta.icon)?.meta?.icon
      if (!list.value.some(item => item.fullPath === route.fullPath)) {
        list.value.push({
          fullPath: route.fullPath,
          title: meta?.title,
          icon: meta?.icon
            ? (typeof meta.icon === 'string' ? meta.icon : meta.icon[0])
            : lastMetaIcon
              ? (typeof lastMetaIcon === 'string' ? lastMetaIcon : lastMetaIcon[0])
              : undefined,
        })
      }
      updateStorage()
    }
    // 删除收藏
    function remove(fullPath: FavoritesItem['fullPath']) {
      list.value = list.value.filter((item) => {
        return item.fullPath !== fullPath
      })
      updateStorage()
    }
    // 拖拽排序
    function sort(newIndex: number, oldIndex: number) {
      list.value.splice(newIndex, 0, list.value.splice(oldIndex, 1)[0])
      updateStorage()
    }
    // 更新 storage 数据
    async function updateStorage() {
      const userId = appAccountStore.userId
      if (userId === '') {
        return
      }
      if (storageTo.value === 'local') {
        const favoritesData = localStorage.has('favoritesData') ? JSON.parse(localStorage.getItem('favoritesData') as string) : {}
        favoritesData[userId] = list.value
        localStorage.setItem('favoritesData', JSON.stringify(favoritesData))
      }
      else if (storageTo.value === 'server') {
        await apiApp.favoritesEdit(JSON.stringify(list.value))
      }
    }
    // 根据 storage 数据复原当前帐号的标签页
    async function recoveryStorage() {
      const userId = appAccountStore.userId
      if (userId === '') {
        list.value = []
        return
      }
      if (storageTo.value === 'local') {
        if (localStorage.has('favoritesData')) {
          list.value = JSON.parse(localStorage.getItem('favoritesData') as string)[userId] || []
        }
      }
      else if (storageTo.value === 'server') {
        const res = await apiApp.favorites()
        list.value = JSON.parse(res.data.favorites || '[]')
      }
    }

    function clean() {
      list.value = []
    }

    return {
      list,
      canAdd,
      isAdd,
      add,
      remove,
      sort,
      recoveryStorage,
      clean,
    }
  },
)
