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

export interface PurchaseBatchPaymentLabels {
  verify: string
  upload: string
  submit: string
  retry: string
}

interface BatchStep { text: string, action: () => Promise<void> }
type BatchApi = Pick<typeof purchaseOrderPayablesApi, 'batchSuppliers' | 'batchOrders' | 'uploadVoucher' | 'payBatch'>
type BatchPhase = 'verify' | 'upload' | 'submit'

/** 提交前重读发现版本或金额已变化；与后端 409 共用「重新核对」提示。 */
class BatchStaleError extends Error {
  constructor() {
    super('PURCHASE_PAYABLE_STATE_CHANGED')
    this.name = 'BatchStaleError'
  }
}

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
  const steps = shallowRef<BatchStep[]>([])
  const result = shallowRef<PurchasePayableBatchResultDto | null>(null)
  const active = computed(() => enabled.value)
  let readController: AbortController | null = null
  let paymentController: AbortController | null = null
  let attempt: { key: string, body: PurchasePayableBatchPayDto } | null = null
  let phase: BatchPhase | null = null

  function reset() {
    readController?.abort()
    paymentController?.abort()
    readController = null
    paymentController = null
    attempt = null
    phase = null
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
    steps.value = []
    result.value = null
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

  /**
   * 提交前重读同一供应商的最新待付账单，只核对金额与版本，不回写列表状态：
   * 回写会触发列表重置，把用户已选好的收款方式和截图清空。
   */
  async function verify(ordersToPay: PurchasePayableOrderDto[], signal: AbortSignal) {
    const response = await api.batchOrders(supplier.value!, signal)
    const latest = new Map(response.data.items.map(order => [order.id, order]))
    for (const order of ordersToPay) {
      const current = latest.get(order.id)
      if (!current) {
        throw new BatchStaleError()
      }
      for (const item of order.items.filter(canPayPurchasePayable)) {
        const stage = current.items.find(candidate => candidate.id === item.id)
        if (!stage || stage.version !== item.version || stage.remainingAmount !== item.remainingAmount) {
          throw new BatchStaleError()
        }
      }
    }
  }

  /**
   * 启动三步流程；实际步骤由 FaMultiStepLoader 依次执行，这里只准备身份与闭包。
   * attempt 在全部准备完成前保持为空，失败后重试不会复用未完成的请求。
   */
  function start(input: PurchaseBatchPaymentInput, labels: PurchaseBatchPaymentLabels): boolean {
    if (!active.value || busy.value || loading.value || unknown.value || stale.value || completed.value) {
      return false
    }
    const items = selection(input)
    if (!items) {
      errorKey.value = 'purchasePayment.batch.invalidSelection'
      return false
    }
    const request = new AbortController()
    const requestEpoch = epoch.value
    const supplierValue = supplier.value!
    paymentController = request
    busy.value = true
    error.value = ''
    errorKey.value = ''
    result.value = null
    attempt = null
    phase = null
    const current = () => {
      if (paymentController !== request || request.signal.aborted || !active.value || epoch.value !== requestEpoch) {
        throw new DOMException('Batch payment aborted', 'AbortError')
      }
    }
    steps.value = [
      { text: labels.verify, action: async () => {
        phase = 'verify'
        await verify(input.orders, request.signal)
        current()
      } },
      { text: labels.upload, action: async () => {
        phase = 'upload'
        // 整批共用一张截图；上传时绑定本批第一个应付款，事务内允许本批其他阶段复用。
        const uploaded = await api.uploadVoucher(items[0]!.id, input.file, request.signal)
        current()
        attempt = { key: createKey(), body: { supplierValue, recipientAccountId: input.recipientAccountId, recipientProfileVersion: input.recipientProfileVersion, paymentMethod: input.paymentMethod, items: items.map(item => ({ payableId: item.id, expectedVersion: item.version, voucher: { mediaAssetId: uploaded.data.mediaAssetId } })) } }
      } },
      { text: labels.submit, action: async () => {
        if (!attempt) {
          throw new BatchStaleError()
        }
        phase = 'submit'
        const response = await api.payBatch(attempt.body, attempt.key, request.signal)
        current()
        result.value = response.data
        completed.value = true
      } },
    ]
    return true
  }

  /** 结果未知时沿用原幂等键重发同一批；不重新核对也不再上传凭证。 */
  function retrySubmit(labels: Pick<PurchaseBatchPaymentLabels, 'retry'>): boolean {
    if (!active.value || busy.value || !unknown.value || !attempt) {
      return false
    }
    const request = new AbortController()
    const requestEpoch = epoch.value
    const body = attempt.body
    const key = attempt.key
    paymentController = request
    busy.value = true
    error.value = ''
    errorKey.value = ''
    phase = 'submit'
    const current = () => {
      if (paymentController !== request || request.signal.aborted || !active.value || epoch.value !== requestEpoch) {
        throw new DOMException('Batch payment aborted', 'AbortError')
      }
    }
    steps.value = [{ text: labels.retry, action: async () => {
      const response = await api.payBatch(body, key, request.signal)
      current()
      result.value = response.data
      completed.value = true
    } }]
    return true
  }

  /** 三步都成功后解除锁定并交出结果；页面负责提示与重新加载。 */
  function complete(): PurchasePayableBatchResultDto | null {
    if (!busy.value || !completed.value || !active.value) {
      return null
    }
    paymentController = null
    // 整批结果已经确定，未知与状态变化都不再阻塞后续重新加载。
    unknown.value = false
    stale.value = false
    busy.value = false
    steps.value = []
    return result.value
  }

  function fail(failure: unknown, _index: number): void {
    if (failure instanceof DOMException && failure.name === 'AbortError') {
      return
    }
    // reset 已经清理本次流程时，迟到错误不能再覆盖新一轮状态。
    if (!busy.value) {
      return
    }
    const normalized = getPurchaseOrderMutationFailure(failure)
    const status = typeof failure === 'object' && failure !== null && 'status' in failure ? (failure as { status?: number }).status : undefined
    if (failure instanceof BatchStaleError) {
      stale.value = true
      error.value = ''
    }
    else {
      error.value = normalized.message
      // 只有已经发出财务写入的提交阶段，失败才可能留下未知结果。
      unknown.value = phase === 'submit' && normalized.unknownResult
      stale.value = status === 409 || status === 404
    }
    if (!unknown.value) {
      attempt = null
    }
    completed.value = false
    phase = null
    paymentController = null
    busy.value = false
    steps.value = []
  }

  watch([enabled, epoch], () => {
    reset()
    if (enabled.value) {
      void read()
    }
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(reset)
  return { supplier, suppliers, orders, suppliersLoading, loading, busy, unknown, stale, completed, error, errorKey, steps, result, changeSupplier, reload, start, retrySubmit, complete, fail }
}
