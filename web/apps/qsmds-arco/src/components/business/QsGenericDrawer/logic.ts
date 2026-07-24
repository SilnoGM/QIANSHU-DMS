export type QsGenericDrawerSize = 'sm' | 'md' | 'lg' | 'xl'
export type QsGenericDrawerPlacement = 'right' | 'bottom'
export type QsGenericDrawerCloseReason
  = | 'close-button'
    | 'overlay'
    | 'escape'
    | 'programmatic'

export type QsGenericDrawerBeforeClose = (
  reason: QsGenericDrawerCloseReason,
) => boolean | Promise<boolean>

export interface QsGenericDrawerProps {
  beforeClose?: QsGenericDrawerBeforeClose
  closable?: boolean
  description?: string
  destroyOnClose?: boolean
  dismissOnEscape?: boolean
  dismissOnOverlay?: boolean
  error?: null | string
  loading?: boolean
  modelValue?: boolean
  placement?: QsGenericDrawerPlacement
  size?: QsGenericDrawerSize
  submitting?: boolean
  title: string
}

export const QS_GENERIC_DRAWER_DEFAULT_SIZE: QsGenericDrawerSize = 'md'

const RIGHT_SIZE_CLASSES: Record<QsGenericDrawerSize, string> = {
  sm: 'md:w-96',
  md: 'md:w-[30rem]',
  lg: 'md:w-[40rem]',
  xl: 'md:w-[48rem]',
}

const BASE_CONTENT_CLASS = [
  'qs-generic-drawer-panel max-w-none overflow-hidden border-border bg-background shadow-xl outline-none',
  'data-[state=open]:duration-220 data-[state=closed]:duration-180',
].join(' ')

/**
 * 所有尺寸类都保持为静态字符串，确保 UnoCSS 可以在构建期发现并生成样式。
 * 右侧抽屉在窄屏占满视口，达到 md 断点后才切换到业务尺寸。
 */
export function createGenericDrawerContentClass(
  size: QsGenericDrawerSize,
  placement: QsGenericDrawerPlacement,
): string {
  if (placement === 'bottom') {
    return [
      BASE_CONTENT_CLASS,
      'w-screen max-h-[calc(100dvh-1rem)] rounded-t-xl sm:max-w-none',
    ].join(' ')
  }

  return [
    BASE_CONTENT_CLASS,
    'w-screen rounded-none sm:max-w-none md:max-w-[calc(100vw-3rem)] md:rounded-l-xl',
    RIGHT_SIZE_CLASSES[size],
  ].join(' ')
}

/**
 * 关闭守卫异常时默认保持抽屉打开。异常展示由调用方在守卫内部处理，
 * 组件不擅自吞入业务错误文案，也不把异常暴露为未处理 Promise。
 */
export async function canCloseGenericDrawer(
  beforeClose: QsGenericDrawerBeforeClose | undefined,
  reason: QsGenericDrawerCloseReason,
): Promise<boolean> {
  if (!beforeClose) {
    return true
  }

  try {
    return await beforeClose(reason)
  }
  catch {
    return false
  }
}

const ESCAPE_REASON_WINDOW_MS = 200

/**
 * FaDrawer 会把遮罩与 Escape 都折叠为 close。包装层在捕获阶段记录 Escape，
 * 并只在一个很短的同步窗口内认定为键盘关闭，其余底层关闭视为遮罩关闭。
 */
export function resolveFaDrawerCloseReason(
  lastEscapeKeyAt: null | number,
  currentTime: number,
): Extract<QsGenericDrawerCloseReason, 'escape' | 'overlay'> {
  if (
    lastEscapeKeyAt !== null
    && currentTime - lastEscapeKeyAt >= 0
    && currentTime - lastEscapeKeyAt <= ESCAPE_REASON_WINDOW_MS
  ) {
    return 'escape'
  }

  return 'overlay'
}
