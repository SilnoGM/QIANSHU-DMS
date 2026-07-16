import { loadingFadeOut } from 'virtual:app-loading'
import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import pinia from '@/store'
import setupExtensions from './extensions'
import setupGuards from './guards'
import { finishAppLoadingAfterMinimumDuration } from './loading'
// 路由相关数据
import { constantRoutes } from './routes'

const router = createRouter({
  history: useAppSettingsStore(pinia).settings.app.routeMode === 'hash' ? createWebHashHistory() : createWebHistory(),
  routes: constantRoutes,
  strict: true,
})

setupGuards(router)
setupExtensions(router)

function finishInitialLoading() {
  const loadingElement = document.querySelector<HTMLElement>('.qianshu-loading')
  return finishAppLoadingAfterMinimumDuration(loadingElement, loadingFadeOut)
}

// 成功与失败共用同一退出路径：短加载补足至 1500ms，慢加载不追加等待，并始终解除遮罩。
router.isReady().then(finishInitialLoading, finishInitialLoading)

export default router
