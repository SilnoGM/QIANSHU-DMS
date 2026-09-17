<script setup lang="ts">
import type { StatementImageLabels } from './purchase-payment-statement-image'
import type { PurchasePayableOrderDto } from '@/api/generated/types.gen'
import { formatDateTime } from '@/components/base/DateTimeDisplay/format'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { PurchasePaymentStatementError } from './purchase-payment-statement-image'
import { usePurchasePaymentStatement } from './use-purchase-payment-statement'

const props = defineProps<{ orders: PurchasePayableOrderDto[], supplierName: string, enabled: boolean }>()
const emit = defineEmits<{ busyChange: [value: boolean] }>()
const { t } = useI18n()
const toast = useQsToast()
const account = useAppAccountStore()
const statement = usePurchasePaymentStatement({
  enabled: computed(() => props.enabled),
  epoch: computed(() => account.authEpoch),
  orders: computed(() => props.orders),
  supplierName: computed(() => props.supplierName),
})
const stepIndex = ref(0)
const imageError = ref(false)
const canGenerate = computed(() => props.enabled && props.orders.length > 0 && !statement.generating.value && !statement.copying.value)

function imageLabels(): StatementImageLabels {
  const label = (key: string) => t(`purchasePayment.statement.image.${key}`)
  return {
    title: label('title'),
    supplier: label('supplier'),
    generatedAt: label('generatedAt'),
    selectedOrders: label('selectedOrders'),
    unpaidTotal: label('unpaidTotal'),
    order: label('order'),
    stage: label('stage'),
    due: label('due'),
    paid: label('paid'),
    remaining: label('remaining'),
    status: label('status'),
    total: label('total'),
    currency: label('currency'),
    note: label('note'),
    paymentTypes: { DEPOSIT: t('purchasePayment.types.DEPOSIT'), BALANCE: t('purchasePayment.types.BALANCE') },
    statuses: { PENDING_PAYMENT: t('purchasePayment.status.PENDING_PAYMENT'), PAID: t('purchasePayment.status.PAID'), NO_PAYMENT: t('purchasePayment.status.NO_PAYMENT'), CANCELLED: t('purchasePayment.status.CANCELLED') },
  }
}
function start() {
  if (!canGenerate.value) {
    return
  }
  imageError.value = false
  stepIndex.value = 0
  statement.start(['fetch', 'calculate', 'render'].map(key => t(`purchasePayment.statement.steps.${key}`)), imageLabels(), formatDateTime(new Date()))
}
function failed(error: unknown) {
  if (statement.fail(error)) {
    const code = error instanceof PurchasePaymentStatementError ? error.code : ''
    toast.error(t(`purchasePayment.statement.${code === 'STATEMENT_TOO_LARGE' ? 'tooLarge' : 'generationFailed'}`))
  }
}
async function copy() {
  if (await statement.copy()) {
    toast.success(t('purchasePayment.statement.copied'))
  }
  else if (statement.failure.value) {
    toast.error(t('purchasePayment.statement.copyFailed'))
  }
}
const errorDescription = computed(() => {
  if (!statement.failure.value) {
    return ''
  }
  const failure = statement.failure.value
  return t(`purchasePayment.statement.${failure instanceof Error && failure.message === 'STATEMENT_CLIPBOARD_UNAVAILABLE' ? 'clipboardUnavailable' : 'copyFailedHint'}`)
})
watch(statement.generating, value => emit('busyChange', value), { flush: 'sync' })
onBeforeUnmount(() => emit('busyChange', false))
</script>

<template>
  <FaButton type="button" variant="outline" class="shrink-0 min-h-11 sm:min-h-9" :disabled="!canGenerate" @click="start">
    <FaIcon name="i-lucide:file-image" aria-hidden="true" />
    {{ t('purchasePayment.statement.generate', { count: orders.length }) }}
  </FaButton>
  <QsGenericModal v-model="statement.visible.value" :title="t('purchasePayment.statement.title')" :description="t('purchasePayment.statement.description')" size="xl" :submitting="statement.copying.value">
    <template #header-leading>
      <FaIcon name="i-lucide:file-image" class="size-5" aria-hidden="true" />
    </template>
    <div class="gap-4 grid min-w-0">
      <FaAlert v-if="imageError" variant="destructive" :title="t('purchasePayment.statement.generationFailed')" />
      <FaAlert v-if="errorDescription" variant="destructive" :title="t('purchasePayment.statement.copyFailed')" :description="errorDescription" />
      <img v-if="statement.previewUrl.value" :src="statement.previewUrl.value" :alt="t('purchasePayment.statement.title')" class="border border-border rounded-md bg-white h-auto w-full block" @load="statement.markLoaded(($event.target as HTMLImageElement).currentSrc)" @error="imageError = true">
    </div>
    <template #footer>
      <FaButton type="button" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="!statement.imageLoaded.value || imageError || !enabled || statement.copying.value" :loading="statement.copying.value" @click="copy">
        <FaIcon name="i-lucide:copy" aria-hidden="true" />
        {{ t('purchasePayment.statement.copy') }}
      </FaButton>
    </template>
  </QsGenericModal>
  <span v-if="statement.generating.value" class="sr-only" role="status">{{ statement.steps.value[stepIndex]?.text }}</span>
  <FaMultiStepLoader :loading="statement.generating.value" :steps="statement.steps.value" prevent-close @state-change="stepIndex = $event" @complete="statement.complete" @error="failed" />
</template>
