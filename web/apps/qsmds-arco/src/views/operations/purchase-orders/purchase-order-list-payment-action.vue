<script setup lang="ts">
import type { PurchaseOrderDetailDto, PurchaseOrderListItemDto, PurchasePayableOrderDto } from '@/api/generated/types.gen'
import purchaseOrderPayablesApi from '@/api/modules/purchase-order-payables'
import purchaseOrdersApi from '@/api/modules/purchase-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { buildPurchasePayableLinkText, canPayPurchasePayable } from '../../workbenches/purchase-payments/purchase-payments.logic'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ stale: [] }>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const router = useRouter()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const visible = ref(false)
const orderId = ref<string | null>(null)
const loadingOrderId = ref<string | null>(null)
const detail = shallowRef<PurchaseOrderDetailDto | null>(null)
const payableOrder = shallowRef<PurchasePayableOrderDto | null>(null)
const selectedId = ref<string>()
const copying = ref(false)
const error = ref<string | null>(null)
const canOpen = computed(() => props.active && auth('purchase-orders:read') && auth('purchase-orders:payment'))
const options = computed(() => [...(payableOrder.value?.items ?? [])]
  .sort((left, right) => Number(left.paymentType === 'BALANCE') - Number(right.paymentType === 'BALANCE'))
  .map(item => ({ value: item.id, label: t(`purchasePayment.types.${item.paymentType}`), disabled: !canPayPurchasePayable(item), item })))
const selected = computed(() => payableOrder.value?.items.find(item => item.id === selectedId.value) ?? null)
const canCopy = computed(() => canOpen.value && visible.value && !copying.value && loadingOrderId.value === null && !error.value && detail.value !== null && selected.value !== null && canPayPurchasePayable(selected.value))
let controller: AbortController | null = null
let attempt = 0

function reset(): void {
  attempt++
  controller?.abort()
  controller = null
  visible.value = false
  orderId.value = null
  loadingOrderId.value = null
  detail.value = null
  payableOrder.value = null
  selectedId.value = undefined
  copying.value = false
  error.value = null
}
function setVisible(value: boolean): void {
  if (!value && !copying.value) {
    reset()
  }
}
async function reload(): Promise<void> {
  if (!canOpen.value || !visible.value || !orderId.value || copying.value) {
    return
  }
  controller?.abort()
  const request = new AbortController()
  controller = request
  const id = orderId.value
  const epoch = account.authEpoch
  const current = () => controller === request && !request.signal.aborted && canOpen.value && visible.value && account.authEpoch === epoch
  loadingOrderId.value = id
  detail.value = null
  payableOrder.value = null
  selectedId.value = undefined
  error.value = null
  try {
    // 客户信息和分笔应付均重读正式接口，避免把列表中的总未付款误当成本笔金额。
    const [orderResponse, payableResponse] = await Promise.all([
      purchaseOrdersApi.getById(id, request.signal),
      purchaseOrderPayablesApi.getByOrder(id, request.signal),
    ])
    if (!current()) {
      return
    }
    if (orderResponse.data.orderStatus !== 'CONFIRMED') {
      error.value = t('purchaseOrderList.payment.unavailable')
      emit('stale')
      return
    }
    detail.value = orderResponse.data
    payableOrder.value = payableResponse.data
    if (!payableResponse.data.items.some(canPayPurchasePayable)) {
      emit('stale')
    }
  }
  catch (failure) {
    if (current() && !isPurchaseOrderAbortError(failure)) {
      error.value = getPurchaseOrderApiFailure(failure).message
    }
  }
  finally {
    if (controller === request) {
      request.abort()
      controller = null
      loadingOrderId.value = null
    }
  }
}
async function open(order: PurchaseOrderListItemDto): Promise<void> {
  if (!canOpen.value || copying.value || loadingOrderId.value !== null) {
    return
  }
  if (order.orderStatus !== 'CONFIRMED' || order.paymentStatus === 'PAID') {
    toast.warning(t('purchaseOrderList.payment.unavailable'))
    emit('stale')
    return
  }
  reset()
  orderId.value = order.id
  visible.value = true
  await reload()
}
async function copy(): Promise<void> {
  if (!canCopy.value || !detail.value || !selected.value) {
    return
  }
  const currentAttempt = ++attempt
  copying.value = true
  try {
    const href = router.resolve({ name: 'qsFinanceRealtimePurchasePayablePayment', params: { id: selected.value.id } }).href
    // 数据预先加载，点击时直接写剪贴板以保留用户手势；付款页仍会重新校验登录、权限及最新应付。
    await navigator.clipboard.writeText(buildPurchasePayableLinkText(detail.value, selected.value, href, window.location.href))
    if (attempt === currentAttempt && canOpen.value) {
      reset()
      toast.success(t('purchaseOrderList.payment.copied'))
    }
  }
  catch {
    if (attempt === currentAttempt && canOpen.value) {
      toast.error(t('purchasePayment.copyFailed'))
    }
  }
  finally {
    if (attempt === currentAttempt) {
      copying.value = false
    }
  }
}
watch(() => [props.active, account.authEpoch, canOpen.value] as const, reset, { flush: 'sync' })
onDeactivated(reset)
onBeforeUnmount(reset)
defineExpose({ open, loadingOrderId })
</script>

