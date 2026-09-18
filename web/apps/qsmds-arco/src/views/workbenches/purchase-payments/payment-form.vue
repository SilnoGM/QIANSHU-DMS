<script setup lang="ts">
import type { PurchasePayableSelection } from './purchase-payments.logic'
import type { PurchasePayableDto, PurchasePayableOrderDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import PaymentRecipientDetails from '@/components/business/QsPaymentRecipientEditor/PaymentRecipientDetails.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import PaymentVoucherPreview from './payment-voucher-preview.vue'
import PaymentVoucherUpload from './payment-voucher-upload.vue'
import { canPayPurchasePayable } from './purchase-payments.logic'
import { usePurchasePayablePayment } from './use-purchase-payable-payment'

const props = defineProps<{ selection: PurchasePayableSelection, enabled: boolean, selectable: boolean }>()
const emit = defineEmits<{ changed: [order: PurchasePayableOrderDto], refresh: [], lockChange: [locked: boolean], select: [id: string] }>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const { recipientAccountId, recipient, voucherMediaAssetId, remark, busy, unknown, stale, error, fieldError, canSubmit, submit } = usePurchasePayablePayment(
  computed(() => props.enabled && auth('purchase-orders:payment')),
  computed(() => account.authEpoch),
  computed(() => props.selection),
)
const statusClasses: Record<PurchasePayableDto['status'], string> = {
  PENDING_PAYMENT: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  PAID: 'border-primary/35 bg-primary/10 text-primary dark:text-emerald-300',
  NO_PAYMENT: 'border-border bg-muted text-muted-foreground',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
}
const installments = computed(() => [...props.selection.order.items].sort((left, right) => Number(left.paymentType === 'BALANCE') - Number(right.paymentType === 'BALANCE')))
const payable = computed(() => canPayPurchasePayable(props.selection.item))
const uploading = ref(false)
const recipientOptions = computed(() => (props.selection.order.paymentRecipientProfile?.accounts ?? []).map(item => ({ value: item.id, label: t(`purchasePayment.methods.${item.paymentMethod}`) })))
const displayedRecipient = computed(() => payable.value ? recipient.value : props.selection.item.paymentReceipt?.recipient ?? null)
const fieldsLocked = computed(() => !props.enabled || busy.value || unknown.value || stale.value || uploading.value)

function selectInstallment(id: string) {
  // 仅订单链接允许切换；提交中及结果未知时必须保留当前款项和原付款请求。
  if (props.enabled && props.selectable && !busy.value && !unknown.value && !uploading.value && id !== props.selection.item.id) {
    emit('select', id)
  }
}
async function confirm() {
  if (uploading.value) {
    return
  }
  const updated = await submit()
  if (updated) {
    toast.success(t('purchasePayment.paySuccess'))
    emit('changed', updated)
  }
}
watch(() => busy.value || unknown.value || uploading.value, locked => emit('lockChange', locked), { immediate: true })
onBeforeUnmount(() => emit('lockChange', false))
</script>

<template>
  <div class="purchase-payment-layout grid min-w-0 xl:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,3fr)]">
    <section :aria-label="t('purchasePayment.orderInformation')" class="p-5 min-w-0 lg:p-6 sm:p-5">
      <header class="mb-6 space-y-2">
        <p class="qs-type-meta text-muted-foreground m-0 flex gap-2 items-center">
          <FaIcon name="i-lucide:clipboard-list" class="size-4" aria-hidden="true" />
          {{ t('purchasePayment.orderNo') }}
        </p>
        <h2 class="text-xl qs-type-data-emphasis leading-7 m-0 select-all break-all">
          {{ selection.order.orderNo }}
        </h2>
      </header>
      <dl class="m-0 gap-x-6 gap-y-5 grid grid-cols-2">
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground mb-1.5">
            {{ t('purchasePayment.supplier') }}
          </dt>
          <dd class="qs-type-body-medium m-0 break-words">
            {{ selection.order.supplierName }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground mb-1.5">
            {{ t('purchasePayment.orderDate') }}
          </dt>
          <dd class="qs-type-data m-0">
            <time :datetime="selection.order.orderDate">{{ selection.order.orderDate }}</time>
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground mb-1.5">
            {{ t('purchasePayment.purchaseType') }}
          </dt>
          <dd class="m-0">
            {{ t(`purchasePayment.purchaseTypes.${selection.order.purchaseType}`) }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground mb-1.5">
            {{ t('purchasePayment.salesOrderNo') }}
          </dt>
          <dd class="qs-type-data m-0 break-all">
            {{ selection.order.salesOrderNo || t('purchasePayment.noSalesSource') }}
          </dd>
        </div>
      </dl>
      <dl class="m-0 mt-6 pt-5 border-t border-border flex flex-wrap gap-x-4 gap-y-2 items-center justify-between">
        <dt class="qs-type-meta text-muted-foreground">
          {{ t('purchasePayment.owner') }}
        </dt>
        <dd class="m-0 max-w-full min-w-0">
          <span v-if="selection.order.accountOwnerType === 'COMPANY'" class="flex gap-2 items-center">
            <FaIcon name="i-lucide:building-2" class="text-muted-foreground size-4" aria-hidden="true" />{{ t('purchasePayment.companyAccount') }}
          </span>
          <QsPersonDisplay v-else-if="selection.order.owner" :display-name="selection.order.owner.name" size="sm" />
          <span v-else class="text-muted-foreground">{{ t('purchasePayment.ownerUnavailable') }}</span>
        </dd>
      </dl>
      <section :aria-label="t('purchasePayment.installments')" class="mt-7 pt-6 border-t border-border">
        <header class="mb-4 flex flex-wrap gap-3 items-baseline justify-between">
          <h3 class="qs-type-component-title m-0">
            {{ t('purchasePayment.installments') }}
          </h3>
          <div class="flex flex-wrap gap-x-2 gap-y-1 min-w-0 items-baseline">
            <span class="qs-type-meta text-muted-foreground">{{ t('purchasePayment.orderTotal') }}</span>
            <AmountDisplay :value="selection.order.purchaseTotalAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" class="max-w-full overflow-x-auto" />
          </div>
        </header>
        <ul class="m-0 p-0 list-none space-y-3">
          <li v-for="item in installments" :key="item.id" class="p-4 border rounded-lg min-w-0" :class="selection.item.id === item.id ? 'border-primary/35 bg-primary/5' : 'border-border'">
            <div class="flex gap-3 min-w-0 items-center justify-between">
              <div class="flex flex-wrap gap-2 min-w-0 items-center">
                <span class="qs-type-body-medium">{{ t(`purchasePayment.types.${item.paymentType}`) }}</span>
                <FaTag variant="outline" class="qs-type-status-tag" :class="statusClasses[item.status]">
                  {{ t(`purchasePayment.status.${item.status}`) }}
                </FaTag>
              </div>
              <FaButton v-if="selectable" type="button" variant="ghost" size="sm" class="shrink-0 min-h-11 sm:min-h-8" :class="selection.item.id === item.id ? 'text-primary dark:text-emerald-300' : ''" :aria-label="t('purchasePayment.chooseInstallment', { type: t(`purchasePayment.types.${item.paymentType}`) })" :aria-pressed="selection.item.id === item.id" :disabled="!enabled || busy || unknown || uploading" @click="selectInstallment(item.id)">
                <FaIcon v-if="selection.item.id === item.id" name="i-lucide:circle-check" aria-hidden="true" />
                {{ t(selection.item.id === item.id ? 'purchasePayment.selected' : 'purchasePayment.choose') }}
              </FaButton>
              <span v-else-if="selection.item.id === item.id" class="qs-type-meta text-primary shrink-0 dark:text-emerald-300">{{ t('purchasePayment.currentInstallment') }}</span>
            </div>
            <div class="mt-2 flex flex-wrap gap-x-2 gap-y-1 min-w-0 items-baseline">
              <span class="qs-type-meta text-muted-foreground">{{ t(canPayPurchasePayable(item) ? 'purchasePayment.remainingAmount' : 'purchasePayment.dueAmount') }}</span>
              <AmountDisplay :value="canPayPurchasePayable(item) ? item.remainingAmount : item.dueAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" class="max-w-full overflow-x-auto" />
            </div>
          </li>
        </ul>
      </section>
    </section>

    <section :aria-label="t('purchasePayment.recipientInformation')" class="p-5 border-t border-border gap-6 grid min-w-0 content-start lg:p-6 xl:border-l xl:border-t-0">
      <h2 class="qs-type-component-title m-0">
        {{ t('purchasePayment.recipientInformation') }}
      </h2>
      <template v-if="payable">
        <FaAlert v-if="!recipientOptions.length" :title="t('purchasePayment.noRecipient')" :description="t('purchasePayment.noRecipientHint')" />
        <div v-else class="gap-3 grid">
          <label for="purchase-payment-recipient" class="qs-type-body-medium">{{ t('purchasePayment.paymentMethod') }} <span class="text-destructive">*</span></label>
          <FaSelect id="purchase-payment-recipient" v-model="recipientAccountId" :options="recipientOptions" :disabled="fieldsLocked" :placeholder="t('purchasePayment.choosePaymentMethod')" class="w-full" />
          <p v-if="fieldError === 'recipientAccountId'" role="alert" class="qs-type-meta text-destructive m-0">
            {{ t('purchasePayment.invalidPaymentMethod') }}
          </p>
        </div>
      </template>
      <div v-if="displayedRecipient" class="space-y-3">
        <p v-if="!payable" class="qs-type-body-medium m-0">
          {{ t(`purchasePayment.methods.${displayedRecipient.paymentMethod}`) }}
        </p>
        <PaymentRecipientDetails :account="displayedRecipient" class="purchase-payment-recipient" :class="{ 'text-center': displayedRecipient.paymentMethod !== 'BANK_TRANSFER' }" />
      </div>
      <p v-else-if="payable && recipientOptions.length" class="qs-type-meta text-muted-foreground m-0">
        {{ t('purchasePayment.selectRecipientHint') }}
      </p>
      <p v-else-if="!payable" class="qs-type-meta text-muted-foreground m-0">
        {{ t('purchasePayment.noHistoricalRecipient') }}
      </p>
    </section>

    <section :aria-label="t('purchasePayment.paymentInformation')" class="p-5 border-t border-border bg-muted/20 flex flex-col min-w-0 lg:p-6 sm:p-5 xl:border-l xl:border-t-0">
      <header class="flex flex-wrap gap-2 items-center justify-between">
        <h2 class="qs-type-component-title m-0">
          {{ t('purchasePayment.paymentInformation') }}
        </h2>
        <FaTag variant="outline" class="qs-type-status-tag" :class="statusClasses[selection.item.status]">
          {{ t(`purchasePayment.status.${selection.item.status}`) }}
        </FaTag>
      </header>
      <div class="py-5 space-y-2">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t(payable ? 'purchasePayment.paymentAmount' : 'purchasePayment.dueAmount') }} · {{ t(`purchasePayment.types.${selection.item.paymentType}`) }}
        </p>
        <div tabindex="0" :aria-label="t(payable ? 'purchasePayment.paymentAmount' : 'purchasePayment.dueAmount')" class="purchase-payment-amount py-1 flex max-w-full overflow-x-auto">
          <AmountDisplay :value="payable ? selection.item.remainingAmount : selection.item.dueAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
        </div>
        <p v-if="payable" class="qs-type-meta text-muted-foreground m-0">
          {{ t('purchasePayment.amountHint') }}
        </p>
      </div>
      <div class="pt-5 space-y-4" aria-live="polite">
        <FaAlert v-if="!payable" :title="t(`purchasePayment.status.${selection.item.status}`)" :description="t(`purchasePayment.finished.${selection.item.status}`)" :class="selection.item.status === 'PAID' ? 'border-primary/35 bg-primary/5 text-primary dark:text-emerald-300' : ''" />
        <FaAlert v-if="error" :title="t(unknown ? 'purchasePayment.unknownTitle' : 'purchasePayment.payFailed')" :description="error" variant="destructive" />
        <FaAlert v-if="unknown" :title="t('purchasePayment.retryPay')" :description="t('purchasePayment.unknown')" />
        <FaAlert v-if="stale" :title="t('purchasePayment.staleTitle')" :description="t('purchasePayment.stale')" />
      </div>
      <dl v-if="!payable && selection.item.paidAt" class="m-0 mt-5 space-y-4">
        <div>
          <dt class="qs-type-meta text-muted-foreground mb-1.5">
            {{ t('purchasePayment.paidAt') }}
          </dt>
          <dd class="m-0">
            <DateTimeDisplay :value="selection.item.paidAt" />
          </dd>
        </div>
        <div v-if="selection.item.paidBy">
          <dt class="qs-type-meta text-muted-foreground mb-1.5">
            {{ t('purchasePayment.paidBy') }}
          </dt>
          <dd class="m-0">
            <QsPersonDisplay :display-name="selection.item.paidBy.name" size="sm" />
          </dd>
        </div>
      </dl>
      <PaymentVoucherPreview v-if="!payable && selection.item.paymentReceipt?.voucher" :payable-id="selection.item.id" :document-id="selection.item.paymentReceipt.voucher.id" :title="selection.item.paymentReceipt.voucher.title || t('purchasePayment.paymentVoucher')" />
      <FaForm v-if="payable" :model="{ voucherMediaAssetId, remark }" :disabled="fieldsLocked" class="gap-5">
        <FaFormItem name="voucherMediaAssetId" :label="t('purchasePayment.paymentVoucher')" required :auto-bind="false">
          <PaymentVoucherUpload v-model="voucherMediaAssetId" :payable-id="selection.item.id" :enabled="enabled" :disabled="busy || unknown || stale" @busy-change="uploading = $event" />
          <p v-if="fieldError === 'voucher'" role="alert" class="text-xs text-destructive m-0 mt-1">
            {{ t('purchasePayment.voucherRequired') }}
          </p>
        </FaFormItem>
        <FaFormItem name="remark" :label="t('purchasePayment.remark')">
          <FaTextarea v-model="remark" :disabled="fieldsLocked" maxlength="500" :placeholder="t('purchasePayment.remarkPlaceholder')" input-class="min-h-24" />
          <p v-if="fieldError === 'remark'" role="alert" class="text-xs text-destructive m-0 mt-1">
            {{ t('purchasePayment.invalidRemark') }}
          </p>
        </FaFormItem>
      </FaForm>
      <footer v-if="payable" class="mt-auto pt-7 space-y-3">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('purchasePayment.confirmHint') }}
        </p>
        <FaButton v-if="stale" type="button" variant="outline" class="min-h-11 w-full" :disabled="busy" @click="emit('refresh')">
          <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('purchasePayment.recheck') }}
        </FaButton>
        <FaButton v-else type="button" class="min-h-11 w-full" :disabled="!canSubmit || uploading" :loading="busy" @click="confirm">
          {{ t(unknown ? 'purchasePayment.retryPay' : 'purchasePayment.confirmPay') }}
        </FaButton>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.purchase-payment-recipient {
  --recipient-qr-width: 28rem;
}

.purchase-payment-amount :deep([data-currency]) {
  font-size: var(--qs-type-size-3xl);
  font-weight: var(--qs-type-weight-semibold);
  line-height: var(--qs-type-leading-3xl);
}
</style>
