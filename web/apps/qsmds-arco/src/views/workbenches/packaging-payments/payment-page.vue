<script setup lang="ts">
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import PaymentRecipientDetails from '@/components/business/QsPaymentRecipientEditor/PaymentRecipientDetails.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import PaymentImagePreview from './payment-image-preview.vue'
import PaymentVoucherUpload from './payment-voucher-upload.vue'
import { usePackagingPayment } from './use-packaging-payment'

defineOptions({ name: 'QsPackagingPayment' })
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const route = useRoute()
const router = useRouter()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const active = ref(false)
const canRead = computed(() => auth('packaging-costs:read'))
const canPay = computed(() => canRead.value && auth('packaging-costs:pay'))
const enabled = computed(() => active.value && account.authState === 'authenticated' && canRead.value && route.name === 'qsFinanceRealtimePackagingPayment')
const requestId = computed(() => typeof route.params.requestId === 'string' && route.params.requestId.trim() ? route.params.requestId : null)
const { detail, loading, busy, unknown, stale, loadError, actionError, recipientAccountId, recipient, voucherFile, remark, fieldError, payable, load, confirm } = usePackagingPayment(enabled, canPay, computed(() => account.authEpoch), requestId)
const pending = computed(() => detail.value?.status === 'PENDING_PAYMENT')
const locked = computed(() => busy.value || unknown.value)
const fieldsLocked = computed(() => !enabled.value || !canPay.value || locked.value || stale.value)
const recipients = computed(() => (detail.value?.paymentRecipientProfile?.accounts ?? []).filter(item => ['ALIPAY', 'WECHAT'].includes(item.paymentMethod) && item.qrMediaAssetId).map(item => ({ value: item.id, label: t(`paymentRecipient.methods.${item.paymentMethod}`) })))
const displayedRecipient = computed(() => pending.value ? recipient.value : detail.value?.paymentReceipt?.recipient ?? null)
const information = computed(() => detail.value
  ? [
      { key: 'shippingMarkText', value: detail.value.shippingMarkText, data: true },
      { key: 'purchaseOrderNo', value: detail.value.purchaseOrderNo, data: true },
      { key: 'salesOrderNo', value: detail.value.salesOrderNo, data: true },
      { key: 'packagingInfo', value: detail.value.packagingTypeName, data: false },
      { key: 'vendorLabel', value: t(`packagingPayment.vendor.${detail.value.packagingVendor}`), data: false },
    ]
  : [])
