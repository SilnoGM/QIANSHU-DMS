import type { Ref } from 'vue'
import type { PackagingCostRequestDto, PackagingCostRequestPayDto } from '@/api/generated/types.gen'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import packagingCostsApi from '../../../api/modules/packaging-costs'
import { UPLOAD_POLICIES, validateUploadFile } from '../../../utils/upload-policy'
import { getPurchaseOrderMutationFailure } from '../../operations/purchase-orders/purchase-order-create.logic'
import { getPurchaseOrderApiFailure } from '../../operations/purchase-orders/purchase-order-list.logic'

export function usePackagingPayment(
  enabled: Readonly<Ref<boolean>>,
  canPay: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  requestId: Readonly<Ref<string | null>>,
  api: Pick<typeof packagingCostsApi, 'detail' | 'pay' | 'uploadVoucher'> = packagingCostsApi,
) {
  const detail = shallowRef<PackagingCostRequestDto | null>(null)
  const loading = ref(false)
  const busy = ref(false)
  const unknown = ref(false)
  const stale = ref(false)
  const loadError = ref('')
  const actionError = ref('')
  const recipientAccountId = ref<string | null>(null)
  const voucherFile = shallowRef<File | null>(null)
  const remark = ref('')
  const fieldError = ref<'recipient' | 'voucher' | 'remark' | null>(null)
  let controller: AbortController | null = null
  let payment: AbortController | null = null
  let attempt: PackagingCostRequestPayDto | null = null
  const recipient = computed(() => detail.value?.paymentRecipientProfile?.accounts.find(item => item.id === recipientAccountId.value && ['ALIPAY', 'WECHAT'].includes(item.paymentMethod)) ?? null)
  const eligible = computed(() => enabled.value && canPay.value && !loading.value && !loadError.value && !busy.value && !stale.value && detail.value?.status === 'PENDING_PAYMENT')
  const payable = computed(() => eligible.value && (unknown.value || (recipient.value !== null && voucherFile.value !== null)))

  function clearFields() {
    attempt = null
    recipientAccountId.value = null
    voucherFile.value = null
    remark.value = ''
    unknown.value = false
    stale.value = false
    actionError.value = ''
    fieldError.value = null
  }
  async function load() {
    // 未知结果必须保留原收款资料、凭证和版本，不能刷新后构造第二次财务请求。
    if (busy.value || unknown.value) {
      return
    }
    controller?.abort()
    clearFields()
    if (!enabled.value || !requestId.value) {
      detail.value = null
      loading.value = false
      return
    }
    const request = new AbortController()
    const id = requestId.value
    const requestEpoch = epoch.value
    controller = request
    loading.value = true
    loadError.value = ''
    const current = () => controller === request && !request.signal.aborted && enabled.value && requestId.value === id && epoch.value === requestEpoch
    try {
      const result = await api.detail(id, request.signal)
      if (current()) {
        detail.value = result.data
      }
    }
    catch (failure) {
      if (current()) {
        detail.value = null
        loadError.value = getPurchaseOrderApiFailure(failure).message
      }
    }
    finally {
      if (current()) {
        loading.value = false
      }
    }
  }

  async function confirm(): Promise<boolean> {
    if (!eligible.value || !detail.value) {
      return false
    }
    const record = detail.value
    const profile = record.paymentRecipientProfile
    const selected = recipient.value
    const file = voucherFile.value
    const paymentRemark = remark.value.trim()
    fieldError.value = null
    if (!attempt) {
      if (!profile || !selected || !selected.qrMediaAssetId) {
        fieldError.value = 'recipient'
        return false
      }
      if (!file || validateUploadFile(file, UPLOAD_POLICIES.IMAGE_ONLY) !== null) {
        fieldError.value = 'voucher'
        return false
      }
      if (Array.from(paymentRemark).length > 500) {
        fieldError.value = 'remark'
        return false
      }
    }
    const requestEpoch = epoch.value
    const request = new AbortController()
    payment = request
    busy.value = true
    actionError.value = ''
    let confirming = false
    const current = () => payment === request && !request.signal.aborted && enabled.value && canPay.value && epoch.value === requestEpoch && requestId.value === record.id
    try {
      if (!attempt && selected && profile && file && selected.paymentMethod !== 'BANK_TRANSFER') {
        const uploaded = await api.uploadVoucher(record.id, file, request.signal)
        if (!current()) {
          return false
        }
        attempt = { expectedVersion: record.version, recipientAccountId: selected.id, recipientProfileVersion: profile.version, paymentMethod: selected.paymentMethod, voucher: { mediaAssetId: uploaded.data.mediaAssetId }, remark: paymentRemark || null }
      }
      if (!current() || !attempt) {
        return false
      }
      confirming = true
      const result = await api.pay(record.id, attempt, request.signal)
      if (!current()) {
        return false
      }
      detail.value = result.data
      unknown.value = false
      attempt = null
      voucherFile.value = null
      return true
    }
    catch (failure) {
      if (current()) {
        const normalized = getPurchaseOrderMutationFailure(failure)
        actionError.value = normalized.message
        // 上传失败尚未记账；只有财务确认结果未知才冻结原请求并允许相同参数重试。
        unknown.value = confirming && normalized.unknownResult
        const status = typeof failure === 'object' && failure !== null && 'status' in failure ? failure.status : undefined
        stale.value = status === 409 || status === 404
        if (!unknown.value) {
          attempt = null
        }
      }
      return false
    }
    finally {
      if (payment === request) {
        busy.value = false
        payment = null
      }
    }
  }
  function reset() {
    controller?.abort()
    payment?.abort()
    controller = null
    payment = null
    detail.value = null
    loading.value = false
    busy.value = false
    loadError.value = ''
    clearFields()
  }
  watch([enabled, epoch, requestId], () => {
    reset()
    void load()
  }, { immediate: true, flush: 'sync' })
  watch(canPay, (value) => {
    if (!value) {
      payment?.abort()
      payment = null
      busy.value = false
      clearFields()
    }
  }, { flush: 'sync' })
  onScopeDispose(reset)
  return { detail, loading, busy, unknown, stale, loadError, actionError, recipientAccountId, recipient, voucherFile, remark, fieldError, payable, load, confirm }
}
