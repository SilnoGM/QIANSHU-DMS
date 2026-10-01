import type { RouteRecordMainRaw } from '@fantastic-admin/types'
import type { RouteRecordRaw, RouterMatcher } from 'vue-router'
import { cloneDeep } from 'es-toolkit'
import { createRouterMatcher } from 'vue-router'
import apiApp from '@/api/modules/app'
import { systemRoutes as systemRoutesRaw } from '@/router/routes'
import { buildRegisteredRoutes, deleteMiddleRouteComponent } from './route.logic'

export const useAppRouteStore = defineStore(
  'appRoute',
  () => {
    const appSettingsStore = useAppSettingsStore()
    const appTabbarStore = useAppTabbarStore()

    const isGenerate = ref(false)
    // 原始路由
    const routesRaw = ref<RouteRecordMainRaw[]>([])
    // 已注册的路由，用于登出时删除路由
    const currentRemoveRoutes = ref<(() => void)[]>([])

    // 实际路由
    const routes = computed(() => buildRegisteredRoutes(routesRaw.value))

    // 系统路由
    const systemRoutes = computed(() => {
      const routes = [...systemRoutesRaw]
      routes.forEach((item) => {
        if (item.children) {
          item.children = deleteMiddleRouteComponent(item.children)
        }
      })
      return routes
    })

    // 路由匹配器
    const routesMatcher = ref<RouterMatcher>()
    // 根据路径获取匹配的路由
    function getRouteMatchedByPath(path: string) {
      return routesMatcher.value?.resolve({ path }, undefined!)?.matched ?? []
    }

    // 路由排序，sort 越大越靠前
    function sortAsyncRoutes<T extends RouteRecordMainRaw[] | RouteRecordRaw[]>(routes: T): T {
      routes.sort((a, b) => (b.meta?.sort ?? 0) - (a.meta?.sort ?? 0))
      routes.forEach((route) => {
        if (route.children) {
          route.children = sortAsyncRoutes(route.children)
        }
      })
      return routes
    }

    // 将设置 meta.singleMenu 的一级路由转换成二级路由
    function convertSingleRoutes<T extends RouteRecordMainRaw[]>(routes: T): T {
      routes.map((route) => {
        if (route.children) {
          route.children.forEach((item, index, arr) => {
            if (item.meta?.singleMenu) {
              arr[index] = {
                ...item,
                component: () => import('@/layouts/index.vue'),
                children: [
                  {
                    path: '',
                    name: item.name,
                    component: item.component,
                    meta: {
                      title: item.meta.title,
                      menu: false,
                      breadcrumb: false,
                    },
                  },
                ],
              } as RouteRecordRaw
              delete arr[index].name
              delete arr[index].meta!.singleMenu
            }
          })
        }
        return route
      })
      return routes
    }

    // 生成路由（前端生成）
    function generateRoutesAtFront(asyncRoutes: RouteRecordMainRaw[]) {
      // 设置 routes 数据
      routesRaw.value = convertSingleRoutes(sortAsyncRoutes(cloneDeep(asyncRoutes) as any))
      // 创建路由匹配器
      const routes: RouteRecordRaw[] = []
      routesRaw.value.forEach((route) => {
        if (route.children) {
          routes.push(...route.children)
        }
      })
      routesMatcher.value = createRouterMatcher(routes, {})
      isGenerate.value = true
      // 加载常驻标签页
      if (appSettingsStore.settings.topbar.tabbar) {
        appTabbarStore.initPermanentTab()
      }
    }
    // 格式化后端路由数据
    function formatBackRoutes(routes: any, views = import.meta.glob('@/views/**/*.vue')): RouteRecordMainRaw[] {
      return routes.map((route: any) => {
        switch (route.component) {
          case 'Layout':
            route.component = () => import('@/layouts/index.vue')
            break
          default:
            if (route.component) {
              route.component = views[`/src/views/${route.component}`]
            }
            else {
              delete route.component
            }
        }
        if (route.children) {
          route.children = formatBackRoutes(route.children, views)
        }
        return route
      })
    }
    // 生成路由（后端获取）
    async function generateRoutesAtBack() {
      await apiApp.routeList().then((res) => {
        // 设置 routes 数据
        routesRaw.value = convertSingleRoutes(sortAsyncRoutes(formatBackRoutes(res.data) as any))
        // 创建路由匹配器
        const routes: RouteRecordRaw[] = []
        routesRaw.value.forEach((route) => {
          if (route.children) {
            routes.push(...route.children)
          }
        })
        routesMatcher.value = createRouterMatcher(routes, {})
        isGenerate.value = true
        // 加载常驻标签页
        if (appSettingsStore.settings.topbar.tabbar) {
          appTabbarStore.initPermanentTab()
        }
      })
    }
    function setCurrentRemoveRoutes(routes: (() => void)[]) {
      currentRemoveRoutes.value = routes
    }
    // 清空动态路由
    function removeRoutes() {
      isGenerate.value = false
      routesRaw.value = []
      currentRemoveRoutes.value.forEach((removeRoute) => {
        removeRoute()
      })
      currentRemoveRoutes.value = []
    }

    return {
      isGenerate,
      routesRaw,
      currentRemoveRoutes,
      routes,
      systemRoutes,
      getRouteMatchedByPath,
      generateRoutesAtFront,
      generateRoutesAtBack,
      setCurrentRemoveRoutes,
      removeRoutes,
    }
  },
)
