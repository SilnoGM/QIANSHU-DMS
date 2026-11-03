<script setup lang="ts">
import type { AdvertisingRechargeDto } from '@/api/generated/types.gen'
import { getApiClientFailureMessage } from '@/api/errors'
import advertisingRechargesApi from '@/api/modules/advertising-recharges'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import {
  advertisingRechargeProofUrl,
  advertisingRechargeQrUrl,
  advertisingRechargeStatusMeta,
} from './logic'

defineOptions({ name: 'AdvertisingRechargeDetailDrawer' })

const props = defineProps<{
  modelValue: boolean
  recharge: AdvertisingRechargeDto | null
}>()

const emit = defineEmits<{
  'changed': [recharge: AdvertisingRechargeDto]
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()
const withdrawing = ref(false)
const withdrawError = ref('')

const statusMeta = computed(() => props.recharge === null ? null : advertisingRechargeStatusMeta(props.recharge.status))
const qrItems = computed(() => {
  const recharge = props.recharge
  const qr = recharge?.paymentQr
  if (recharge == null || qr == null) {
    return []
  }
  const src = advertisingRechargeQrUrl(recharge.id, 'self')
  return [{ alt: t('advertisingRecharge.field.paymentQr'), key: qr.mediaAssetId, src, previewSrc: src, tooltip: qr.fileName }]
})
const proofItems = computed(() => props.recharge?.payment?.proof == null
  ? []
  : [{
      alt: t('advertisingRecharge.detail.paymentProof'),
      key: props.recharge.payment.proof.mediaAssetId,
      src: advertisingRechargeProofUrl(props.recharge.id, 'self'),
      previewSrc: advertisingRechargeProofUrl(props.recharge.id, 'self'),
      tooltip: props.recharge.payment.proof.fileName,
    }])

watch(() => props.modelValue, (open) => {
  if (open) {
    withdrawError.value = ''
  }
})

async function withdraw(): Promise<void> {
  const recharge = props.recharge
  if (recharge === null || withdrawing.value || recharge.status !== 'PENDING') {
    return
  }
  withdrawing.value = true
  withdrawError.value = ''
  const controller = new AbortController()
  try {
    const response = await advertisingRechargesApi.withdraw(
      recharge.id,
      { expectedVersion: recharge.version },
      controller.signal,
    )
    emit('changed', response.data)
    toast.success(t('advertisingRecharge.toast.withdrawn'))
  }
  catch (failure) {
    withdrawError.value = getApiClientFailureMessage(failure, t('advertisingRecharge.error.withdraw'))
  }
  finally {
    withdrawing.value = false
  }
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue"
    :title="t('advertisingRecharge.detail.title')"
    :description="recharge?.rechargeNo ?? undefined"
    size="lg"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="recharge !== null" class="gap-5 grid">
      <section class="p-4 border border-border rounded-xl bg-muted/25">
        <div class="mb-3 flex flex-wrap gap-2 items-center justify-between">
          <span v-if="statusMeta" class="qs-type-tag px-2 py-0.5 border rounded-md" :class="statusMeta.tagClass">
            {{ t(statusMeta.labelKey) }}
          </span>
          <span class="font-qs-data-mono qs-type-meta">{{ recharge.rechargeNo }}</span>
        </div>
        <dl class="m-0 gap-x-6 gap-y-3 grid grid-cols-2 max-sm:grid-cols-1">
          <div>
            <dt class="qs-type-compact-label">
              {{ t('advertisingRecharge.field.adAccountName') }}
            </dt>
            <dd class="qs-type-body-medium m-0 break-words">
              {{ recharge.adAccountName }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('advertisingRecharge.field.adAccountNo') }}
            </dt>
            <dd class="qs-type-data m-0 break-all">
              {{ recharge.adAccountNo }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('advertisingRecharge.field.accountType') }}
            </dt>
            <dd class="m-0">
              {{ t(`advertisingRecharge.accountType.${recharge.accountType === 'PERSONAL' ? 'personal' : 'nonPersonal'}`) }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('advertisingRecharge.field.rechargeAmount') }}
            </dt>
            <dd class="m-0">
              <AmountDisplay :value="recharge.rechargeAmount" :currency="recharge.rechargeCurrency" :currencies="currencyCatalog.currencies.value" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('advertisingRecharge.field.applicant') }}
            </dt>
            <dd class="m-0">
              <QsPersonDisplay :display-name="recharge.applicant.name" size="sm" :avatar-url="recharge.applicant.avatarUrl" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('advertisingRecharge.field.submittedAt') }}
            </dt>
            <dd class="m-0">
              <DateTimeDisplay :value="recharge.submittedAt" format="datetime" />
            </dd>
          </div>
          <div v-if="recharge.remark" class="col-span-full">
            <dt class="qs-type-compact-label">
              {{ t('advertisingRecharge.field.remark') }}
            </dt>
            <dd class="qs-type-body m-0 whitespace-pre-wrap break-words">
              {{ recharge.remark }}
            </dd>
          </div>
        </dl>
      </section>

      <section v-if="recharge.accountType === 'PERSONAL'">
        <h3 class="qs-type-component-title m-0 mb-3">
          {{ t('advertisingRecharge.field.paymentQr') }}
        </h3>
        <ImageGroup :items="qrItems" :max-count="1" size="lg" />
      </section>

      <section v-if="recharge.payment">
        <h3 class="qs-type-component-title m-0 mb-3">
          {{ t('advertisingRecharge.detail.payment') }}
        </h3>
        <dl class="m-0 mb-3 gap-x-6 gap-y-3 grid grid-cols-2 max-sm:grid-cols-1">
          <div>
            <dt class="qs-type-compact-label">
              {{ t('advertisingRecharge.field.paymentAmount') }}
            </dt>
            <dd class="m-0">
              <AmountDisplay :value="recharge.payment.amountCny" currency="CNY" :currencies="currencyCatalog.currencies.value" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('advertisingRecharge.field.paidAt') }}
            </dt>
            <dd class="m-0">
              <DateTimeDisplay :value="recharge.payment.paidAt" format="datetime" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('advertisingRecharge.field.paidBy') }}
            </dt>
            <dd class="m-0">
              <QsPersonDisplay :display-name="recharge.payment.paidBy.name" size="sm" :avatar-url="recharge.payment.paidBy.avatarUrl" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('advertisingRecharge.field.fundBatchNo') }}
            </dt>
            <dd class="qs-type-data-mono m-0">
              {{ recharge.payment.fundPostingBatchNo ?? t('advertisingRecharge.detail.noValue') }}
            </dd>
          </div>
        </dl>
        <ImageGroup :items="proofItems" :max-count="1" size="lg" />
      </section>

      <FaAlert v-if="recharge.reject" variant="destructive" :title="t('advertisingRecharge.detail.rejected')" :description="recharge.reject.reason" />
      <FaAlert v-if="recharge.void" variant="destructive" :title="t('advertisingRecharge.detail.voided')" :description="recharge.void.reason" />
      <FaAlert v-if="recharge.withdrawnAt" :title="t('advertisingRecharge.detail.withdrawn')" />
      <FaAlert v-if="withdrawError" variant="destructive" :description="withdrawError" role="alert" />
    </div>

    <template #footer>
      <FaButton type="button" variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" @click="close">
        {{ t('advertisingRecharge.action.close') }}
      </FaButton>
      <FaButton
        v-if="recharge?.status === 'PENDING'"
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :loading="withdrawing"
        @click="withdraw"
      >
        {{ t('advertisingRecharge.action.withdraw') }}
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
