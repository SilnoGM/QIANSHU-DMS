import type { Ref } from 'vue'
import type { PurchasePayableBatchPayDto, PurchasePayableBatchResultDto, PurchasePayableOrderDto } from '../../../api/generated/types.gen'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import purchaseOrderPayablesApi from '../../../api/modules/purchase-order-payables'
import { getPurchaseOrderMutationFailure } from '../../operations/purchase-orders/purchase-order-create.logic'
import { canPayPurchasePayable } from './purchase-payments.logic'

export interface PurchaseBatchPaymentInput {
  orders: PurchasePayableOrderDto[]
  recipientAccountId: string
  recipientProfileVersion: number
  paymentMethod: string
  file: File
}

type BatchApi = Pick<typeof purchaseOrderPayablesApi, 'batchSuppliers' | 'batchOrders' | 'uploadVoucher' | 'payBatch'>

export function usePurchaseBatchPayment(
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  api: BatchApi = purchaseOrderPayablesApi,
  createKey: () => string = () => crypto.randomUUID(),
) {
  const supplier = ref<string | null>(null)
  const suppliers = shallowRef<{ value: string, label: string }[]>([])
  const orders = shallowRef<PurchasePayableOrderDto[]>([])
  const suppliersLoading = ref(false)
  const loading = ref(false)
  const busy = ref(false)
  const unknown = ref(false)
  const stale = ref(false)
  const completed = ref(false)
  const error = ref('')
  const errorKey = ref('')
  const active = computed(() => enabled.value)
  let readController: AbortController | null = null
  let paymentController: AbortController | null = null
  let attempt: { key: string, body: PurchasePayableBatchPayDto } | null = null

  function reset() {
    readController?.abort()
    paymentController?.abort()
    readController = null
    paymentController = null
    attempt = null
    supplier.value = null
    suppliers.value = []
    orders.value = []
    suppliersLoading.value = false
    loading.value = false
    busy.value = false
    unknown.value = false
    stale.value = false
    completed.value = false
    error.value = ''
    errorKey.value = ''
  }

  async function read() {
    readController?.abort()
    if (!active.value || busy.value || unknown.value) {
      return
    }
    const request = new AbortController()
    const requestEpoch = epoch.value
    const value = supplier.value
    readController = request
    loading.value = value !== null
    suppliersLoading.value = value === null
    error.value = ''
    errorKey.value = ''
    const current = () => readController === request && !request.signal.aborted && active.value && epoch.value === requestEpoch && supplier.value === value
    try {
      if (value === null) {
        const response = await api.batchSuppliers(request.signal)
        if (current()) {
          suppliers.value = response.data.items
        }
      }
      else {
        const response = await api.batchOrders(value, request.signal)
        if (current()) {
          orders.value = response.data.items
        }
      }
    }
    catch (failure) {
      if (current()) {
        error.value = getPurchaseOrderMutationFailure(failure).message
      }
    }
    finally {
      if (current()) {
        readController = null
        loading.value = false
        suppliersLoading.value = false
      }
    }
  }

  async function changeSupplier(value: string | null) {
    if (!active.value || busy.value || unknown.value || (value !== null && !suppliers.value.some(item => item.value === value))) {
      return
    }
    readController?.abort()
    supplier.value = value
    orders.value = []
    attempt = null
    stale.value = false
    completed.value = false
    await read()
  }
  async function reload() {
    if (!active.value || busy.value || unknown.value) {
      return
    }
    orders.value = []
    attempt = null
    stale.value = false
    completed.value = false
    await read()
  }

  function selection(input: PurchaseBatchPaymentInput) {
    const selected = orders.value.filter(order => input.orders.some(item => item.id === order.id))
    if (!supplier.value || selected.length === 0 || selected.length !== input.orders.length
      || !['image/jpeg', 'image/png', 'image/webp'].includes(input.file.type)
      || input.file.size === 0 || input.file.size > 10 * 1024 * 1024) {
      return null
    }
    const profile = selected[0]?.paymentRecipientProfile
    const recipient = profile?.accounts.find(account => account.id === input.recipientAccountId && account.paymentMethod === input.paymentMethod)
    if (!profile || !recipient || profile.version !== input.recipientProfileVersion
      || selected.some(order => order.paymentRecipientProfile?.id !== profile.id || order.paymentRecipientProfile.version !== profile.version || !order.items.some(canPayPurchasePayable))) {
      return null
    }
    return selected.flatMap(order => order.items.filter(canPayPurchasePayable)).sort((a, b) => a.id.localeCompare(b.id))
  }

  async function execute(input?: PurchaseBatchPaymentInput): Promise<PurchasePayableBatchResultDto | null> {
    if (!active.value || busy.value || loading.value || stale.value || completed.value) {
      return null
    }
    const items = attempt === null && input ? selection(input) : null
    if (attempt === null && (!input || !items)) {
      errorKey.value = 'purchasePayment.batch.invalidSelection'
      return null
    }
    const request = new AbortController()
    const requestEpoch = epoch.value
    paymentController = request
    busy.value = true
    error.value = ''
    errorKey.value = ''
    let confirming = false
    const current = () => paymentController === request && !request.signal.aborted && active.value && epoch.value === requestEpoch
    try {
      if (attempt === null && input && items) {
        const body: PurchasePayableBatchPayDto = {
          supplierValue: supplier.value!,
          recipientAccountId: input.recipientAccountId,
          recipientProfileVersion: input.recipientProfileVersion,
          paymentMethod: input.paymentMethod,
          items: [],
        }
        // 每份资产绑定对应应付款。所有上传结束前不写财务，失败遗留的临时资产由既有到期清理回收。
        for (const item of items) {
          const uploaded = await api.uploadVoucher(item.id, input.file, request.signal)
          if (!current()) {
            return null
          }
          body.items.push({ payableId: item.id, expectedVersion: item.version, voucher: { mediaAssetId: uploaded.data.mediaAssetId } })
        }
        attempt = { key: createKey(), body }
      }
      if (!current() || !attempt) {
        return null
      }
      confirming = true
      const response = await api.payBatch(attempt.body, attempt.key, request.signal)
      if (!current()) {
        return null
      }
      unknown.value = false
      completed.value = true
      return response.data
    }
    catch (failure) {
      if (current()) {
        const normalized = getPurchaseOrderMutationFailure(failure)
        error.value = normalized.message
        // 上传失败尚未发起财务写入；只有确认请求结果未知时才锁住原请求并允许幂等核对。
        unknown.value = confirming && normalized.unknownResult
        const status = typeof failure === 'object' && failure !== null && 'status' in failure ? failure.status : undefined
        stale.value = status === 409 || status === 404
        if (!unknown.value) {
          attempt = null
        }
      }
      return null
    }
    finally {
      if (paymentController === request) {
        paymentController = null
        busy.value = false
      }
    }
  }

  watch([enabled, epoch], () => {
    reset()
    if (enabled.value) {
      void read()
    }
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(reset)
  return { supplier, suppliers, orders, suppliersLoading, loading, busy, unknown, stale, error, errorKey, changeSupplier, reload, submit: (input: PurchaseBatchPaymentInput) => execute(input), retrySubmit: () => execute() }
}
