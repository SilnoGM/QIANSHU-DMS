import type { Ref } from 'vue'
import { onScopeDispose, ref, watch } from 'vue'
import { containerFailure } from './use-container-resource'
/** 结果未知时保留原请求，人工重试沿用同一内容和 key，避免重复派号或装柜行。 */
export function useContainerMutation<T extends object, R>(enabled: Readonly<Ref<boolean>>, epoch: Readonly<Ref<number>>, send: (payload: T, key: string, signal: AbortSignal) => Promise<R>) {
  const submitting = ref(false)
  const retryOnly = ref(false)
  const error = ref('')
  const fieldErrors = ref<Record<string, string>>({})
  const conflict = ref(false)
  let pending: {
    payload: T
    key: string
  } | null = null
  let controller: AbortController | null = null
  function clear() {
    controller?.abort()
    pending = null
    submitting.value = false
    retryOnly.value = false
    error.value = ''
    fieldErrors.value = {}
    conflict.value = false
  }
  async function submit(payload: T): Promise<R | undefined> {
    if (!enabled.value || submitting.value) {
      return
    }
    pending ??= { payload: JSON.parse(JSON.stringify(payload)) as T, key: crypto.randomUUID() }
    const frozen = pending
    const request = new AbortController()
    controller = request
    const identity = epoch.value
    const current = () => !request.signal.aborted && enabled.value && epoch.value === identity
    submitting.value = true
    error.value = ''
    fieldErrors.value = {}
    conflict.value = false
    try {
      const result = await send(frozen.payload, frozen.key, request.signal)
      if (!current()) {
        return
      }
      pending = null
      retryOnly.value = false
      return result
    }
    catch (failure) {
      if (!current()) {
        return
      }
      const parsed = containerFailure(failure)
      error.value = parsed.message
      fieldErrors.value = parsed.fieldErrors
      conflict.value = parsed.conflict
      retryOnly.value = parsed.unknownResult
      if (!parsed.unknownResult) {
        pending = null
      }
    }
    finally {
      if (current()) {
        submitting.value = false
      }
    }
  }
  function resetFeedback() {
    if (retryOnly.value) {
      return
    }
    error.value = ''
    fieldErrors.value = {}
    conflict.value = false
  }
  watch(epoch, clear)
  // 同一身份离开页面只能停止接收响应，不能丢弃已发出的幂等请求。
  watch(enabled, (value) => {
    if (!value) {
      controller?.abort()
      submitting.value = false
      if (pending) {
        retryOnly.value = true
      }
    }
  })
  onScopeDispose(clear)
  return { submit, submitting, retryOnly, error, fieldErrors, conflict, resetFeedback }
}
