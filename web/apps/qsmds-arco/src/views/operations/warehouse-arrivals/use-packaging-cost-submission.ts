import type { Ref } from 'vue'
import type { PackagingCostDraft } from './packaging-cost.logic'
import type { PackagingCostRequestCreateDto, PackagingCostRequestDto } from '@/api/generated/types.gen'
import { onScopeDispose, ref, watch } from 'vue'
import packagingCostsApi from '../../../api/modules/packaging-costs'
import { isReceiptResultUnknown } from '../../workbenches/sales-receipts/submission.logic'
import { getPurchaseOrderApiFailure } from '../purchase-orders/purchase-order-list.logic'

export function usePackagingCostSubmission(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  shipmentId: Readonly<Ref<string>>,
  api: Pick<typeof packagingCostsApi, 'uploadImage' | 'submit'> = packagingCostsApi,
  createKey: () => string = () => crypto.randomUUID(),
) {
  const busy = ref(false)
  const error = ref('')
  const pending = ref(false)
  let controller: AbortController | null = null
  let uploaded = new WeakMap<File, string>()
  let frozen: { payload: PackagingCostRequestCreateDto, key: string } | null = null

  function reset() {
    controller?.abort()
    controller = null
    busy.value = false
    error.value = ''
    pending.value = false
    frozen = null
    uploaded = new WeakMap()
  }

  async function submit(draft?: PackagingCostDraft): Promise<PackagingCostRequestDto | null> {
    if (busy.value || !enabled.value || (!frozen && !draft)) {
      return null
    }
    const currentEpoch = epoch.value
    const id = shipmentId.value
    const request = new AbortController()
    controller = request
    const current = () => controller === request && !request.signal.aborted && enabled.value && epoch.value === currentEpoch && shipmentId.value === id
    busy.value = true
    error.value = ''
    try {
      if (!frozen && draft) {
        // 缓存已经成功上传的原 File，第二张失败时重试无需重复上传第一张。
        const mediaIds: string[] = []
        for (const file of [draft.packagingImages[0]!, draft.quotationImages[0]!]) {
          let mediaAssetId = uploaded.get(file)
          if (!mediaAssetId) {
            const result = await api.uploadImage(file, request.signal)
            if (!current()) {
              return null
            }
            mediaAssetId = result.data.mediaAssetId
            uploaded.set(file, mediaAssetId)
          }
          mediaIds.push(mediaAssetId)
        }
        frozen = {
          key: createKey(),
          payload: Object.freeze({ shipmentId: id, packagingType: draft.packagingTypeValue, packagingVendor: draft.vendor, amount: draft.amount, packagingImageMediaAssetId: mediaIds[0]!, quotationImageMediaAssetId: mediaIds[1]!, ...(draft.remark ? { remark: draft.remark } : {}) }),
        }
      }
      const result = await api.submit(frozen!.payload, frozen!.key, request.signal)
      if (!current()) {
        return null
      }
      frozen = null
      pending.value = false
      return result.data
    }
    catch (failure) {
      if (current()) {
        error.value = getPurchaseOrderApiFailure(failure).message
        // 连接中断可能发生在服务端保存之后；冻结原快照，不能换键或修改金额再提交。
        pending.value = frozen !== null && isReceiptResultUnknown(failure)
        if (!pending.value) {
          frozen = null
        }
      }
      return null
    }
    finally {
      if (current()) {
        busy.value = false
      }
    }
  }
  watch([enabled, epoch, shipmentId], reset, { flush: 'sync' })
  onScopeDispose(reset)
  return { busy, error, pending, submit }
}
