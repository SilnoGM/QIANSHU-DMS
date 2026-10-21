<script setup lang="ts">
import type { FundWithdrawalDto } from '@/api/generated/types.gen'
import fundWithdrawalsApi from '@/api/modules/fund-withdrawals'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { withdrawalStatusMeta } from './status.logic'

defineOptions({ name: 'FundWithdrawalDetailDrawer' })

const props = defineProps<{
  modelValue: boolean
  request: FundWithdrawalDto | null
  scope: 'review' | 'self'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()
const proofUrl = ref<string | null>(null)
const proofError = ref('')
const proofLoading = ref(false)
let proofController: AbortController | null = null

function releaseProof(): void {
  if (proofUrl.value !== null) {
    URL.revokeObjectURL(proofUrl.value)
    proofUrl.value = null
  }
  proofController?.abort()
  proofController = null
  proofLoading.value = false
  proofError.value = ''
}

async function loadProof(): Promise<void> {
  const request = props.request
  if (request === null || request.paymentProof === null) {
    return
  }
  releaseProof()
  const controller = new AbortController()
  proofController = controller
  proofLoading.value = true
  try {
    const response = props.scope === 'review'
      ? await fundWithdrawalsApi.proofReview(request.id, controller.signal)
      : await fundWithdrawalsApi.proofSelf(request.id, controller.signal)
    if (!controller.signal.aborted && proofController === controller) {
      proofUrl.value = URL.createObjectURL(response.data)
    }
  }
  catch {
    if (!controller.signal.aborted && proofController === controller) {
      proofError.value = t('fundWithdrawal.error.proof')
    }
  }
  finally {
    if (proofController === controller) {
      proofLoading.value = false
      proofController = null
    }
  }
}

watch(() => [props.modelValue, props.request?.id], ([open]) => {
  if (open) {
    void loadProof()
    return
  }
  releaseProof()
})

onBeforeUnmount(releaseProof)

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue"
    :title="t('fundWithdrawal.detail.title')"
    :description="request?.withdrawalNo ?? undefined"
    size="lg"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="releaseProof"
  >
    <div v-if="request !== null" class="gap-5 grid">
      <section class="p-4 border border-border rounded-xl bg-muted/25">
        <div class="mb-3 flex flex-wrap gap-2 items-center justify-between">
          <span
            class="qs-type-tag px-2 py-0.5 border rounded-md"
            :class="withdrawalStatusMeta(request.status).tagClass"
          >
            {{ t(withdrawalStatusMeta(request.status).labelKey) }}
          </span>
          <span class="font-qs-data-mono qs-type-meta">{{ request.withdrawalNo }}</span>
        </div>
        <dl class="m-0 gap-x-6 gap-y-3 grid grid-cols-2 max-sm:grid-cols-1">
          <div>
            <dt class="qs-type-compact-label">
              {{ t('fundWithdrawal.detail.applicant') }}
            </dt>
            <dd class="m-0">
              <QsPersonDisplay :display-name="request.applicantName" size="sm" :avatar-url="request.applicantAvatarUrl" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('fundWithdrawal.detail.amount') }}
            </dt>
            <dd class="m-0">
              <AmountDisplay :value="request.amount" :currency="request.currency" :currencies="currencyCatalog.currencies.value" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('fundWithdrawal.detail.accountBalance') }}
            </dt>
            <dd class="m-0">
              <AmountDisplay :value="request.accountBalance" :currency="request.currency" :currencies="currencyCatalog.currencies.value" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('fundWithdrawal.detail.submittedAt') }}
            </dt>
            <dd class="m-0">
              <DateTimeDisplay :value="request.submittedAt" format="datetime" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('fundWithdrawal.detail.reviewedAt') }}
            </dt>
            <dd class="m-0">
              <DateTimeDisplay v-if="request.reviewedAt" :value="request.reviewedAt" format="datetime" />
              <span v-else class="qs-type-meta">{{ t('fundWithdrawal.detail.noValue') }}</span>
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('fundWithdrawal.detail.reviewer') }}
            </dt>
            <dd class="m-0">
              <QsPersonDisplay v-if="request.reviewerName" :display-name="request.reviewerName" size="sm" :avatar-url="request.reviewerAvatarUrl" />
              <span v-else class="qs-type-meta">{{ t('fundWithdrawal.detail.noValue') }}</span>
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label">
              {{ t('fundWithdrawal.detail.batchNo') }}
            </dt>
            <dd class="qs-type-data-mono m-0">
              {{ request.fundPostingBatchNo ?? t('fundWithdrawal.detail.noValue') }}
            </dd>
          </div>
          <div v-if="request.status === 'REJECTED'" class="col-span-full">
            <dt class="qs-type-compact-label">
              {{ t('fundWithdrawal.detail.rejectReason') }}
            </dt>
            <dd class="qs-type-body m-0 break-words">
              {{ request.rejectReason ?? t('fundWithdrawal.detail.noValue') }}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="fund-withdrawal-proof-title">
        <h3 id="fund-withdrawal-proof-title" class="qs-type-component-title m-0 mb-3">
          {{ t('fundWithdrawal.detail.proof') }}
        </h3>
        <div v-if="request.paymentProof == null" class="p-6 text-center border border-border rounded-xl border-dashed">
          <p class="qs-type-meta text-muted-foreground m-0">
            {{ t('fundWithdrawal.detail.noProof') }}
          </p>
        </div>
        <div v-else class="gap-3 grid">
          <p class="qs-type-meta text-muted-foreground m-0 break-all">
            {{ request.paymentProof?.fileName }}
          </p>
          <div v-if="proofLoading" class="rounded-xl bg-muted h-52 animate-pulse" role="status" :aria-label="t('fundWithdrawal.loading')" />
          <FaAlert v-else-if="proofError" variant="destructive" :title="proofError" role="alert" />
          <img
            v-else-if="proofUrl"
            :src="proofUrl"
            :alt="request.paymentProof?.fileName ?? t('fundWithdrawal.detail.proof')"
            class="mx-auto border border-border rounded-xl max-h-96 max-w-full object-contain"
          >
        </div>
      </section>
    </div>

    <template #footer>
      <FaButton type="button" variant="outline" class="w-full md:w-auto" @click="close">
        {{ t('fundWithdrawal.action.close') }}
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
