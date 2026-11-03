import type { Ref } from 'vue'
import { onScopeDispose, ref, watch } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import { UPLOAD_POLICIES, validateUploadFile } from '@/utils/upload-policy'

export interface RechargeImageUploadResult { mediaAssetId: string }
export type RechargeImageUploadFile = (file: File, signal: AbortSignal) => Promise<RechargeImageUploadResult>

/**
 * 广告充值的图片上传（收款二维码 / 付款截图共用）：上传成功只保留媒体 id，
 * 预览用本地 object URL，不依赖对象键。切换申请、登出和销毁时中断并回收预览。
 */
export function useRechargeImageUpload(options: {
  readonly enabled: Readonly<Ref<boolean>>
  readonly locked: Readonly<Ref<boolean>>
  readonly resetKey?: Readonly<Ref<string>>
  readonly update: (id: string | null) => void
  readonly upload: RechargeImageUploadFile
  readonly urls?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
}) {
  const urls = options.urls ?? URL
  const uploading = ref(false)
  const previewUrl = ref<string | null>(null)
  const filename = ref('')
  const error = ref('')
  let controller: AbortController | null = null

  function clearPreview() {
    if (previewUrl.value) {
      urls.revokeObjectURL(previewUrl.value)
    }
    previewUrl.value = null
    filename.value = ''
  }

  function reset() {
    controller?.abort()
    controller = null
    uploading.value = false
    clearPreview()
    error.value = ''
    options.update(null)
  }

  function remove() {
    if (!options.locked.value && !uploading.value) {
      reset()
    }
  }

  async function upload(file: File) {
    if (!options.enabled.value || options.locked.value || uploading.value) {
      return
    }
    reset()
    if (validateUploadFile(file, UPLOAD_POLICIES.IMAGE_ONLY) !== null) {
      error.value = '广告充值只支持 jpg、png 或 webp 图片'
      return
    }
    const request = new AbortController()
    controller = request
    uploading.value = true
    const current = () => !request.signal.aborted && controller === request
    try {
      const response = await options.upload(file, request.signal)
      if (!current()) {
        return
      }
      options.update(response.mediaAssetId)
      previewUrl.value = urls.createObjectURL(file)
      filename.value = file.name
    }
    catch (failure) {
      if (current()) {
        error.value = getApiClientFailureMessage(failure, '图片上传失败，请稍后重试')
      }
    }
    finally {
      if (controller === request) {
        controller = null
        uploading.value = false
      }
    }
  }

  if (options.resetKey) {
    watch(options.resetKey, reset, { flush: 'sync' })
  }
  onScopeDispose(reset)

  return { uploading, previewUrl, filename, error, upload, remove, reset }
}
