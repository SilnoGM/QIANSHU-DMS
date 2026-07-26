import type {
  QsToastApi,
  QsToastContent,
  QsToastContentInput,
  QsToastId,
  QsToastOptions,
  QsToastPromiseContent,
  QsToastPromiseOptions,
  QsToastTask,
  QsToastType,
} from './types'
import { useFaToast } from '@fantastic-admin/components'
import { markRaw } from 'vue'
import {
  isUsableQsToastId,
  resolveQsToastClosable,
  resolveQsToastDuration,
} from './config'
import QsToast from './index.vue'

const QS_TOAST_COMPONENT = markRaw(QsToast)

function normalizeContent(content: QsToastContentInput): QsToastContent {
  return typeof content === 'string'
    ? { title: content }
    : content
}

function resolvePromiseContentSafely<T>(
  content: QsToastPromiseContent<T>,
  value: T,
  fallbackTitle: string,
): QsToastContent {
  try {
    return resolvePromiseContent(content, value)
  }
  catch {
    // 文案解析器属于提示层，失败时不得改变原业务 Promise 的 resolve/reject 结果。
    return { title: fallbackTitle }
  }
}

function resolvePromiseContent<T>(
  content: QsToastPromiseContent<T>,
  value: T,
): QsToastContent {
  return normalizeContent(
    typeof content === 'function'
      ? content(value)
      : content,
  )
}

/**
 * QsToast 只借用 FaToast 的队列、计时、堆叠与手势能力。业务调用方不能传入
 * class、style、icon 或任意 Vue 组件，从入口上保持统一视觉契约。
 */
function showQsToast(
  type: QsToastType,
  title: string,
  options: QsToastOptions = {},
): QsToastId {
  const duration = resolveQsToastDuration(type, options.duration)
  const closable = resolveQsToastClosable(
    type,
    duration,
    options.closable,
  )

  return useFaToast().custom(QS_TOAST_COMPONENT, {
    componentProps: {
      action: options.action,
      closable,
      description: options.description,
      title,
      type,
    },
    dismissible: true,
    duration,
  })
}

/**
 * vue-sonner@2.0.9 不会为同 id 的 custom toast 重置剩余时长，因此异步完成后
 * 必须先关闭永久 loading，再创建结果提示。原任务的返回值与异常均保持不变，
 * 提示层不能吞掉业务失败。
 */
async function showQsToastPromise<T>(
  task: QsToastTask<T>,
  options: QsToastPromiseOptions<T>,
): Promise<T> {
  const loadingContent = normalizeContent(options.loading)
  const id = showQsToast('loading', loadingContent.title, {
    description: loadingContent.description,
  })

  let value: T
  try {
    value = await (typeof task === 'function' ? task() : task)
  }
  catch (error) {
    const errorContent = resolvePromiseContentSafely(
      options.error,
      error,
      '操作失败',
    )
    useFaToast().dismiss(id)
    showQsToast('error', errorContent.title, {
      description: errorContent.description,
    })
    throw error
  }

  const successContent = resolvePromiseContentSafely(
    options.success,
    value,
    '操作已完成',
  )
  useFaToast().dismiss(id)
  showQsToast('success', successContent.title, {
    description: successContent.description,
  })
  return value
}

export function useQsToast(): QsToastApi {
  return {
    dismiss: (id?: QsToastId) => {
      if (id === undefined) {
        useFaToast().dismiss()
      }
      else if (isUsableQsToastId(id)) {
        useFaToast().dismiss(id)
      }
    },
    error: (title, options) => showQsToast('error', title, options),
    info: (title, options) => showQsToast('info', title, options),
    loading: (title, options) => showQsToast('loading', title, options),
    promise: showQsToastPromise,
    show: (title, options) => showQsToast('default', title, options),
    success: (title, options) => showQsToast('success', title, options),
    warning: (title, options) => showQsToast('warning', title, options),
  }
}
