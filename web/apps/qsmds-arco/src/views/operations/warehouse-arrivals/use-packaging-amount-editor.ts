import type { Ref } from 'vue'
import type { PackagingCostRequestSummaryDto } from '@/api/generated/types.gen'
import Decimal from 'decimal.js'
import { computed, onScopeDispose, ref, watch } from 'vue'
import packagingCostsApi from '../../../api/modules/packaging-costs'
import { validateMoneyString } from '../../../components/base/MoneyInput/logic'
import { getPurchaseOrderApiFailure } from '../purchase-orders/purchase-order-list.logic'

export function usePackagingAmountEditor(
  records: Readonly<Ref<PackagingCostRequestSummaryDto[]>>,
  enabled: Readonly<Ref<boolean>>,
  epoch: Readonly<Ref<number>>,
  api: Pick<typeof packagingCostsApi, 'updateAmount'> = packagingCostsApi,
) {
  const selectedId = ref('')
  const selected = computed(() => records.value.find(record => record.id === selectedId.value))
  const editing = ref(false)
  const amount = ref<string | null>(null)
  const busy = ref(false)
  const error = ref('')
  const invalidAmount = ref(false)
  const needsReload = ref(false)
  let controller: AbortController | null = null
  const canEdit = computed(() => enabled.value && selected.value?.status === 'PENDING_PAYMENT' && Number.isInteger(selected.value.version) && selected.value.version >= 1 && !busy.value && !needsReload.value)

  function clear() {
    controller?.abort()
    controller = null
    busy.value = false
    editing.value = false
    amount.value = null
    error.value = ''
    invalidAmount.value = false
  }
  function start() {
    if (!canEdit.value || !selected.value) {
      return
    }
    amount.value = new Decimal(selected.value.amount).toFixed(2)
    editing.value = true
    invalidAmount.value = false
  }
  function cancel() {
    if (!busy.value) {
      clear()
    }
  }
  async function save(): Promise<PackagingCostRequestSummaryDto | null> {
    if (!editing.value || !canEdit.value || !selected.value) {
      return null
    }
    const checked = validateMoneyString(amount.value, { precision: 2, min: '0.01', max: '99999999999999999999999999.99' })
    invalidAmount.value = !checked.valid || !checked.normalizedValue
    if (invalidAmount.value || !checked.valid || !checked.normalizedValue) {
      return null
    }
    const record = selected.value
    const requestEpoch = epoch.value
    const request = new AbortController()
    controller = request
    busy.value = true
    error.value = ''
    const current = () => controller === request && !request.signal.aborted && enabled.value && epoch.value === requestEpoch && selected.value === record
    try {
      const response = await api.updateAmount(record.id, { amount: checked.normalizedValue, expectedVersion: record.version }, request.signal)
      if (!current()) {
        return null
      }
      editing.value = false
      // 等父级重新读取后才允许再次修改，避免沿用保存前的版本。
      needsReload.value = true
      return response.data
    }
    catch (failure) {
      if (current()) {
        error.value = getPurchaseOrderApiFailure(failure).message
        // 网络中断时服务端可能已保存；冲突时也需先读取最新付款状态与金额。
        needsReload.value = true
      }
      return null
    }
    finally {
      if (current()) {
        busy.value = false
      }
    }
  }
  watch([records, enabled, epoch], () => {
    clear()
    needsReload.value = false
    if (!records.value.some(record => record.id === selectedId.value)) {
      selectedId.value = records.value.find(record => record.status === 'PENDING_PAYMENT')?.id ?? records.value[0]?.id ?? ''
    }
  }, { immediate: true, flush: 'sync' })
  watch(selectedId, clear, { flush: 'sync' })
  onScopeDispose(clear)
  return { selectedId, selected, editing, amount, busy, error, invalidAmount, needsReload, canEdit, start, cancel, save }
}