<template>
  <QsGenericModal :model-value="visible" :title="t('purchaseOrderList.payment.title')" :description="t('purchaseOrderList.payment.description')" size="lg" :loading="loadingOrderId !== null" :error="error" :submitting="copying" @update:model-value="setVisible">
    <template #header-leading>
      <FaIcon name="i-lucide:wallet" class="size-4" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" @click="reload">
        {{ t('purchasePayment.retry') }}
      </FaButton>
    </template>
    <div v-if="detail && payableOrder" class="gap-6 grid min-w-0">
      <dl class="m-0 p-4 border border-border rounded-lg bg-muted/20 gap-4 grid sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground mb-1.5">
            {{ t('purchaseOrderList.payment.customer') }}
          </dt>
          <dd class="qs-type-body-medium m-0 break-words">
            {{ detail.customerName || t(detail.purchaseType === 'STOCK' ? 'purchaseOrderList.payment.stockCustomer' : 'purchaseOrderList.payment.missingCustomer') }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground mb-1.5">
            {{ t('purchasePayment.orderNo') }}
          </dt>
          <dd class="qs-type-data m-0 break-all">
            {{ detail.orderNo }}
          </dd>
        </div>
      </dl>
      <!-- 自定义卡片仍保留可聚焦的 RadioGroupItem，由组件处理方向键与选中语义。 -->
      <FaRadioGroup v-model="selectedId" :options="options" :disabled="copying" :aria-label="t('purchaseOrderList.payment.chooseType')" class="gap-3 grid grid-cols-2 sm:gap-4" option-class="min-w-0 rounded-lg focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2" item-class="sr-only !block">
        <template #option="{ option, checked }">
          <div class="p-4 border rounded-lg flex flex-col gap-5 min-h-40 min-w-0 w-full sm:p-5" :class="checked ? 'border-primary bg-primary/5' : 'border-border bg-background'">
            <div class="flex gap-2 items-center justify-between">
              <span class="qs-type-component-title">{{ option.label }}</span>
              <FaIcon :name="checked ? 'i-lucide:circle-check' : 'i-lucide:circle'" class="shrink-0 size-5" :class="checked ? 'text-primary dark:text-emerald-300' : 'text-muted-foreground/50'" aria-hidden="true" />
            </div>
            <div class="gap-2 grid min-w-0">
              <span class="qs-type-meta text-muted-foreground">{{ t(option.disabled ? 'purchasePayment.dueAmount' : 'purchasePayment.remainingAmount') }}</span>
              <AmountDisplay :value="option.disabled ? option.item.dueAmount : option.item.remainingAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" class="text-sm text-left break-all justify-start sm:text-lg !whitespace-normal" />
            </div>
            <span class="qs-type-meta" :class="option.item.status === 'PAID' ? 'text-primary dark:text-emerald-300' : option.disabled ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300'">{{ t(`purchasePayment.status.${option.item.status}`) }}</span>
          </div>
        </template>
      </FaRadioGroup>
      <p class="qs-type-meta text-muted-foreground m-0">
        {{ t(options.some(option => !option.disabled) ? 'purchaseOrderList.payment.selectionHint' : 'purchaseOrderList.payment.unavailable') }}
      </p>
    </div>
    <template #footer>
      <div class="flex flex-wrap gap-3 justify-end">
        <FaButton type="button" variant="outline" :disabled="copying" @click="reset">
          {{ t('purchasePayment.cancel') }}
        </FaButton>
        <FaButton type="button" :disabled="!canCopy" :loading="copying" @click="copy">
          <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
          {{ t('purchaseOrderList.payment.copy') }}
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
