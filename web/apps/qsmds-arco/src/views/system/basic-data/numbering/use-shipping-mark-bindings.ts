import type { ShippingMarkBindingDto, ShippingMarkRuleResolutionDto, ShippingMarkRuleSummaryDto } from '@/api/generated/types.gen'
import type { QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'
import api from '@/api/modules/shipping-mark-bindings'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { bindingErrorMessage, canApplyBindingResponse, classifyBindingSaveFailure, isBindableRule } from './shipping-mark-binding.logic'
/** 页面只持有配置上下文；列表、编辑恢复和 mutation 分别管理代次，互不覆盖。 */
export function useShippingMarkBindings() {
  const { t } = useI18n()
  const { auth } = useAppAuth()
  const account = useAppAccountStore()
  const toast = useQsToast()
  const canRead = computed(() => auth('purchase-shipping-marks:read'))
  const canWrite = computed(() => canRead.value && auth('purchase-shipping-marks:update'))
  const rows = ref<ShippingMarkBindingDto[]>([])
  const total = ref(0)
  const customRule = ref<ShippingMarkRuleResolutionDto | null>(null)
  const page = ref(1)
  const pageSize = ref(20)
  const search = ref('')
  const filters = ref<QsGenericTableFilterValues>({})
  const loading = ref(false)
  const error = ref('')
  const edit = ref<ShippingMarkBindingDto | null>(null)
  const selection = ref<ShippingMarkRuleSummaryDto | null>(null)
  const saving = ref(false)
  const refreshing = ref(false)
  const editError = ref('')
  const needsRefresh = ref(false)
  const discardVisible = ref(false)
  const dirty = computed(() => edit.value !== null && (needsRefresh.value || selection.value?.id !== edit.value.rule?.id))
  let pendingAction: (() => void) | undefined
  let cancelAction: (() => void) | undefined
  let listVersion = 0
  let editVersion = 0
  let listController: AbortController | undefined
  let editController: AbortController | undefined
  let disposed = false
  async function load() {
    listController?.abort()
    const request = listController = new AbortController()
    const version = ++listVersion
    const epoch = account.authEpoch
    if (!canRead.value || disposed) {
      return
    }
    const current = () => !disposed && canApplyBindingResponse({ aborted: request.signal.aborted, authorized: canRead.value, epoch, currentEpoch: account.authEpoch, version, currentVersion: listVersion })
    loading.value = true
    error.value = ''
    try {
      const bindingStatus = filters.value.bindingStatus
      const response = await api.list({ page: page.value, pageSize: pageSize.value, ...(search.value.trim() ? { keyword: search.value.trim() } : {}), ...(bindingStatus === 'BOUND' || bindingStatus === 'UNBOUND' ? { bindingStatus } : {}) }, request.signal)
      if (!current()) {
        return
      }
      rows.value = response.data.items
      total.value = response.data.total
      customRule.value = response.data.customRule
      if (page.value > 1 && rows.value.length === 0 && total.value > 0) {
        page.value = Math.ceil(total.value / pageSize.value)
        await load()
      }
    }
    catch (failure) {
      if (current()) {
        error.value = bindingErrorMessage(failure, t('shippingMarkBinding.loadFailed'))
        rows.value = []
        customRule.value = null
      }
    }
    finally {
      if (current()) {
        loading.value = false
      }
    }
  }
  function resetEdit() {
    editController?.abort()
    editVersion += 1
    edit.value = null
    selection.value = null
    editError.value = ''
    needsRefresh.value = false
    saving.value = false
    refreshing.value = false
  }
  function guarded(action: () => void, cancelled?: () => void) {
    if (saving.value || refreshing.value) {
      cancelled?.()
      return
    }
    if (dirty.value) {
      pendingAction = action
      cancelAction = cancelled
      discardVisible.value = true
    }
    else {
      action()
    }
  }
  function discard() {
    const action = pendingAction
    pendingAction = undefined
    cancelAction = undefined
    discardVisible.value = false
    resetEdit()
    action?.()
  }
  function cancelDiscard() {
    discardVisible.value = false
    pendingAction = undefined
    cancelAction?.()
    cancelAction = undefined
  }
  function startEdit(row: ShippingMarkBindingDto) {
    if (!canWrite.value || !row.supplierEnabled || edit.value?.supplierValue === row.supplierValue) {
      return
    }
    guarded(() => {
      resetEdit()
      edit.value = structuredClone(toRaw(row))
      selection.value = row.rule
    })
  }
  function cancelEdit() {
    guarded(resetEdit)
  }
  async function save() {
    const target = edit.value
    if (!canWrite.value || !target || saving.value || refreshing.value || needsRefresh.value) {
      return
    }
    if (!isBindableRule(selection.value)) {
      toast.warning(t('shippingMarkBinding.selectRequired'))
      return
    }
    const version = ++editVersion
    const epoch = account.authEpoch
    const current = () => !disposed && canWrite.value && epoch === account.authEpoch && version === editVersion && edit.value?.supplierValue === target.supplierValue
    saving.value = true
    editError.value = ''
    try {
      await api.save(target.supplierValue, { ruleId: selection.value!.id, expectedVersion: target.version })
      if (!current()) {
        return
      }
      resetEdit()
      toast.success(t('shippingMarkBinding.saved'))
      await load()
    }
    catch (failure) {
      if (!current()) {
        return
      }
      const kind = classifyBindingSaveFailure(failure)
      needsRefresh.value = kind !== 'editable'
      editError.value = kind === 'unknown'
        ? t('shippingMarkBinding.unknown')
        : kind === 'refresh' ? t('shippingMarkBinding.refreshRequired') : bindingErrorMessage(failure, t('shippingMarkBinding.saveFailed'))
    }
    finally {
      if (current()) {
        saving.value = false
      }
    }
  }
  async function refreshEdit() {
    const target = edit.value
    if (!target || !canWrite.value || saving.value || refreshing.value) {
      return
    }
    const request = editController = new AbortController()
    const version = ++editVersion
    const epoch = account.authEpoch
    const current = () => !disposed && canApplyBindingResponse({ aborted: request.signal.aborted, authorized: canWrite.value, epoch, currentEpoch: account.authEpoch, version, currentVersion: editVersion })
    refreshing.value = true
    try {
      // 关键词可匹配多行，逐页查找稳定值；不能拿第一条或同名供应商替代编辑目标。
      let result: ShippingMarkBindingDto | undefined
      let currentPage = 1
      while (current()) {
        const response = await api.list({ keyword: target.supplierValue, page: currentPage, pageSize: 100 }, request.signal)
        if (!current()) {
          return
        }
        result = response.data.items.find(row => row.supplierValue === target.supplierValue)
        if (result || currentPage * 100 >= response.data.total) {
          break
        }
        currentPage += 1
      }
      if (!current()) {
        return
      }
      if (!result) {
        editError.value = t('shippingMarkBinding.notFound')
        return
      }
      edit.value = result
      rows.value = rows.value.map(row => row.supplierValue === result!.supplierValue ? result! : row)
      needsRefresh.value = !result.supplierEnabled
      editError.value = result.supplierEnabled ? t('shippingMarkBinding.refreshed') : t('shippingMarkBinding.status.SUPPLIER_UNAVAILABLE')
      // 保留用户选择，读取最新版本不自动重放保存；仍需用户再次确认当前选择。
    }
    catch (failure) {
      if (current()) {
        editError.value = bindingErrorMessage(failure, t('shippingMarkBinding.loadFailed'))
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
  watch([() => account.authEpoch, canRead, canWrite], () => {
    listController?.abort()
    listVersion += 1
    cancelDiscard()
    resetEdit()
    rows.value = []
    total.value = 0
    customRule.value = null
    error.value = ''
    loading.value = false
    if (canRead.value) {
      void load()
    }
  }, { immediate: true })
  onBeforeRouteLeave(() => new Promise<boolean>(resolve => guarded(() => resolve(true), () => resolve(false))))
  // 路由缓存不等于页面仍可接受响应；离开时丢弃上下文，重新激活必须读取最新配置。
  function deactivate() {
    disposed = true
    listController?.abort()
    cancelDiscard()
    resetEdit()
  }
  onDeactivated(deactivate)
  onActivated(() => {
    disposed = false
    void load()
  })
  onBeforeUnmount(deactivate)
  return { canRead, canWrite, rows, total, customRule, page, pageSize, search, filters, loading, error, edit, selection, saving, refreshing, editError, needsRefresh, discardVisible, load, query, startEdit, cancelEdit, save, refreshEdit, discard, cancelDiscard }
}
