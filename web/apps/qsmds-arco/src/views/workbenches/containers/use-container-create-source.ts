import type { Ref } from 'vue'
import type { ContainerSourceFileDto } from '@/api/generated/types.gen'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { containerFailure } from './use-container-resource'

/** 创建前上传不派发柜次编号；关闭弹窗或切换身份后丢弃迟到响应。 */
export function useContainerCreateSource(
  enabled: Readonly<Ref<boolean>>,
  disabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  send: (file: File, signal: AbortSignal) => Promise<ContainerSourceFileDto>,
  translate: (key: string) => string,
) {
  const selectedFile = shallowRef<File | null>(null)
  const sourceFile = shallowRef<ContainerSourceFileDto | null>(null)
  const uploading = ref(false)
  const error = ref('')
  let controller: AbortController | null = null
  function reset() {
    controller?.abort()
    controller = null
    selectedFile.value = null
    sourceFile.value = null
    uploading.value = false
    error.value = ''
  }
  async function selectFile(file: File): Promise<false> {
    if (!enabled.value || disabled.value || uploading.value) {
      return false
    }
    if (!/\.xlsx$/iu.test(file.name) || file.size <= 0 || file.size > 50 * 1024 * 1024) {
      error.value = translate('containerSource.invalidFile')
      return false
    }
    reset()
    selectedFile.value = file
    const request = new AbortController()
    controller = request
    const identity = epoch.value
    const current = () => controller === request && !request.signal.aborted && enabled.value && epoch.value === identity
    uploading.value = true
    try {
      const uploaded = await send(file, request.signal)
      if (current()) {
        sourceFile.value = uploaded
      }
    }
    catch (failure) {
      if (current()) {
        error.value = containerFailure(failure).message
      }
    }
    finally {
      if (current()) {
        controller = null
        uploading.value = false
      }
    }
    // 由业务状态展示临时附件，阻止基础上传组件再次发送或维护异步文件列表。
    return false
  }
  async function retry() {
    if (selectedFile.value && !sourceFile.value) {
      await selectFile(selectedFile.value)
    }
  }
  function remove() {
    if (!disabled.value && !uploading.value) {
      reset()
    }
  }
  watch([enabled, epoch], reset, { flush: 'sync' })
  onScopeDispose(reset)
  return { selectedFile, sourceFile, uploading, error, selectFile, retry, remove }
}
