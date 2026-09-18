import type { Ref } from 'vue'
import type { PackagingPaymentProfileDto, PaymentRecipientAccountInputDto, PaymentRecipientMethod } from '../../../api/modules/payment-recipients'
import { computed, onScopeDispose, ref, watch } from 'vue'
import api from '../../../api/modules/payment-recipients'
import { normalizePaymentRecipientAccounts, paymentRecipientErrorMessage, paymentRecipientSaveFailure, validatePaymentRecipientAccounts } from '../../../components/business/QsPaymentRecipientEditor/logic'

export const PACKAGING_RECIPIENT_METHODS: PaymentRecipientMethod[] = ['ALIPAY', 'WECHAT']
interface Api {
  getPackagingProfile: (vendor: 'CHENGXIN', signal?: AbortSignal) => Promise<{ data: PackagingPaymentProfileDto }>
  savePackagingProfile: (vendor: 'CHENGXIN', data: { expectedVersion: number, accounts: PaymentRecipientAccountInputDto[] }, signal?: AbortSignal) => Promise<{ data: PackagingPaymentProfileDto }>
}
export function usePackagingPaymentProfile(canRead: Ref<boolean>, canWrite: Ref<boolean>, epoch: Ref<number>, client: Api = api, translate: (key: string) => string = key => key) {
  const profile = ref<PackagingPaymentProfileDto | null>(null)
  const draft = ref<PaymentRecipientAccountInputDto[]>([])
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')
  const needsRefresh = ref(false)
  let request: AbortController | undefined
  let disposed = false
  const dirty = computed(() => profile.value !== null && JSON.stringify(normalizePaymentRecipientAccounts(draft.value)) !== JSON.stringify(normalizePaymentRecipientAccounts(profile.value.accounts)))
  function clear() {
    request?.abort()
    request = undefined
    profile.value = null
    draft.value = []
    loading.value = false
    saving.value = false
    needsRefresh.value = false
    error.value = ''
  }
  function accept(value: PackagingPaymentProfileDto) {
    profile.value = value
    draft.value = normalizePaymentRecipientAccounts(value.accounts)
    needsRefresh.value = false
    error.value = ''
  }
  function discard() {
    if (profile.value && !loading.value && !saving.value) {
      draft.value = normalizePaymentRecipientAccounts(profile.value.accounts)
      error.value = ''
    }
  }
  async function load() {
    if (!canRead.value || disposed || saving.value) {
      return
    }
    request?.abort()
    const active = request = new AbortController()
    const identity = epoch.value
    const current = () => !disposed && !active.signal.aborted && canRead.value && epoch.value === identity
    loading.value = true
    error.value = ''
    try {
      const response = await client.getPackagingProfile('CHENGXIN', active.signal)
      if (current()) {
        accept(response.data)
      }
    }
    catch (failure) {
      if (current()) {
        error.value = paymentRecipientErrorMessage(failure, translate('packagingPaymentProfile.loadFailed'))
      }
    }
    finally {
      if (current()) {
        loading.value = false
      }
    }
  }
  async function save() {
    if (!profile.value || !canRead.value || !canWrite.value || disposed || loading.value || saving.value || needsRefresh.value) {
      return false
    }
    const invalid = validatePaymentRecipientAccounts(draft.value, 0, PACKAGING_RECIPIENT_METHODS)
    if (invalid) {
      error.value = translate(invalid)
      return false
    }
    request?.abort()
    const active = request = new AbortController()
    const identity = epoch.value
    const current = () => !disposed && !active.signal.aborted && canRead.value && canWrite.value && epoch.value === identity
    saving.value = true
    error.value = ''
    try {
      const response = await client.savePackagingProfile('CHENGXIN', { expectedVersion: profile.value.version, accounts: normalizePaymentRecipientAccounts(draft.value) }, active.signal)
      if (!current()) {
        return false
      }
      accept(response.data)
      return true
    }
    catch (failure) {
      if (current()) {
        const kind = paymentRecipientSaveFailure(failure)
        // 未知结果与版本冲突都必须重新核对服务端状态，防止重复保存旧版本。
        needsRefresh.value = kind !== 'editable'
        error.value = kind === 'unknown' ? translate('supplierPaymentProfile.unknown') : kind === 'refresh' ? translate('supplierPaymentProfile.conflict') : paymentRecipientErrorMessage(failure, translate('supplierPaymentProfile.saveFailed'))
      }
      return false
    }
    finally {
      if (current()) {
        saving.value = false
      }
    }
  }
  watch([canRead, canWrite, epoch], () => {
    clear()
    if (canRead.value) {
      void load()
    }
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => {
    disposed = true
    clear()
  })
  return { profile, draft, loading, saving, error, needsRefresh, dirty, load, save, discard, clear }
}
