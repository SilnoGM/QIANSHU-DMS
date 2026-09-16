import type { Ref } from 'vue'
import type { PurchasePayableOrderDto, PurchasePayablePayDto } from '../../../api/generated/types.gen'
import type { PurchasePayableSelection } from './purchase-payments.logic'
import { computed, onScopeDispose, ref, watch } from 'vue'
import purchaseOrderPayablesApi from '../../../api/modules/purchase-order-payables'
import { getPurchaseOrderMutationFailure } from '../../operations/purchase-orders/purchase-order-create.logic'
import { canPayPurchasePayable } from './purchase-payments.logic'

export function usePurchasePayablePayment(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  selection: Readonly<Ref<PurchasePayableSelection | null>>,
  api: Pick<typeof purchaseOrderPayablesApi, 'pay'> = purchaseOrderPayablesApi,
  createKey: () => string = () => crypto.randomUUID(),
) {
  const paymentMethod = ref<string | null>(null)
  const remark = ref('')
  const busy = ref(false)
  const unknown = ref(false)
  const stale = ref(false)
  const completed = ref(false)
  const error = ref('')
  const fieldError = ref<'paymentMethod' | 'remark' | null>(null)
  let controller: AbortController | null = null
  let attempt: { key: string, body: PurchasePayablePayDto } | null = null
  const canSubmit = computed(() => enabled.value && !busy.value && !stale.value && !completed.value && selection.value !== null && canPayPurchasePayable(selection.value.item))

  async function submit(): Promise<PurchasePayableOrderDto | null> {
    if (!canSubmit.value || selection.value === null) {
      return null
    }
    fieldError.value = null
    if (attempt === null) {
      const method = paymentMethod.value?.trim() ?? ''
      if (!method || Array.from(method).length > 64) {
        fieldError.value = 'paymentMethod'
        return null
      }
      if (Array.from(remark.value.trim()).length > 500) {
        fieldError.value = 'remark'
        return null
      }
      attempt = { key: createKey(), body: { expectedVersion: selection.value.item.version, paymentMethod: method, remark: remark.value.trim() || null } }
    }
    const record = selection.value
    const requestEpoch = epoch.value
    const request = new AbortController()
    controller = request
    busy.value = true
    error.value = ''
    const current = () => controller === request && !request.signal.aborted && enabled.value && epoch.value === requestEpoch && selection.value === record
    try {
      const response = await api.pay(record.item.id, attempt.body, attempt.key, request.signal)
      if (!current()) {
        return null
      }
      completed.value = true
      unknown.value = false
      return response.data
    }
    catch (failure) {
      if (current()) {
        const normalized = getPurchaseOrderMutationFailure(failure)
        error.value = normalized.message
        unknown.value = normalized.unknownResult
        const status = typeof failure === 'object' && failure !== null && 'status' in failure ? failure.status : undefined
        stale.value = status === 409 || status === 404
        // 未知结果必须继续复用同一输入与幂等键；确定未写入的错误才允许修改表单。
        if (!unknown.value) {
          attempt = null
        }
      }
      return null
    }
    finally {
      if (controller === request) {
        controller = null
        busy.value = false
      }
    }
  }

  function reset() {
    controller?.abort()
    controller = null
    attempt = null
    paymentMethod.value = null
    remark.value = ''
    busy.value = false
    unknown.value = false
    stale.value = false
    completed.value = false
    error.value = ''
    fieldError.value = null
  }
  watch([enabled, epoch, selection], reset, { flush: 'sync' })
  onScopeDispose(reset)
  return { paymentMethod, remark, busy, unknown, stale, error, fieldError, canSubmit, submit }
}
