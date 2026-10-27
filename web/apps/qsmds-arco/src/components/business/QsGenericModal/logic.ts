export type QsGenericModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'
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
  /**
   * 错误卡片标题。读取失败与提交失败是两类不同问题，调用方需要能区分；
   * 缺省保持「加载失败」，兼容只做读取的既有弹窗。
   */
  errorTitle?: string
  fillHeight?: boolean
  loading?: boolean
  modelValue?: boolean
  size?: QsGenericModalSize
  submitting?: boolean
  title: string
  /**
   * 覆盖 FaModal 默认层级，仅用于弹窗从抽屉内打开、必须压住同页抽屉的场景。
   * 全站浮层默认同为 2000，平级时的绘制顺序由 Teleport 挂载顺序决定，
   * 与打开先后无关；调用方需要显式抬高时，弹窗内不能再放 FaSelect、
   * FaDropdown 等同样是 2000 的浮层，否则它们会掉到弹窗下面。
   */
  zIndex?: number
}

export const QS_GENERIC_MODAL_DEFAULT_SIZE: QsGenericModalSize = 'md'

export const QS_GENERIC_MODAL_DEFAULT_Z_INDEX = 2000

const SIZE_CLASSES: Record<QsGenericModalSize, string> = {
  'sm': 'sm:max-w-[30rem]',
  'md': 'sm:max-w-[35rem]',
  'lg': 'sm:max-w-[45rem]',
  'xl': 'sm:max-w-[56rem]',
  // 后两档给宽内容（横排算式、多列对照）用，按 +12rem 等步长延续既有梯度。
  '2xl': 'sm:max-w-[68rem]',
  '3xl': 'sm:max-w-[80rem]',
}

const BASE_CONTENT_CLASS = [
  'qs-generic-modal-panel w-full max-w-[calc(100%-1.5rem)] min-h-auto max-h-[calc(100dvh-1.5rem)]',
  'overflow-hidden rounded-xl border-border bg-background shadow-xl outline-none',
  'data-[state=open]:duration-220 data-[state=closed]:duration-180',
].join(' ')

/**
 * 尺寸类保持为静态字符串，确保 UnoCSS 在构建时生成全部档位样式。
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