async function pay() {
  if (await confirm()) {
    toast.success(t('packagingPayment.paySuccess'))
  }
}
function canLeave() {
  if (enabled.value && canPay.value && locked.value) {
    toast.warning(t('packagingPayment.leaveBlocked'))
    return false
  }
  return true
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (enabled.value && canPay.value && locked.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onBeforeRouteLeave(canLeave)
onBeforeRouteUpdate(canLeave)
onMounted(() => {
  active.value = true
  window.addEventListener('beforeunload', beforeUnload)
})
onActivated(() => active.value = true)
onDeactivated(() => active.value = false)
onBeforeUnmount(() => {
  active.value = false
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('packagingPayment.payTitle')" :description="t('packagingPayment.pageDescription')">
      <div class="flex flex-wrap gap-2">
        <FaButton variant="outline" :disabled="locked" class="min-h-11 sm:min-h-9" @click="router.push({ name: 'qsFinanceRealtimePackagingPayments' })">
          <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('packagingPayment.backToList') }}
        </FaButton>
        <FaButton v-if="canRead" variant="outline" :disabled="locked" :loading="loading" class="min-h-11 sm:min-h-9" @click="load">
          <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('packagingPayment.refresh') }}
        </FaButton>
      </div>
    </FaPageHeader>
    <FaPageMain main-class="p-0" :aria-busy="loading">
      <FaEmpty v-if="!canRead" icon="i-lucide:shield-alert" :title="t('packagingPayment.noPermission')" class="py-12" />
      <div v-else-if="loading" role="status" class="text-muted-foreground py-12 flex gap-3 items-center justify-center">
        <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" aria-hidden="true" />{{ t('packagingPayment.loading') }}
      </div>
      <FaEmpty v-else-if="!requestId" icon="i-lucide:link-2-off" :title="t('packagingPayment.invalidLink')" class="py-12" />
      <FaEmpty v-else-if="loadError" icon="i-lucide:triangle-alert" :title="t('packagingPayment.loadFailed')" :description="loadError" class="py-12">
        <FaButton variant="outline" @click="load">
          {{ t('packagingPayment.retry') }}
        </FaButton>
      </FaEmpty>
      <div v-else-if="detail && enabled" class="grid min-w-0 xl:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,3fr)]">
        <section :aria-label="t('packagingPayment.requestInformation')" class="p-5 min-w-0 lg:p-6">
          <header class="mb-6 space-y-2">
            <p class="qs-type-meta text-muted-foreground m-0 flex gap-2 items-center">
              <FaIcon name="i-lucide:package" class="size-4" aria-hidden="true" />{{ t('packagingPayment.shipmentNo') }}
            </p>
            <h2 class="text-xl qs-type-data-emphasis leading-7 m-0 select-all break-all">
              {{ detail.shipmentNo || '—' }}
            </h2>
          </header>
          <dl class="m-0 gap-5 grid">
            <div v-for="item in information" :key="item.key" class="min-w-0">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t(`packagingPayment.${item.key}`) }}
              </dt>
              <dd class="m-0 break-words" :class="item.data ? 'qs-type-data break-all' : 'qs-type-body-medium'">
                {{ item.value || '—' }}
              </dd>
            </div>
          </dl>
          <dl class="m-0 mt-6 pt-5 border-t border-border flex flex-wrap gap-3 items-center justify-between">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('packagingPayment.owner') }}
            </dt>
            <dd class="m-0 max-w-full min-w-0">
              <QsPersonDisplay :display-name="detail.owner.name" size="sm" :avatar-url="detail.owner.avatarUrl" />
            </dd>
          </dl>
          <section class="mt-6 pt-5 border-t border-border space-y-4" :aria-label="t('packagingPayment.imagesTitle')">
            <h3 class="qs-type-body-medium m-0">
              {{ t('packagingPayment.imagesTitle') }}
            </h3>
            <div class="gap-5 grid grid-cols-2">
              <PaymentImagePreview v-for="kind in (['PACKAGING', 'QUOTATION'] as const)" :key="kind" :request-id="detail.id" :kind="kind" :title="t(`packagingPayment.images.${kind}`)" :enabled="enabled" />
            </div>
            <p v-if="detail.remark" class="qs-type-meta text-muted-foreground m-0 whitespace-pre-wrap break-words">
              {{ detail.remark }}
            </p>
          </section>
        </section>
        <section :aria-label="t('packagingPayment.recipientInformation')" class="p-5 border-t border-border gap-6 grid min-w-0 content-start lg:p-6 xl:border-l xl:border-t-0">
          <h2 class="qs-type-component-title m-0">
            {{ t('packagingPayment.recipientInformation') }}
          </h2>
          <template v-if="pending">
            <FaAlert v-if="!recipients.length" :title="t('packagingPayment.noRecipient')" :description="t(detail.packagingVendor === 'OTHER' ? 'packagingPayment.noCustomRecipientHint' : 'packagingPayment.noRecipientHint')" />
            <div v-else class="gap-3 grid">
              <label for="packaging-payment-recipient" class="qs-type-body-medium">{{ t('packagingPayment.paymentMethod') }} <span class="text-destructive">*</span></label>
              <FaSelect id="packaging-payment-recipient" v-model="recipientAccountId" :options="recipients" :disabled="fieldsLocked" :placeholder="t('packagingPayment.choosePaymentMethod')" class="w-full" />
              <p v-if="fieldError === 'recipient'" role="alert" class="qs-type-meta text-destructive m-0">
                {{ t('packagingPayment.invalidRecipient') }}
              </p>
            </div>
          </template>
          <div v-if="displayedRecipient" class="space-y-3">
            <p v-if="!pending" class="qs-type-body-medium m-0 text-center">
              {{ t(`paymentRecipient.methods.${displayedRecipient.paymentMethod}`) }}
            </p>
            <PaymentRecipientDetails :account="displayedRecipient" class="packaging-payment-recipient text-center" />
          </div>
          <p v-else-if="pending && recipients.length" class="qs-type-meta text-muted-foreground m-0">
            {{ t('packagingPayment.selectRecipientHint') }}
          </p>
          <p v-else-if="!pending" class="qs-type-meta text-muted-foreground m-0">
            {{ t('packagingPayment.noHistoricalRecipient') }}
          </p>
        </section>
        <section :aria-label="t('packagingPayment.paymentInformation')" class="p-5 border-t border-border bg-muted/20 flex flex-col min-w-0 lg:p-6 xl:border-l xl:border-t-0">
          <header class="flex flex-wrap gap-2 items-center justify-between">
            <h2 class="qs-type-component-title m-0">
              {{ t('packagingPayment.paymentInformation') }}
            </h2>
            <FaTag variant="outline" class="qs-type-status-tag" :class="pending ? 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-primary/35 bg-primary/10 text-primary dark:text-emerald-300'">
              {{ t(`packagingPayment.status.${detail.status}`) }}
            </FaTag>
          </header>
          <div class="py-5 space-y-2">
            <p class="qs-type-meta text-muted-foreground m-0">
              {{ t('packagingPayment.paymentAmount') }}
            </p>
            <div tabindex="0" :aria-label="t('packagingPayment.paymentAmount')" class="packaging-payment-amount py-1 flex max-w-full overflow-x-auto">
              <AmountDisplay :value="detail.amount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
            </div>
          </div>
          <div aria-live="polite" class="mb-5 space-y-3">
            <FaAlert v-if="actionError" :title="t(unknown ? 'packagingPayment.unknownTitle' : 'packagingPayment.payFailed')" :description="actionError" variant="destructive" />
            <FaAlert v-if="unknown" :title="t('packagingPayment.retryPay')" :description="t('packagingPayment.unknownHint')" />
            <FaAlert v-if="stale" :title="t('packagingPayment.staleTitle')" :description="t('packagingPayment.staleHint')" />
            <FaAlert v-if="pending && !canPay" :title="t('packagingPayment.noPayPermission')" />
            <FaAlert v-if="!pending" :title="t('packagingPayment.alreadyPaid')" class="text-primary border-primary/35 bg-primary/5 dark:text-emerald-300" />
          </div>
          <FaForm v-if="pending" :model="{ voucherFile, remark }" :disabled="fieldsLocked" class="gap-5">
            <FaFormItem name="voucherFile" :label="t('packagingPayment.paymentVoucher')" required :auto-bind="false">
              <PaymentVoucherUpload v-model="voucherFile" :disabled="fieldsLocked || !recipients.length" />
              <p v-if="fieldError === 'voucher'" role="alert" class="qs-type-meta text-destructive m-0 mt-1">
                {{ t('packagingPayment.invalidVoucher') }}
              </p>
            </FaFormItem>
            <FaFormItem name="remark" :label="t('packagingPayment.paymentRemark')">
              <FaTextarea v-model="remark" :disabled="fieldsLocked" maxlength="500" :placeholder="t('packagingPayment.remarkPlaceholder')" input-class="min-h-24" />
              <p v-if="fieldError === 'remark'" role="alert" class="qs-type-meta text-destructive m-0 mt-1">
                {{ t('packagingPayment.invalidRemark') }}
              </p>
            </FaFormItem>
          </FaForm>
          <template v-else>
            <dl class="m-0 mb-5 space-y-4">
              <div>
                <dt class="qs-type-meta text-muted-foreground mb-1.5">
                  {{ t('packagingPayment.paidAt') }}
                </dt>
                <dd class="m-0">
                  <DateTimeDisplay :value="detail.paidAt" />
                </dd>
              </div>
              <div v-if="detail.paidBy">
                <dt class="qs-type-meta text-muted-foreground mb-1.5">
                  {{ t('packagingPayment.paidBy') }}
                </dt>
                <dd class="m-0">
                  <QsPersonDisplay :display-name="detail.paidBy.name" size="sm" :avatar-url="detail.paidBy.avatarUrl" />
                </dd>
              </div>
            </dl>
            <PaymentImagePreview v-if="detail.paymentReceipt?.voucher" :request-id="detail.id" kind="PAYMENT" :title="t('packagingPayment.paymentVoucher')" :enabled="enabled" />
            <p v-if="detail.paymentReceipt?.remark" class="qs-type-meta text-muted-foreground mt-4 whitespace-pre-wrap break-words">
              {{ detail.paymentReceipt.remark }}
            </p>
          </template>
          <footer v-if="pending && canPay" class="mt-auto pt-7 space-y-3">
            <p class="qs-type-meta text-muted-foreground m-0">
              {{ t('packagingPayment.confirmHint') }}
            </p>
            <FaButton v-if="stale" variant="outline" class="min-h-11 w-full" :disabled="busy" @click="load">
              <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('packagingPayment.recheck') }}
            </FaButton>
            <FaButton v-else :disabled="!payable" :loading="busy" class="min-h-11 w-full" @click="pay">
              {{ t(unknown ? 'packagingPayment.retryPay' : 'packagingPayment.confirmPay') }}
            </FaButton>
          </footer>
        </section>
      </div>
    </FaPageMain>
  </div>
</template>

<style scoped>
.packaging-payment-recipient {
  --recipient-qr-width: 28rem;
}

.packaging-payment-amount :deep([data-currency]) {
  font-size: var(--qs-type-size-3xl);
  font-weight: var(--qs-type-weight-semibold);
  line-height: var(--qs-type-leading-3xl);
}
</style>
