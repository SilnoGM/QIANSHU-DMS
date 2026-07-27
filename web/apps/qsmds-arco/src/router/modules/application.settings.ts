import type { RouteRecordRaw } from 'vue-router'

/**
 * 应用配置页是登录后的正式功能入口，不复用悬浮齿轮的构建环境开关。
 * 配置变更仍只作用于当前运行时，用户需要复制结果并手动更新 src/settings.ts。
 */
const route: RouteRecordRaw = {
  path: '/system/application-settings',
  name: 'systemApplicationSettings',
  component: () => import('@/views/system/application-settings/index.vue'),
  meta: {
    title: '应用配置',
    icon: 'i-lucide:sliders-horizontal',
    singleMenu: true,
  },
}

export default route
