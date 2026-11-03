<script setup lang="ts">
import type { RechargeImageUploadFile } from '../network-ads/advertising-recharges/use-recharge-image-upload'
import type { AdvertisingRechargeDto } from '@/api/generated/types.gen'
import type { MoneyAmount } from '@/components/base/MoneyInput/logic'
import { getApiClientFailureMessage } from '@/api/errors'
import advertisingRechargesApi from '@/api/modules/advertising-recharges'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import {
  advertisingRechargeProofUrl,
  advertisingRechargeQrUrl,
  advertisingRechargeStatusMeta,
} from '../network-ads/advertising-recharges/logic'
import { resolvePaymentCurrencies } from '../network-ads/advertising-recharges/recharge-form'
import RechargeImageUpload from '../network-ads/advertising-recharges/recharge-image-upload.vue'
import ReasonModal from './reason-modal.vue'

defineOptions({ name: 'FinanceAdvertisingRechargeDetail' })

const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const route = useRoute()
const router = useRouter()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()
const active = ref(false)
const canRead = computed(() => auth('advertising-recharges:read'))
const canPay = computed(() => auth('advertising-recharges:pay'))
const enabled = computed(() => active.value && account.authState === 'authenticated' && canRead.value)
const id = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const recharge = shallowRef<AdvertisingRechargeDto | null>(null)
const loading = ref(false)
const loadError = ref('')
const paymentAmount = ref<MoneyAmount>(null)
const paymentCurrency = ref<string | null>('CNY')
const proofMediaAssetId = ref<string | null>(null)
const uploading = ref(false)
const paying = ref(false)
const payError = ref('')
const rejectOpen = ref(false)
const rejectReasonError = ref('')
const rejecting = ref(false)
const voidOpen = ref(false)
const voidReasonError = ref('')
const voiding = ref(false)
let controller: AbortController | null = null

/** 上传或提交期间锁定页头导航，避免带着未完成的证据离开。 */
const locked = computed(() => uploading.value || paying.value || rejecting.value || voiding.value)

const paymentCurrencies = computed(() => resolvePaymentCurrencies(currencyCatalog.currencies.value))
const statusMeta = computed(() => recharge.value === null ? null : advertisingRechargeStatusMeta(recharge.value.status))
const qrItems = computed(() => {
  const row = recharge.value
  const qr = row?.paymentQr
  if (row == null || qr == null) {
    return []
  }
  const src = advertisingRechargeQrUrl(row.id, 'finance')
  return [{ alt: t('advertisingRecharge.field.paymentQr'), key: qr.mediaAssetId, src, previewSrc: src, tooltip: qr.fileName }]
})
const proofItems = computed(() => recharge.value?.payment?.proof == null
  ? []
  : [{
      alt: t('advertisingRecharge.detail.paymentProof'),
      key: recharge.value.payment.proof.mediaAssetId,
      src: advertisingRechargeProofUrl(recharge.value.id, 'finance'),
      previewSrc: advertisingRechargeProofUrl(recharge.value.id, 'finance'),
      tooltip: recharge.value.payment.proof.fileName,
    }])
const canSubmitPayment = computed(() => (
  canPay.value
  && recharge.value?.status === 'PENDING'
  && !paying.value
  && !uploading.value
  && paymentAmount.value !== null
  && paymentAmount.value.trim().length > 0
  && proofMediaAssetId.value !== null
))

const uploadProof: RechargeImageUploadFile = async (file, signal) => {
  const response = await advertisingRechargesApi.uploadProof(id.value, file, signal)
  return { mediaAssetId: response.data.mediaAssetId }
}

