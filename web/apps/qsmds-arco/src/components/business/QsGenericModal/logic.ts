export type QsGenericModalSize = 'sm' | 'md' | 'lg' | 'xl'
export type QsGenericModalCloseReason
  = | 'close-button'
    | 'overlay'
    | 'escape'
    | 'programmatic'

export type QsGenericModalBeforeClose = (
  reason: QsGenericModalCloseReason,
) => boolean | Promise<boolean>

export interface QsGenericModalProps {
  beforeClose?: QsGenericModalBeforeClose
  closable?: boolean
  description?: string
  destroyOnClose?: boolean
  dismissOnEscape?: boolean
  dismissOnOverlay?: boolean
  error?: null | string
  loading?: boolean
  modelValue?: boolean
  size?: QsGenericModalSize
  submitting?: boolean
  title: string
}

export const QS_GENERIC_MODAL_DEFAULT_SIZE: QsGenericModalSize = 'md'

const SIZE_CLASSES: Record<QsGenericModalSize, string> = {
  sm: 'sm:max-w-[30rem]',
  md: 'sm:max-w-[35rem]',
  lg: 'sm:max-w-[45rem]',
  xl: 'sm:max-w-[56rem]',
}

const BASE_CONTENT_CLASS = [
  'qs-generic-modal-panel w-full max-w-[calc(100%-1.5rem)] min-h-auto max-h-[calc(100dvh-1.5rem)]',
  'overflow-hidden rounded-xl border-border bg-background shadow-xl outline-none',
  'data-[state=open]:duration-220 data-[state=closed]:duration-180',
].join(' ')

/**
 * 尺寸类保持为静态字符串，确保 UnoCSS 在构建时生成全部四档样式。
 * 窄屏宽度相对 fixed containing block 计算，统一保留 12px 视口边距；
 * 不使用 vw，避免运行中切换设备指标时布局视口单位晚一帧更新而产生横向溢出。
 * 桌面端再按业务内容密度限制最大宽度。
 */
export function createGenericModalContentClass(
  size: QsGenericModalSize,
): string {
  return [
    BASE_CONTENT_CLASS,
    SIZE_CLASSES[size],
  ].join(' ')
}

/**
 * 关闭守卫异常时保持模态框打开。错误展示仍由调用方负责，组件不把领域异常
 * 转换成固定文案，也不让拒绝的 Promise 变成未处理异常。
 */
export async function canCloseGenericModal(
  beforeClose: QsGenericModalBeforeClose | undefined,
  reason: QsGenericModalCloseReason,
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
 * FaModal 会把遮罩和 Escape 都折叠为 close。包装层在捕获阶段记录 Escape，
 * 并只在短暂同步窗口内认定为键盘关闭，其余底层关闭归为遮罩。
 */
export function resolveFaModalCloseReason(
  lastEscapeKeyAt: null | number,
  currentTime: number,
): Extract<QsGenericModalCloseReason, 'escape' | 'overlay'> {
  if (
    lastEscapeKeyAt !== null
    && currentTime - lastEscapeKeyAt >= 0
    && currentTime - lastEscapeKeyAt <= ESCAPE_REASON_WINDOW_MS
  ) {
    return 'escape'
  }

  return 'overlay'
}
