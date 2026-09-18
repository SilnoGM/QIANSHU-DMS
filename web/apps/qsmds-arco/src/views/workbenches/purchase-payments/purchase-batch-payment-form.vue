<script setup lang="ts">
import type { PurchasePayableOrderDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { sumMoneyValues } from '@/components/base/MoneyInput/logic'
import PaymentRecipientDetails from '@/components/business/QsPaymentRecipientEditor/PaymentRecipientDetails.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import PurchaseBatchPaymentOrders from './purchase-batch-payment-orders.vue'
import PurchaseBatchPaymentVoucher from './purchase-batch-payment-voucher.vue'
import PurchasePaymentStatementAction from './purchase-payment-statement-action.vue'
import { canPayPurchasePayable } from './purchase-payments.logic'

const props = defineProps<{
  supplierValue: string | null
  orders: PurchasePayableOrderDto[]
  suppliers: { value: string, label: string }[]
  suppliersLoading?: boolean
  loading: boolean
  error: string
  busy: boolean
  unknown: boolean
  stale: boolean
  enabled: boolean
}>()
const emit = defineEmits<{
  supplierChange: [value: string | null]
  submit: [input: { orders: PurchasePayableOrderDto[], recipientAccountId: string, recipientProfileVersion: number, paymentMethod: string, file: File }]
  retry: []
  retrySubmit: []
}>()
const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()
const selectedIds = ref<string[]>([])
const recipientAccountId = ref('')
const voucher = shallowRef<File | null>(null)
const statementGenerating = ref(false)
const fieldsLocked = computed(() => !props.enabled || props.busy || props.unknown || props.stale || statementGenerating.value)
const selectedOrders = computed(() => props.orders.filter(order => selectedIds.value.includes(order.id)))
const total = computed(() => sumMoneyValues(selectedOrders.value.flatMap(order => order.items.filter(canPayPurchasePayable).map(item => item.remainingAmount)), { precision: 2 }))
const profile = computed(() => {
  const candidate = selectedOrders.value[0]?.paymentRecipientProfile
  return candidate && selectedOrders.value.every(order => order.paymentRecipientProfile?.id === candidate.id && order.paymentRecipientProfile.version === candidate.version) ? candidate : null
})
const recipientOptions = computed(() => (profile.value?.accounts ?? []).map(account => ({ value: account.id, label: t(`purchasePayment.methods.${account.paymentMethod}`) })))
const recipient = computed(() => profile.value?.accounts.find(account => account.id === recipientAccountId.value) ?? null)
const canSubmit = computed(() => !fieldsLocked.value && !props.loading && selectedOrders.value.length > 0 && selectedOrders.value.every(order => order.items.some(canPayPurchasePayable)) && total.value !== '0.00' && recipient.value !== null && voucher.value !== null)

function resetSelection() {
  selectedIds.value = []
  recipientAccountId.value = ''
  voucher.value = null
}
function changeSupplier(value: unknown) {
  if (typeof value !== 'string' && value !== null) {
    return
  }
  if (fieldsLocked.value || props.supplierValue === value) {
    return
  }
  resetSelection()
  emit('supplierChange', value)
}
function selectOrders(ids: string[]) {
  if (!fieldsLocked.value && !props.loading) {
    selectedIds.value = ids
  }
}
function submit() {
  if (!canSubmit.value || !recipient.value || !profile.value || !voucher.value) {
    return
  }
  emit('submit', { orders: [...selectedOrders.value], recipientAccountId: recipient.value.id, recipientProfileVersion: profile.value.version, paymentMethod: recipient.value.paymentMethod, file: voucher.value })
}
watch(() => props.supplierValue, resetSelection, { flush: 'sync' })
watch(profile, () => {
  if (!props.busy && !props.unknown && !recipientOptions.value.some(option => option.value === recipientAccountId.value)) {
    recipientAccountId.value = ''
  }
})
watch(() => props.orders, () => {
  if (!props.busy && !props.unknown) {
    // 重新拉取后必须再次核对新金额；旧选择和凭证不能直接沿用。
    resetSelection()
  }
}, { flush: 'sync' })
watch(() => props.enabled, (enabled) => {
  if (!enabled) {
    resetSelection()
  }
}, { immediate: true, flush: 'sync' })
</script>

<template>
  <div class="grid min-w-0 xl:grid-cols-[minmax(0,4fr)_minmax(0,3fr)_minmax(0,3fr)] lg:grid-cols-2" :aria-busy="busy">
    <section :aria-label="t('purchasePayment.batch.orders')" class="p-5 gap-6 grid min-w-0 content-start lg:p-6">
      <h2 class="qs-type-component-title m-0 flex gap-2 items-center">
        <FaIcon name="i-lucide:clipboard-list" class="text-muted-foreground size-5" aria-hidden="true" />
        {{ t('purchasePayment.batch.orders') }}
      </h2>
      <div class="gap-3 grid">
        <label for="purchase-batch-supplier" class="qs-type-body-medium block">{{ t('purchasePayment.batch.supplier') }}</label>
        <div class="flex flex-wrap gap-3 min-w-0 items-center">
          <FaSelect id="purchase-batch-supplier" :model-value="supplierValue" :options="suppliers" :placeholder="t(suppliersLoading ? 'purchasePayment.batch.loadingSuppliers' : 'purchasePayment.batch.chooseSupplier')" :disabled="fieldsLocked || suppliersLoading" class="flex-1 min-w-40" @update:model-value="changeSupplier" />
          <PurchasePaymentStatementAction :orders="selectedOrders" :supplier-name="suppliers.find(item => item.value === supplierValue)?.label ?? ''" :enabled="enabled && !busy && !unknown && !stale && !loading" @busy-change="statementGenerating = $event" />
        </div>
        <p v-if="!suppliersLoading && !suppliers.length" class="qs-type-meta text-muted-foreground m-0">
          {{ t('purchasePayment.batch.noSuppliers') }}
        </p>
      </div>
      <div v-if="loading" role="status" class="text-muted-foreground py-16 flex gap-2 items-center justify-center" aria-live="polite">
        <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ t('purchasePayment.batch.loading') }}
      </div>
      <FaEmpty v-else-if="!supplierValue" icon="i-lucide:building-2" :title="t('purchasePayment.batch.chooseSupplierFirst')" :description="t('purchasePayment.batch.chooseSupplierHint')" />
      <FaEmpty v-else-if="!orders.length && !error" icon="i-lucide:circle-check" :title="t('purchasePayment.batch.empty')" :description="t('purchasePayment.batch.emptyHint')" />
      <PurchaseBatchPaymentOrders v-else-if="orders.length" :orders="orders" :selected="selectedIds" :disabled="fieldsLocked || loading" class="xl:pr-1 xl:max-h-[calc(100dvh-22rem)] xl:overflow-y-auto" @select="selectOrders" />
      <FaAlert v-if="error && !orders.length" variant="destructive" :title="t('purchasePayment.batch.failed')" :description="error" />
      <FaButton v-if="error && !orders.length && !unknown && !stale" type="button" variant="outline" :disabled="busy || loading || !enabled" @click="emit('retry')">
        {{ t('purchasePayment.batch.retry') }}
      </FaButton>
    </section>

    <section :aria-label="t('purchasePayment.recipientInformation')" class="p-5 border-t border-border gap-6 grid min-w-0 content-start lg:p-6 lg:border-l lg:border-t-0">
      <h2 class="qs-type-component-title m-0">
        {{ t('purchasePayment.recipientInformation') }}
      </h2>
      <div class="gap-3 grid">
        <label for="purchase-batch-method" class="qs-type-body-medium block">{{ t('purchasePayment.batch.paymentMethod') }} <span class="text-destructive">*</span></label>
        <FaSelect id="purchase-batch-method" v-model="recipientAccountId" :options="recipientOptions" :disabled="fieldsLocked || loading || !recipientOptions.length" :placeholder="t('purchasePayment.batch.chooseMethod')" class="w-full" />
        <p v-if="selectedOrders.length && !profile" role="alert" class="qs-type-meta text-destructive m-0">
          {{ t('purchasePayment.batch.profileMismatch') }}
        </p>
        <p v-else-if="selectedOrders.length && !recipientOptions.length" class="qs-type-meta text-muted-foreground m-0">
          {{ t('purchasePayment.batch.noRecipient') }}
        </p>
      </div>
      <PaymentRecipientDetails v-if="recipient" :account="recipient" class="purchase-batch-recipient min-w-0" :class="{ 'text-center': recipient.paymentMethod !== 'BANK_TRANSFER' }" />
      <p v-else class="qs-type-meta text-muted-foreground m-0">
        {{ t('purchasePayment.selectRecipientHint') }}
      </p>
    </section>

    <section :aria-label="t('purchasePayment.batch.summary')" class="p-5 border-t border-border bg-muted/20 flex flex-col gap-6 min-w-0 lg:p-6 xl:border-l xl:border-t-0 lg:col-span-2 xl:col-span-1">
      <h2 class="qs-type-component-title m-0">
        {{ t('purchasePayment.batch.summary') }}
      </h2>
      <div class="pb-5 border-b border-border gap-2 grid" aria-live="polite">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('purchasePayment.batch.selectedOrders', { count: selectedOrders.length }) }}
        </p>
        <h3 class="qs-type-body-medium m-0">
          {{ t('purchasePayment.batch.total') }}
        </h3>
        <div class="purchase-batch-total py-1 max-w-full overflow-x-auto">
          <AmountDisplay :value="total" currency="CNY" :currencies="currencyCatalog.currencies.value" />
        </div>
      </div>
      <div class="gap-3 grid">
        <p class="qs-type-body-medium m-0">
          {{ t('purchasePayment.batch.voucher') }} <span class="text-destructive">*</span>
        </p>
        <PurchaseBatchPaymentVoucher v-model="voucher" :disabled="fieldsLocked || loading || !selectedOrders.length" />
      </div>
      <FaAlert v-if="unknown" variant="destructive" :title="t('purchasePayment.batch.unknownTitle')" :description="error || t('purchasePayment.batch.unknown')" />
      <FaAlert v-if="stale" :title="t('purchasePayment.batch.staleTitle')" :description="t('purchasePayment.batch.stale')" />
      <FaAlert v-if="error && orders.length && !unknown && !stale" variant="destructive" :title="t('purchasePayment.batch.failed')" :description="error" />
      <footer class="mt-auto pt-2 gap-3 grid">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('purchasePayment.batch.confirmHint') }}
        </p>
        <FaButton v-if="unknown" type="button" :disabled="busy || !enabled" :loading="busy" class="min-h-11 w-full" @click="emit('retrySubmit')">
          {{ t('purchasePayment.batch.retrySubmit') }}
        </FaButton>
        <FaButton v-else-if="stale" type="button" variant="outline" :disabled="busy || loading || !enabled" class="min-h-11 w-full" @click="emit('retry')">
          {{ t('purchasePayment.batch.recheck') }}
        </FaButton>
        <FaButton v-else type="button" :disabled="!canSubmit" :loading="busy" class="min-h-11 w-full" @click="submit">
          {{ t('purchasePayment.batch.confirm') }}
        </FaButton>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.purchase-batch-total :deep([data-currency]) {
  font-size: var(--qs-type-size-3xl);
  font-weight: var(--qs-type-weight-semibold);
  line-height: var(--qs-type-leading-3xl);
}

.purchase-batch-recipient {
  --recipient-qr-width: 28rem;
}
</style>
