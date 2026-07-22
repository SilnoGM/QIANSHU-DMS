import { loadingFadeOut } from 'virtual:app-loading'
import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import pinia from '@/store'
import setupExtensions from './extensions'
import setupGuards from './guards'
import {
  AppFontLoadingError,
  finishInitialAppLoading,
  waitForRequiredAppFonts,
} from './loading'
// 路由相关数据
import { constantRoutes } from './routes'

const router = createRouter({
  history: useAppSettingsStore(pinia).settings.app.routeMode === 'hash' ? createWebHashHistory() : createWebHistory(),
  routes: constantRoutes,
  strict: true,
})

setupGuards(router)
setupExtensions(router)

const initialLoadingElement = document.querySelector<HTMLElement>('.qianshu-loading')
const requiredFontsReady = waitForRequiredAppFonts(document.fonts)

function fadeOutInitialLoading() {
  document.documentElement.dataset.appFontStatus = 'ready'
  loadingFadeOut()
}

function showInitialFontFailure(error: unknown) {
  const errorCode = error instanceof AppFontLoadingError
    ? error.code
    : 'FONT_LOAD_UNKNOWN'

  document.documentElement.dataset.appFontStatus = 'failed'

  if (initialLoadingElement) {
    initialLoadingElement.dataset.loadingState = 'font-error'
    initialLoadingElement.dataset.fontErrorCode = errorCode
    initialLoadingElement.setAttribute('aria-busy', 'false')
    initialLoadingElement.setAttribute('aria-live', 'assertive')
    initialLoadingElement.setAttribute('role', 'alert')

    const statusElement = initialLoadingElement.querySelector<HTMLElement>('.qianshu-loading__status')
    const retryButton = initialLoadingElement.querySelector<HTMLButtonElement>('.qianshu-loading__retry')

    if (statusElement) {
      statusElement.textContent = '字体资源加载失败，请刷新页面重试。'
    }
    if (retryButton) {
      retryButton.hidden = false
      retryButton.addEventListener('click', () => window.location.reload(), { once: true })
    }
  }

  // 原始错误只写入开发者控制台，页面仅展示稳定错误状态。
  console.error('[app-loading] Required fonts failed.', { code: errorCode, error })
}

// 字体等待在模块初始化时即开始，与路由并行；路由失败仍可退出，字体失败则保留诊断页。
void finishInitialAppLoading({
  routeReady: router.isReady(),
  fontsReady: requiredFontsReady,
  fadeOut: fadeOutInitialLoading,
  loadingElement: initialLoadingElement,
  showFontFailure: showInitialFontFailure,
})

export default router
