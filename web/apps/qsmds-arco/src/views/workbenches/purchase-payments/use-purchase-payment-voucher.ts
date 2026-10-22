import type { Ref } from 'vue'
import { onScopeDispose, ref, watch } from 'vue'
import purchaseOrderPayablesApi from '../../../api/modules/purchase-order-payables'
import { UPLOAD_POLICIES, validateUploadFile } from '../../../utils/upload-policy'
import { getPurchaseOrderMutationFailure } from '../../operations/purchase-orders/purchase-order-create.logic'

/** 每笔款项独立持有临时凭证；切款项、登出和销毁时中断上传并回收预览。 */
export function usePurchasePaymentVoucher(
  payableId: Readonly<Ref<string>>,
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  locked: Readonly<Ref<boolean>>,
  update: (id: string | null) => void,
  api: Pick<typeof purchaseOrderPayablesApi, 'uploadVoucher'> = purchaseOrderPayablesApi,
  urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
) {
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
    update(null)
  }
  function remove() {
    if (!locked.value && !uploading.value) {
      reset()
    }
  }
  async function upload(file: File) {
    if (!enabled.value || locked.value || uploading.value) {
      return
    }
    reset()
    if (validateUploadFile(file, UPLOAD_POLICIES.IMAGE_ONLY) !== null) {
      error.value = 'purchasePayment.imageOnly'
      return
    }
    const id = payableId.value
    const authEpoch = epoch.value
    const request = new AbortController()
    controller = request
    uploading.value = true
    const current = () => !request.signal.aborted && controller === request && enabled.value && epoch.value === authEpoch && payableId.value === id
    try {
      const response = await api.uploadVoucher(id, file, request.signal)
      if (!current()) {
        return
      }
      update(response.data.mediaAssetId)
      previewUrl.value = urls.createObjectURL(file)
      filename.value = file.name
    }
    catch (failure) {
      if (current()) {
        error.value = getPurchaseOrderMutationFailure(failure).message
      }
    }
    finally {
      if (controller === request) {
        controller = null
        uploading.value = false
      }
    }
  }
  watch([payableId, enabled, epoch], reset, { flush: 'sync' })
  onScopeDispose(reset)
  return { uploading, previewUrl, filename, error, upload, remove }
}
