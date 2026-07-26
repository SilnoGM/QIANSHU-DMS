export type QsToastId = number | string

export type QsToastType
  = | 'default'
    | 'error'
    | 'info'
    | 'loading'
    | 'success'
    | 'warning'

export type QsToastRole = 'alert' | 'status'

export interface QsToastAction {
  /**
   * 默认在动作执行后关闭提示；仅当操作结果仍需留在当前提示中时才关闭此行为。
   */
  closeOnClick?: boolean
  label: string
  onClick: () => void
}

export interface QsToastOptions {
  action?: QsToastAction
  closable?: boolean
  description?: string
  duration?: number
}

export interface QsToastContent {
  description?: string
  title: string
}

export type QsToastContentInput = QsToastContent | string

export type QsToastPromiseContent<T>
  = | QsToastContentInput
    | ((value: T) => QsToastContentInput)

export interface QsToastPromiseOptions<T> {
  error: QsToastPromiseContent<unknown>
  loading: QsToastContentInput
  success: QsToastPromiseContent<T>
}

export type QsToastTask<T> = (() => Promise<T>) | Promise<T>

export type QsToastShow = (
  title: string,
  options?: QsToastOptions,
) => QsToastId

export interface QsToastApi {
  dismiss: (id?: QsToastId) => void
  error: QsToastShow
  info: QsToastShow
  loading: QsToastShow
  promise: <T>(
    task: QsToastTask<T>,
    options: QsToastPromiseOptions<T>,
  ) => Promise<T>
  show: QsToastShow
  success: QsToastShow
  warning: QsToastShow
}

export interface QsToastViewProps {
  action?: QsToastAction
  closable?: boolean
  description?: string
  isPaused?: boolean
  title: string
  type: QsToastType
}
