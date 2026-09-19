import type { Ref } from 'vue'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'

export function containerFailure(error: unknown): {
  message: string
  fieldErrors: Record<string, string>
  unknownResult: boolean
  conflict: boolean
} {
  const candidate = error as {
    kind?: string
    status?: number
    body?: {
      message?: string
      fieldErrors?: Record<string, string[]>
    }
    message?: string
  }
  return {
    message: candidate?.body?.message ?? candidate?.message ?? '操作失败，请稍后重试',
    fieldErrors: Object.fromEntries(Object.entries(candidate?.body?.fieldErrors ?? {}).map(([key, values]) => [key, values[0] ?? '填写内容无效'])),
    unknownResult: candidate?.kind === 'network' || candidate?.status === undefined || candidate.status >= 500,
    conflict: candidate?.status === 409,
  }
}
/** 读取绑定页面查询和当前身份；取消后到达的旧响应也不能恢复旧身份的数据。 */
export function useContainerResource<T>(enabled: Readonly<Ref<boolean>>, epoch: Readonly<Ref<number>>, key: Readonly<Ref<unknown>>, load: (signal: AbortSignal) => Promise<T>) {
  const data = shallowRef<T | null>(null)
  const loading = ref(false)
  const error = ref('')
  let controller: AbortController | null = null
  async function reload() {
    controller?.abort()
    if (!enabled.value) {
      return
    }
    const request = new AbortController()
    controller = request
    const identity = epoch.value
    const current = () => controller === request && !request.signal.aborted && enabled.value && epoch.value === identity
    loading.value = true
    error.value = ''
    try {
      const result = await load(request.signal)
      if (current()) {
        data.value = result
      }
    }
    catch (failure) {
      if (current()) {
        data.value = null
        error.value = containerFailure(failure).message
      }
    }
    finally {
      if (current()) {
        loading.value = false
      }
    }
  }
  watch([enabled, epoch, key], () => {
    controller?.abort()
    data.value = null
    error.value = ''
    loading.value = false
    if (enabled.value) {
      void reload()
    }
  }, { immediate: true })
  onScopeDispose(() => controller?.abort())
  return { data, loading, error, reload }
}
