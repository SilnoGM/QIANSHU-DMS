import type { Ref } from 'vue'
import type { PaymentRecipientAccountInputDto, SupplierPaymentProfileDto } from '../../../api/modules/payment-recipients'
import { computed, onScopeDispose, ref, watch } from 'vue'
import api from '../../../api/modules/payment-recipients'
import { normalizePaymentRecipientAccounts, paymentRecipientErrorMessage, paymentRecipientSaveFailure, validatePaymentRecipientAccounts } from '../../../components/business/QsPaymentRecipientEditor/logic'

interface Api {
  list: (params: { page: number, pageSize: number, keyword?: string }, signal?: AbortSignal) => Promise<{ data: { items: SupplierPaymentProfileDto[], total: number } }>
  save: (value: string, data: { expectedVersion: number, accounts: PaymentRecipientAccountInputDto[] }, signal?: AbortSignal) => Promise<unknown>
}
export function useSupplierPaymentProfiles(canRead: Ref<boolean>, canWrite: Ref<boolean>, epoch: Ref<number>, client: Api = api, translate: (key: string) => string = key => key) {
  const rows = ref<SupplierPaymentProfileDto[]>([])
  const page = ref(1)
  const pageSize = ref(20)
  const total = ref(0)
  const search = ref('')
  const loading = ref(false)
  const error = ref('')
  const selected = ref<SupplierPaymentProfileDto | null>(null)
  const draft = ref<PaymentRecipientAccountInputDto[]>([])
  const saving = ref(false)
  const refreshing = ref(false)
  const editError = ref('')
  const needsRefresh = ref(false)
  let listRequest: AbortController | undefined
  let saveRequest: AbortController | undefined
  let refreshRequest: AbortController | undefined
  let disposed = false
  const dirty = computed(() => selected.value !== null && JSON.stringify(normalizePaymentRecipientAccounts(draft.value)) !== JSON.stringify(normalizePaymentRecipientAccounts(selected.value.accounts)))
  function resetEditor() {
    saveRequest?.abort()
    refreshRequest?.abort()
    saveRequest = undefined
    refreshRequest = undefined
    selected.value = null
    draft.value = []
    saving.value = false
    refreshing.value = false
    editError.value = ''
    needsRefresh.value = false
  }
  async function load() {
    listRequest?.abort()
    if (!canRead.value || disposed) {
      return
    }
    const request = listRequest = new AbortController()
    const identity = epoch.value
    const current = () => !disposed && !request.signal.aborted && canRead.value && epoch.value === identity
    loading.value = true
    error.value = ''
    try {
      const response = await client.list({ page: page.value, pageSize: pageSize.value, ...(search.value.trim() ? { keyword: search.value.trim() } : {}) }, request.signal)
      if (!current()) {
        return
      }
      rows.value = response.data.items
      total.value = response.data.total
      if (page.value > 1 && !rows.value.length && total.value) {
        page.value = Math.ceil(total.value / pageSize.value)
        await load()
      }
    }
    catch (failure) {
      if (current()) {
        error.value = paymentRecipientErrorMessage(failure, translate('supplierPaymentProfile.loadFailed'))
        rows.value = []
        total.value = 0
      }
    }
    finally {
      if (current()) {
        loading.value = false
      }
    }
  }
  function open(row: SupplierPaymentProfileDto) {
    if (!canRead.value || saving.value || selected.value) {
      return
    }
    selected.value = { ...row, accounts: row.accounts.map(account => ({ ...account })) }
    draft.value = normalizePaymentRecipientAccounts(row.accounts)
    editError.value = ''
    needsRefresh.value = false
  }
  async function save(): Promise<boolean> {
    const target = selected.value
    if (!target || !canWrite.value || !target.supplierEnabled || saving.value || refreshing.value || needsRefresh.value) {
      return false
    }
    const invalid = validatePaymentRecipientAccounts(draft.value)
    if (invalid) {
      editError.value = translate(invalid)
      return false
    }
    const request = saveRequest = new AbortController()
    const identity = epoch.value
    const current = () => !disposed && !request.signal.aborted && canWrite.value && identity === epoch.value && selected.value?.supplierValue === target.supplierValue
    saving.value = true
    editError.value = ''
    try {
      await client.save(target.supplierValue, { expectedVersion: target.version, accounts: normalizePaymentRecipientAccounts(draft.value) }, request.signal)
      if (!current()) {
        return false
      }
      resetEditor()
      await load()
      return true
    }
    catch (failure) {
      if (current()) {
        const kind = paymentRecipientSaveFailure(failure)
        needsRefresh.value = kind !== 'editable'
        editError.value = kind === 'unknown' ? translate('supplierPaymentProfile.unknown') : kind === 'refresh' ? translate('supplierPaymentProfile.conflict') : paymentRecipientErrorMessage(failure, translate('supplierPaymentProfile.saveFailed'))
      }
      return false
    }
    finally {
      if (current()) {
        saving.value = false
      }
    }
  }
  async function recheck() {
    const target = selected.value
    if (!target || saving.value || refreshing.value || !canRead.value) {
      return
    }
    refreshRequest?.abort()
    const request = refreshRequest = new AbortController()
    const identity = epoch.value
    const current = () => !disposed && !request.signal.aborted && canRead.value && epoch.value === identity && selected.value?.supplierValue === target.supplierValue
    refreshing.value = true
    try {
      let page = 1
      let found: SupplierPaymentProfileDto | undefined
      // 同名或前缀供应商不能替代目标，始终按字典 stable value 精确取回。
      while (current()) {
        const response = await client.list({ page, pageSize: 100, keyword: target.supplierValue }, request.signal)
        if (!current()) {
          return
        }
        found = response.data.items.find(item => item.supplierValue === target.supplierValue)
        if (found || page * 100 >= response.data.total) {
          break
        }
        page++
      }
      if (found && current()) {
        selected.value = found
        draft.value = normalizePaymentRecipientAccounts(found.accounts)
        rows.value = rows.value.map(row => row.supplierValue === found!.supplierValue ? found! : row)
        needsRefresh.value = !found.supplierEnabled
        editError.value = found.supplierEnabled ? '' : translate('supplierPaymentProfile.disabledHint')
      }
      else if (current()) {
        editError.value = translate('supplierPaymentProfile.notFound')
        needsRefresh.value = true
      }
    }
    catch (failure) {
      if (current()) {
        editError.value = paymentRecipientErrorMessage(failure, translate('supplierPaymentProfile.loadFailed'))
      }
    }
    finally {
      if (current()) {
        refreshing.value = false
      }
    }
  }
  function query() {
    page.value = 1
    void load()
  }
  function clear() {
    listRequest?.abort()
    resetEditor()
    rows.value = []
    total.value = 0
    error.value = ''
    loading.value = false
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
  return { rows, page, pageSize, total, search, loading, error, selected, draft, saving, refreshing, editError, needsRefresh, dirty, resetEditor, load, query, open, save, recheck, clear }
}
