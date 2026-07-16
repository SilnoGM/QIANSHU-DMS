import { loadingFadeOut } from 'virtual:app-loading'
import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import pinia from '@/store'
import setupExtensions from './extensions'
import setupGuards from './guards'
// 路由相关数据
import { constantRoutes } from './routes'

const router = createRouter({
  history: useAppSettingsStore(pinia).settings.app.routeMode === 'hash' ? createWebHashHistory() : createWebHistory(),
  routes: constantRoutes,
  strict: true,
})

setupGuards(router)
setupExtensions(router)

// Loading 只表达应用初始化状态；初始导航失败时也必须解除遮罩，避免错误页面被永久阻挡。
router.isReady().then(loadingFadeOut, loadingFadeOut)

export default router
