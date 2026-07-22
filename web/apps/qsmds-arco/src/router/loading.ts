export const APP_LOADING_MINIMUM_DURATION_ANIMATION = 'qianshu-loading-minimum-duration'
export const APP_FONT_LOAD_TIMEOUT_MS = 5_000

export const REQUIRED_APP_FONTS = [
  {
    descriptor: '600 1em "Noto Sans SC"',
    sample: '千树数据管理系统正在准备工作台',
  },
  {
    descriptor: '400 1em "Noto Sans Mono"',
    sample: 'QSDMS-0123456789',
  },
] as const

export type AppFontLoadingErrorCode
  = | 'FONT_API_UNAVAILABLE'
    | 'FONT_CHECK_FAILED'
    | 'FONT_LOAD_FAILED'
    | 'FONT_LOAD_TIMEOUT'
    | 'FONT_NOT_REGISTERED'

export class AppFontLoadingError extends Error {
  readonly code: AppFontLoadingErrorCode
  readonly originalError?: unknown

  constructor(code: AppFontLoadingErrorCode, message: string, originalError?: unknown) {
    super(message)
    this.name = 'AppFontLoadingError'
    this.code = code
    this.originalError = originalError
  }
}

interface AppLoadingAnimation {
  readonly animationName?: string
  readonly finished: Promise<unknown>
}

interface AppLoadingElement {
  getAnimations: () => AppLoadingAnimation[]
}

interface AppFontFaceSet {
  check: (descriptor: string, sample: string) => boolean
  load: (descriptor: string, sample: string) => Promise<readonly unknown[]>
}

interface WaitForRequiredAppFontsOptions {
  cancelTimeout?: (handle: unknown) => void
  scheduleTimeout?: (
    callback: () => void,
    timeoutMs: number,
  ) => unknown
  timeoutMs?: number
}

interface FinishInitialAppLoadingOptions {
  fadeOut: () => void
  fontsReady: Promise<void>
  loadingElement: AppLoadingElement | null
  routeReady: Promise<unknown>
  showFontFailure: (error: unknown) => void
}

async function loadRequiredFont(
  fontSet: AppFontFaceSet,
  font: (typeof REQUIRED_APP_FONTS)[number],
) {
  let loadedFaces: readonly unknown[]

  try {
    loadedFaces = await fontSet.load(font.descriptor, font.sample)
  }
  catch (error) {
    throw new AppFontLoadingError(
      'FONT_LOAD_FAILED',
      `Required font load failed: ${font.descriptor}`,
      error,
    )
  }

  // FontFaceSet.check() 可能在字体未注册时因系统回退而返回 true，必须先验证非空结果。
  if (loadedFaces.length === 0) {
    throw new AppFontLoadingError(
      'FONT_NOT_REGISTERED',
      `Required font is not registered: ${font.descriptor}`,
    )
  }

  try {
    if (!fontSet.check(font.descriptor, font.sample)) {
      throw new AppFontLoadingError(
        'FONT_CHECK_FAILED',
        `Required font check failed: ${font.descriptor}`,
      )
    }
  }
  catch (error) {
    if (error instanceof AppFontLoadingError) {
      throw error
    }
    throw new AppFontLoadingError(
      'FONT_CHECK_FAILED',
      `Required font check failed: ${font.descriptor}`,
      error,
    )
  }
}

/**
 * 只等待首屏实际依赖的 Sans 与 Mono 样本，不使用 document.fonts.ready，
 * 避免被页面后续动态字体或非关键 unicode-range 分片拖住。
 */
export async function waitForRequiredAppFonts(
  fontSet: AppFontFaceSet | undefined,
  options: WaitForRequiredAppFontsOptions = {},
) {
  if (!fontSet) {
    throw new AppFontLoadingError(
      'FONT_API_UNAVAILABLE',
      'FontFaceSet API is unavailable.',
    )
  }

  const timeoutMs = options.timeoutMs ?? APP_FONT_LOAD_TIMEOUT_MS
  const scheduleTimeout = options.scheduleTimeout ?? globalThis.setTimeout
  const cancelTimeout = options.cancelTimeout ?? ((handle: unknown) => {
    // Node 测试和浏览器对定时器句柄的类型声明不同，运行时仅原样交还给 clearTimeout。
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
  })
  let timeoutHandle: unknown
  let timeoutScheduled = false

  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = scheduleTimeout(() => {
      reject(new AppFontLoadingError(
        'FONT_LOAD_TIMEOUT',
        `Required font load timed out after ${timeoutMs}ms.`,
      ))
    }, timeoutMs)
    timeoutScheduled = true
  })

  try {
    await Promise.race([
      Promise.all(REQUIRED_APP_FONTS.map(font => loadRequiredFont(fontSet, font))),
      timeout,
    ])
  }
  finally {
    if (timeoutScheduled) {
      cancelTimeout(timeoutHandle)
    }
  }
}

/**
 * 等待 Loading 根节点的最短展示动画完成后再开始淡出。
 * 动画已结束时不会出现在 getAnimations() 结果中，因此慢加载不会被额外追加 1500ms。
 */
export async function finishAppLoadingAfterMinimumDuration(
  loadingElement: AppLoadingElement | null,
  fadeOut: () => void,
) {
  try {
    const minimumDurationAnimation = loadingElement
      ?.getAnimations()
      .find(animation => animation.animationName === APP_LOADING_MINIMUM_DURATION_ANIMATION)

    if (minimumDurationAnimation) {
      await minimumDurationAnimation.finished
    }
  }
  catch {
    // DOM 被替换或动画被取消时 finished 会拒绝；此时仍须解除遮罩，避免阻塞应用。
  }

  fadeOut()
}

/**
 * 路由成功或失败都视为“已结束”；只有字体失败会转入显式错误终态。
 * 字体 Promise 的拒绝处理器会立即挂载，避免路由长时间 pending 时出现未处理拒绝。
 */
export async function finishInitialAppLoading({
  fadeOut,
  fontsReady,
  loadingElement,
  routeReady,
  showFontFailure,
}: FinishInitialAppLoadingOptions): Promise<'font-error' | 'ready'> {
  const routeSettled = routeReady.then(
    () => undefined,
    () => undefined,
  )

  try {
    await Promise.all([routeSettled, fontsReady])
  }
  catch (error) {
    showFontFailure(error)
    return 'font-error'
  }

  await finishAppLoadingAfterMinimumDuration(loadingElement, fadeOut)
  return 'ready'
}
