<script setup lang="ts">
import type { PurchasePaymentRecordDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { buildPurchaseOrderPaymentVoidRequest } from '../../operations/purchase-orders/purchase-order-detail.logic'
import { getPurchaseOrderApiFailure } from '../../operations/purchase-orders/purchase-order-list.logic'

defineOptions({ name: 'PurchasePaymentVoidModal' })

const props = withDefaults(defineProps<{
  currencies: readonly CurrencyDescriptor[]
  modelValue: boolean
  record: PurchasePaymentRecordDto | null
}>(), {})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'voided': []
}>()

const { t } = useI18n()
const toast = useQsToast()
const reason = ref('')
const reasonError = ref('')
const failure = ref<null | string>(null)
const submitting = ref(false)
let controller: AbortController | null = null

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const description = computed(() => props.record
  ? `${props.record.orderNo} · ${t(`purchasePayment.types.${props.record.paymentType}`)}`
  : undefined)

watch(() => props.modelValue, (open) => {
  if (open) {
    reason.value = ''
    reasonError.value = ''
    failure.value = null
    submitting.value = false
  }
  else {
    controller?.abort()
    controller = null
  }
})

function updateVisible(value: boolean): void {
  if (!value && submitting.value) {
    return
  }
  visible.value = value
}

async function submit(): Promise<void> {
  const record = props.record
  if (record === null || submitting.value) {
    return
  }
  const result = buildPurchaseOrderPaymentVoidRequest(reason.value)
  if (!result.valid) {
    reasonError.value = result.fieldError
    return
  }
  reasonError.value = ''
  failure.value = null
  submitting.value = true
  const request = new AbortController()
  controller = request
  try {
    await purchaseOrdersApi.voidPayment(
      record.purchaseOrderId,
      record.id,
      result.request,
      request.signal,
    )
    if (request.signal.aborted) {
      return
    }
    toast.success(t('purchasePayment.records.voidSuccess'))
    emit('voided')
    visible.value = false
  }
  catch (error) {
    if (!request.signal.aborted) {
      failure.value = getPurchaseOrderApiFailure(error).message
    }
  }
  finally {
    if (controller === request) {
      controller = null
      submitting.value = false
    }
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('purchasePayment.records.voidTitle')"
    :description="description"
    size="sm"
    :closable="!submitting"
    :dismiss-on-escape="!submitting"
    :dismiss-on-overlay="!submitting"
    :submitting="submitting"
    @update:model-value="updateVisible"
  >
    <FaAlert
      v-if="failure"
      variant="destructive"
      icon="i-lucide:circle-alert"
      :title="t('purchasePayment.records.voidFailed')"
      :description="failure"
      class="mb-4"
      role="alert"
    />

    <dl v-if="record" class="m-0 mb-4 p-4 border border-border/70 bg-muted/20 gap-3 grid grid-cols-2 max-[479px]:grid-cols-1">
      <div>
        <dt class="qs-type-compact-label mb-1">
          {{ t('purchasePayment.records.orderNo') }}
        </dt>
        <dd class="qs-type-data-emphasis m-0 break-all">
          {{ record.orderNo }}
        </dd>
      </div>
      <div>
        <dt class="qs-type-compact-label mb-1">
          {{ t('purchasePayment.records.paymentType') }}
        </dt>
        <dd class="m-0">
          {{ t(`purchasePayment.types.${record.paymentType}`) }}
        </dd>
      </div>
      <div>
        <dt class="qs-type-compact-label mb-1">
          {{ t('purchasePayment.records.amount') }}
        </dt>
        <dd class="m-0">
          <AmountDisplay :value="record.amount" currency="CNY" :currencies="currencies" />
        </dd>
      </div>
      <div>
        <dt class="qs-type-compact-label mb-1">
          {{ t('purchasePayment.records.paidAt') }}
        </dt>
        <dd class="m-0">
          <DateTimeDisplay :value="record.paidAt" />
        </dd>
      </div>
      <div class="col-span-2 max-[479px]:col-span-1">
        <dt class="qs-type-compact-label mb-1">
          {{ t('purchasePayment.records.recordedBy') }}
        </dt>
        <dd class="m-0">
          <QsPersonDisplay :display-name="record.createdBy.displayName" size="sm" :avatar-url="record.createdBy.avatarUrl" />
        </dd>
      </div>
    </dl>

    <FaAlert
      icon="i-lucide:triangle-alert"
      :title="t('purchasePayment.records.voidWarningTitle')"
      :description="t('purchasePayment.records.voidWarning')"
      class="mb-4"
    />

    <label class="qs-type-compact-label mb-1 block" for="purchase-payment-void-reason">
      {{ t('purchasePayment.records.reason') }}
    </label>
    <FaTextarea
      id="purchase-payment-void-reason"
      v-model="reason"
      :disabled="submitting"
      :placeholder="t('purchasePayment.records.reasonPlaceholder')"
      :maxlength="500"
      input-class="min-h-24"
    />
    <p v-if="reasonError" class="text-xs text-destructive m-0 mt-1">
      {{ reasonError }}
    </p>
    <p class="qs-type-meta text-muted-foreground m-0 mt-3">
      {{ t('purchasePayment.records.unknownNotice') }}
    </p>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        :disabled="submitting"
        @click="updateVisible(false)"
      >
        {{ t('purchasePayment.records.cancel') }}
      </FaButton>
      <FaButton
        type="button"
        variant="destructive"
        :loading="submitting"
        :disabled="record === null"
        @click="submit"
      >
        {{ t('purchasePayment.records.confirmVoid') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