async function load(): Promise<void> {
  controller?.abort()
  if (!enabled.value || id.value.length === 0) {
    loading.value = false
    return
  }
  const request = new AbortController()
  controller = request
  loading.value = true
  loadError.value = ''
  payError.value = ''
  const requestEpoch = account.authEpoch
  try {
    const response = await advertisingRechargesApi.get(id.value, request.signal)
    if (current(request, requestEpoch)) {
      recharge.value = response.data
      paymentAmount.value = response.data.payment?.amountCny ?? null
    }
  }
  catch (failure) {
    if (current(request, requestEpoch)) {
      recharge.value = null
      loadError.value = getApiClientFailureMessage(failure, t('advertisingRecharge.error.loadDetail'))
    }
  }
  finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

function current(request: AbortController, requestEpoch: number): boolean {
  return !request.signal.aborted && controller === request && enabled.value && account.authEpoch === requestEpoch
}

async function submitPayment(): Promise<void> {
  const row = recharge.value
  if (!canSubmitPayment.value || row === null) {
    return
  }
  paying.value = true
  payError.value = ''
  const request = new AbortController()
  try {
    const response = await advertisingRechargesApi.pay(row.id, {
      paymentAmountCny: paymentAmount.value!,
      paymentProofMediaAssetId: proofMediaAssetId.value!,
      expectedVersion: row.version,
    }, request.signal)
    recharge.value = response.data
    paymentAmount.value = response.data.payment?.amountCny ?? null
    toast.success(t('advertisingRecharge.toast.paid'))
  }
  catch (failure) {
    payError.value = getApiClientFailureMessage(failure, t('advertisingRecharge.error.pay'))
  }
  finally {
    paying.value = false
  }
}

async function submitReject(reason: string): Promise<void> {
  const row = recharge.value
  if (row === null || rejecting.value) {
    return
  }
  rejecting.value = true
  rejectReasonError.value = ''
  const request = new AbortController()
  try {
    const response = await advertisingRechargesApi.reject(row.id, {
      expectedVersion: row.version,
      reason,
    }, request.signal)
    recharge.value = response.data
    rejectOpen.value = false
    toast.success(t('advertisingRecharge.toast.rejected'))
  }
  catch (failure) {
    rejectReasonError.value = getApiClientFailureMessage(failure, t('advertisingRecharge.error.reject'))
  }
  finally {
    rejecting.value = false
  }
}

async function submitVoid(reason: string): Promise<void> {
  const row = recharge.value
  if (row === null || voiding.value) {
    return
  }
  voiding.value = true
  voidReasonError.value = ''
  const request = new AbortController()
  try {
    const response = await advertisingRechargesApi.void(row.id, {
      expectedVersion: row.version,
      reason,
    }, request.signal)
    recharge.value = response.data
    voidOpen.value = false
    toast.success(t('advertisingRecharge.toast.voided'))
  }
  catch (failure) {
    voidReasonError.value = getApiClientFailureMessage(failure, t('advertisingRecharge.error.void'))
  }
  finally {
    voiding.value = false
  }
}

watch(() => [enabled.value, id.value, account.authEpoch] as const, () => {
  void load()
}, { immediate: true })

onMounted(() => {
  active.value = true
})
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
  controller?.abort()
  controller = null
})
onBeforeUnmount(() => {
  active.value = false
  controller?.abort()
  controller = null
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('advertisingRecharge.detail.financeTitle')" :description="t('advertisingRecharge.detail.financeDescription')">
      <div class="flex flex-wrap gap-2">
        <FaButton
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="locked"
          @click="router.push({ name: 'qsFinanceRealtimeAdvertisingRecharges' })"
        >
          <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />
          {{ t('advertisingRecharge.action.backToList') }}
        </FaButton>
        <FaButton variant="outline" class="min-h-11 sm:min-h-9" :disabled="locked" :loading="loading" @click="load">
          <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('advertisingRecharge.action.refresh') }}
        </FaButton>
      </div>
    </FaPageHeader>

    <FaPageMain class="min-w-0" :aria-busy="loading">
      <FaEmpty v-if="!canRead" icon="i-lucide:shield-alert" :title="t('advertisingRecharge.error.noPermission')" class="py-12" />
      <div v-else-if="loading && recharge === null" role="status" class="text-muted-foreground py-12 flex gap-3 items-center justify-center">
        <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" aria-hidden="true" />{{ t('advertisingRecharge.loading') }}
      </div>
      <FaEmpty v-else-if="loadError && recharge === null" icon="i-lucide:triangle-alert" :title="t('advertisingRecharge.error.loadDetail')" :description="loadError" class="py-12">
        <FaButton variant="outline" @click="load">
          {{ t('advertisingRecharge.action.retry') }}
        </FaButton>
      </FaEmpty>

      <div v-else-if="recharge" class="gap-5 grid min-w-0 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section class="p-5 border border-border rounded-xl bg-muted/25 min-w-0 lg:p-6">
          <header class="mb-5 flex flex-wrap gap-3 items-start justify-between">
            <div class="min-w-0">
              <p class="qs-type-meta text-muted-foreground m-0">
                {{ t('advertisingRecharge.field.rechargeNo') }}
              </p>
              <h2 class="text-xl qs-type-data-emphasis leading-7 m-0 mt-1 select-all break-all">
                {{ recharge.rechargeNo }}
              </h2>
            </div>
            <span v-if="statusMeta" class="qs-type-tag px-2 py-0.5 border rounded-md" :class="statusMeta.tagClass">
              {{ t(statusMeta.labelKey) }}
            </span>
          </header>

          <dl class="m-0 gap-x-6 gap-y-5 grid grid-cols-2 max-sm:grid-cols-1">
            <div class="min-w-0">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t('advertisingRecharge.field.adAccountName') }}
              </dt>
              <dd class="qs-type-body-medium m-0 break-words">
                {{ recharge.adAccountName }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t('advertisingRecharge.field.adAccountNo') }}
              </dt>
              <dd class="qs-type-data m-0 break-all">
                {{ recharge.adAccountNo }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t('advertisingRecharge.field.accountType') }}
              </dt>
              <dd class="m-0">
                {{ t(`advertisingRecharge.accountType.${recharge.accountType === 'PERSONAL' ? 'personal' : 'nonPersonal'}`) }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t('advertisingRecharge.field.rechargeAmount') }}
              </dt>
              <dd class="m-0">
                <AmountDisplay :value="recharge.rechargeAmount" :currency="recharge.rechargeCurrency" :currencies="currencyCatalog.currencies.value" />
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t('advertisingRecharge.field.applicant') }}
              </dt>
              <dd class="m-0">
                <QsPersonDisplay :display-name="recharge.applicant.name" size="sm" :avatar-url="recharge.applicant.avatarUrl" />
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t('advertisingRecharge.field.submittedAt') }}
              </dt>
              <dd class="m-0">
                <DateTimeDisplay :value="recharge.submittedAt" format="datetime" />
              </dd>
            </div>
            <div v-if="recharge.remark" class="col-span-full min-w-0">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t('advertisingRecharge.field.remark') }}
              </dt>
              <dd class="qs-type-body m-0 whitespace-pre-wrap break-words">
                {{ recharge.remark }}
              </dd>
            </div>
          </dl>

          <section v-if="recharge.accountType === 'PERSONAL'" class="mt-6 pt-5 border-t border-border">
            <h3 class="qs-type-component-title m-0 mb-3">
              {{ t('advertisingRecharge.field.paymentQr') }}
            </h3>
            <ImageGroup :items="qrItems" :max-count="1" size="lg" />
          </section>

          <section v-if="recharge.payment" class="mt-6 pt-5 border-t border-border">
            <h3 class="qs-type-component-title m-0 mb-3">
              {{ t('advertisingRecharge.detail.payment') }}
            </h3>
            <dl class="m-0 gap-x-6 gap-y-4 grid grid-cols-2 max-sm:grid-cols-1">
              <div class="min-w-0">
                <dt class="qs-type-meta text-muted-foreground mb-1.5">
                  {{ t('advertisingRecharge.field.paymentAmount') }}
                </dt>
                <dd class="m-0">
                  <AmountDisplay :value="recharge.payment.amountCny" currency="CNY" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="qs-type-meta text-muted-foreground mb-1.5">
                  {{ t('advertisingRecharge.field.paidAt') }}
                </dt>
                <dd class="m-0">
                  <DateTimeDisplay :value="recharge.payment.paidAt" format="datetime" />
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="qs-type-meta text-muted-foreground mb-1.5">
                  {{ t('advertisingRecharge.field.paidBy') }}
                </dt>
                <dd class="m-0">
                  <QsPersonDisplay :display-name="recharge.payment.paidBy.name" size="sm" :avatar-url="recharge.payment.paidBy.avatarUrl" />
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="qs-type-meta text-muted-foreground mb-1.5">
                  {{ t('advertisingRecharge.field.fundBatchNo') }}
                </dt>
                <dd class="qs-type-data-mono m-0 break-all">
                  {{ recharge.payment.fundPostingBatchNo ?? t('advertisingRecharge.detail.noValue') }}
                </dd>
              </div>
            </dl>
            <div class="mt-4">
              <ImageGroup :items="proofItems" :max-count="1" size="lg" />
            </div>
          </section>
        </section>

        <section class="p-5 border border-border rounded-xl min-w-0 lg:p-6">
          <template v-if="recharge.status === 'PENDING'">
            <h2 class="qs-type-section-title m-0 mb-4">
              {{ t('advertisingRecharge.detail.paySectionTitle') }}
            </h2>
            <FaAlert v-if="!canPay" :description="t('advertisingRecharge.error.noPayPermission')" class="mb-4" />
            <FaAlert v-if="payError" :description="payError" variant="destructive" class="mb-4" role="alert" />
            <div class="gap-4 grid">
              <div class="flex flex-col gap-1.5">
                <span class="qs-type-meta text-muted-foreground">{{ t('advertisingRecharge.field.paymentAmount') }}</span>
                <MoneyInput
                  v-model="paymentAmount"
                  v-model:currency="paymentCurrency"
                  :currencies="paymentCurrencies"
                  :currency-selectable="false"
                  :disabled="!canPay || paying"
                  min="0.01"
                  autocomplete="off"
                  :aria-label="t('advertisingRecharge.field.paymentAmount')"
                />
                <span class="qs-type-meta text-muted-foreground">{{ t('advertisingRecharge.field.paymentAmountHint') }}</span>
              </div>

              <div class="flex flex-col gap-1.5">
                <span class="qs-type-meta text-muted-foreground">{{ t('advertisingRecharge.detail.paymentProof') }}</span>
                <RechargeImageUpload
                  :key="recharge.id"
                  v-model="proofMediaAssetId"
                  :enabled="canPay && recharge.status === 'PENDING'"
                  :disabled="paying"
                  :upload="uploadProof"
                  :label="t('advertisingRecharge.detail.paymentProof')"
                  :hint="t('advertisingRecharge.detail.paymentProofHint')"
                  @busy-change="uploading = $event"
                />
              </div>
            </div>

            <div class="mt-5 flex flex-wrap gap-2 justify-end">
              <FaButton
                type="button"
                variant="outline"
                class="min-h-11 sm:min-h-9"
                :disabled="!canPay || paying"
                @click="rejectOpen = true"
              >
                {{ t('advertisingRecharge.action.reject') }}
              </FaButton>
              <FaButton
                type="button"
                class="min-h-11 sm:min-h-9"
                :loading="paying"
                :disabled="!canSubmitPayment"
                @click="submitPayment"
              >
                {{ t('advertisingRecharge.action.submitPayment') }}
              </FaButton>
            </div>
          </template>

          <template v-else>
            <h2 class="qs-type-section-title m-0 mb-4">
              {{ t('advertisingRecharge.detail.resultTitle') }}
            </h2>
            <FaAlert v-if="recharge.reject" variant="destructive" :title="t('advertisingRecharge.detail.rejected')" :description="recharge.reject.reason" />
            <FaAlert v-else-if="recharge.void" :title="t('advertisingRecharge.detail.voided')" :description="recharge.void.reason" />
            <FaAlert v-else-if="recharge.withdrawnAt" :title="t('advertisingRecharge.detail.withdrawn')" />
            <template v-else-if="recharge.payment">
              <p class="qs-type-body text-muted-foreground m-0 mb-4">
                {{ t('advertisingRecharge.detail.paidHint') }}
              </p>
              <div class="mb-4 flex flex-wrap gap-2 justify-end">
                <FaButton
                  type="button"
                  variant="destructive"
                  class="min-h-11 sm:min-h-9"
                  :disabled="!canPay || voiding"
                  @click="voidOpen = true"
                >
                  {{ t('advertisingRecharge.action.void') }}
                </FaButton>
              </div>
            </template>
          </template>
        </section>
      </div>
    </FaPageMain>

    <ReasonModal
      v-model="rejectOpen"
      :title="t('advertisingRecharge.action.reject')"
      :description="t('advertisingRecharge.detail.rejectDescription')"
      :label="t('advertisingRecharge.field.rejectReason')"
      :confirm-label="t('advertisingRecharge.action.reject')"
      :submitting="rejecting"
      :error="rejectReasonError || null"
      @confirm="submitReject"
    />
    <ReasonModal
      v-model="voidOpen"
      :title="t('advertisingRecharge.action.void')"
      :description="t('advertisingRecharge.detail.voidDescription')"
      :label="t('advertisingRecharge.field.voidReason')"
      :confirm-label="t('advertisingRecharge.action.void')"
      :submitting="voiding"
      :error="voidReasonError || null"
      @confirm="submitVoid"
    />
  </div>
</template>
