<script setup lang="ts">
import { useFileDrop } from '@fantastic-admin/components'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { IMAGE_ONLY_ACCEPT } from '@/utils/upload-policy'
import { withdrawalStatusMeta } from '@/views/operations/personal-finance/withdrawals/status.logic'
import { useWithdrawalReview } from './use-withdrawal-review'

defineOptions({ name: 'FinanceFundWithdrawalApproval' })

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()
const active = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const canReview = computed(() => auth('fund-withdrawals:review'))
// 与付款页同口径：只有当前路由、已登录且持有审批码时才允许加载与提交。
const enabled = computed(() => (
  active.value
  && account.authState === 'authenticated'
  && canReview.value
  && route.name === 'qsFinanceFundWithdrawalApproval'
))
const requestId = computed(() => (
  typeof route.params.id === 'string' && route.params.id.trim().length > 0
    ? route.params.id.trim()
    : null
))
const review = useWithdrawalReview(
  enabled,
  canReview,
  computed(() => account.authEpoch),
  requestId,
)
const {
  detail,
  loading,
  busy,
  uploading,
  stale,
  invalid,
  loadError,
  actionError,
  proofUrl,
  proofLoading,
  proofError,
  previewUrl,
  previewFileName,
  upload,
  rejectReason,
  fieldError,
  pending,
  locked,
  load,
  uploadProof,
  approve,
  reject,
} = review
const canSubmit = computed(() => enabled.value && pending.value && !stale.value && !locked.value)
const approveDisabled = computed(() => !canSubmit.value || upload.value === null)

function chooseFile(): void {
  fileInput.value?.click()
}

function handleFile(event: Event): void {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (file !== undefined) {
    void uploadProof(file)
  }
}

const { handlers: dropHandlers, isDragging } = useFileDrop({
  accept: IMAGE_ONLY_ACCEPT,
  disabled: computed(() => !canSubmit.value),
  onFiles: (files) => {
    const file = files[0]
    if (file !== undefined) {
      void uploadProof(file)
    }
  },
  onInvalid: () => {
    fieldError.value = 'proof'
  },
})

function openList(): void {
  void router.push({ name: 'qsFinanceFundWithdrawalApprovals' })
}

async function approveWithdrawal(): Promise<void> {
  if (await approve()) {
    toast.success(t('fundWithdrawal.approve.success'))
  }
}

async function rejectWithdrawal(): Promise<void> {
  if (await reject()) {
    toast.success(t('fundWithdrawal.reject.success'))
  }
}

/** 通过/驳回都在扣款链路上，提交中离开会让用户不知道结果，直接拦住。 */
function canLeave(): boolean {
  if (enabled.value && locked.value) {
    toast.warning(t('fundWithdrawal.approvalDetail.leaveBlocked'))
    return false
  }
  return true
}

function beforeUnload(event: BeforeUnloadEvent): void {
  if (enabled.value && locked.value) {
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
    <FaPageHeader
      :title="t('fundWithdrawal.approvalDetailTitle')"
      :description="t('fundWithdrawal.approvalDetailDescription')"
    >
      <div class="gap-2 grid grid-cols-2 sm:flex sm:w-auto">
        <FaButton variant="outline" :disabled="locked" class="min-h-11 sm:min-h-9" @click="openList">
          <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('fundWithdrawal.approvalDetail.backToList') }}
        </FaButton>
        <FaButton v-if="canReview" variant="outline" :disabled="locked" :loading="loading" class="min-h-11 sm:min-h-9" @click="load">
          <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('fundWithdrawal.approvalDetail.refresh') }}
        </FaButton>
      </div>
    </FaPageHeader>
    <FaPageMain main-class="sm:p-5" :aria-busy="loading">
      <FaEmpty v-if="!canReview" icon="i-lucide:shield-alert" :title="t('fundWithdrawal.approvalDetail.noPermission')" class="py-12" />
      <div v-else-if="loading" role="status" class="text-muted-foreground py-12 flex gap-3 items-center justify-center">
        <FaIcon name="i-lucide:loader-circle" class="size-5 animate-spin" aria-hidden="true" />{{ t('fundWithdrawal.loading') }}
      </div>
      <FaEmpty v-else-if="requestId === null" icon="i-lucide:link-2-off" :title="t('fundWithdrawal.approvalDetail.invalidLink')" :description="t('fundWithdrawal.approvalDetail.invalidLinkDescription')" class="py-12" />
      <FaEmpty v-else-if="invalid" icon="i-lucide:link-2-off" :title="t('fundWithdrawal.approvalDetail.notFound')" class="py-12" />
      <FaEmpty v-else-if="loadError" icon="i-lucide:triangle-alert" :title="t('fundWithdrawal.approvalDetail.loadFailed')" :description="loadError" class="py-12">
        <FaButton variant="outline" @click="load">
          {{ t('fundWithdrawal.approvalDetail.retry') }}
        </FaButton>
      </FaEmpty>
      <div v-else-if="detail && enabled" class="gap-5 grid min-w-0 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start">
        <div class="min-w-0 space-y-5">
          <section :aria-label="t('fundWithdrawal.approvalDetail.requestInformation')" class="min-w-0">
            <div class="flex flex-wrap gap-x-4 gap-y-2 items-center justify-between">
              <h2 class="qs-type-component-title m-0 flex gap-2 items-center">
                <FaIcon name="i-lucide:banknote" class="size-4" aria-hidden="true" />{{ t('fundWithdrawal.column.withdrawalNo') }}
              </h2>
              <span class="qs-type-tag px-2 py-0.5 border rounded-md" :class="withdrawalStatusMeta(detail.status).tagClass">
                {{ t(withdrawalStatusMeta(detail.status).labelKey) }}
              </span>
            </div>
            <p class="text-lg qs-type-data-emphasis mb-0 mt-1 select-all break-all">
              {{ detail.withdrawalNo }}
            </p>
            <div class="mt-4">
              <p class="qs-type-meta text-muted-foreground m-0">
                {{ t('fundWithdrawal.detail.amount') }}
              </p>
              <div
                tabindex="0"
                role="group"
                :aria-label="t('fundWithdrawal.detail.amount')"
                class="fund-withdrawal-amount py-1 flex max-w-full overflow-x-auto"
              >
                <AmountDisplay :value="detail.amount" :currency="detail.currency" :currencies="currencyCatalog.currencies.value" />
              </div>
            </div>
            <dl class="m-0 mt-4 gap-4 grid sm:grid-cols-2">
              <div class="min-w-0">
                <dt class="qs-type-meta text-muted-foreground mb-1.5">
                  {{ t('fundWithdrawal.detail.applicant') }}
                </dt>
                <dd class="m-0 flex flex-wrap gap-2 items-center">
                  <QsPersonDisplay :display-name="detail.applicantName" size="sm" :avatar-url="detail.applicantAvatarUrl" />
                  <span class="qs-type-meta text-muted-foreground break-all">{{ detail.applicantUsername }}</span>
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="qs-type-meta text-muted-foreground mb-1.5">
                  {{ t('fundWithdrawal.detail.accountBalance') }}
                </dt>
                <dd class="m-0">
                  <AmountDisplay :value="detail.accountBalance" :currency="detail.currency" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="qs-type-meta text-muted-foreground mb-1.5">
                  {{ t('fundWithdrawal.detail.submittedAt') }}
                </dt>
                <dd class="m-0">
                  <DateTimeDisplay :value="detail.submittedAt" format="datetime" />
                </dd>
              </div>
            </dl>
          </section>

          <section :aria-label="t('fundWithdrawal.approvalDetail.proof')" class="pt-5 border-t border-border min-w-0">
            <h2 class="qs-type-component-title m-0 mb-4">
              {{ t('fundWithdrawal.approvalDetail.proof') }}
            </h2>
            <template v-if="pending">
              <p class="qs-type-meta text-muted-foreground m-0">
                {{ t('fundWithdrawal.approve.proofHint') }}
              </p>
              <div
                v-bind="dropHandlers"
                class="mt-3 p-2 rounded-xl transition-shadow duration-150"
                :class="isDragging ? 'ring-2 ring-primary/40 ring-offset-2 bg-primary/5' : ''"
              >
                <input
                  ref="fileInput"
                  class="sr-only"
                  type="file"
                  :accept="IMAGE_ONLY_ACCEPT"
                  @change="handleFile"
                >
                <div v-if="previewUrl === null" class="p-6 border border-border rounded-xl border-dashed flex min-h-32 items-center justify-center">
                  <FaButton type="button" variant="outline" :loading="uploading" :disabled="!canSubmit" @click="chooseFile">
                    <FaIcon name="i-lucide:upload" aria-hidden="true" />{{ t('fundWithdrawal.approvalDetail.chooseProof') }}
                  </FaButton>
                </div>
                <div v-else class="gap-3 grid">
                  <img :src="previewUrl" :alt="previewFileName" class="mx-auto border border-border rounded-xl max-h-[60vh] max-w-full object-contain">
                  <div class="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:items-center sm:justify-between">
                    <p class="qs-type-meta text-muted-foreground m-0 break-all">
                      {{ previewFileName }}
                    </p>
                    <FaButton type="button" variant="outline" size="sm" class="min-h-9" :disabled="!canSubmit" @click="chooseFile">
                      {{ t('fundWithdrawal.approvalDetail.replaceProof') }}
                    </FaButton>
                  </div>
                </div>
              </div>
              <p v-if="fieldError === 'proof'" role="alert" class="qs-type-meta text-destructive m-0 mt-2">
                {{ t('fundWithdrawal.approve.proofRequired') }}
              </p>
            </template>
            <template v-else>
              <div v-if="proofLoading" class="rounded-xl bg-muted aspect-4/3 animate-pulse" role="status" :aria-label="t('fundWithdrawal.approvalDetail.proof')" />
              <FaAlert v-else-if="proofError" variant="destructive" :title="t('fundWithdrawal.error.proof')" role="alert" />
              <img
                v-else-if="proofUrl"
                :src="proofUrl"
                :alt="detail.paymentProof?.fileName ?? t('fundWithdrawal.approvalDetail.proof')"
                class="mx-auto border border-border rounded-xl max-h-[60vh] max-w-full object-contain"
              >
              <div v-else class="p-6 border border-border rounded-xl border-dashed flex min-h-32 items-center justify-center">
                <p class="qs-type-meta text-muted-foreground m-0">
                  {{ t('fundWithdrawal.approvalDetail.noProof') }}
                </p>
              </div>
              <p v-if="detail.paymentProof" class="qs-type-meta text-muted-foreground m-0 mt-2 break-all">
                {{ detail.paymentProof.fileName }}
              </p>
            </template>
          </section>
        </div>

        <section
          :aria-label="t('fundWithdrawal.approvalDetail.action')"
          class="pt-5 border-t border-border min-w-0 lg:pl-6 lg:pt-0 lg:border-l lg:border-t-0"
        >
          <h2 class="qs-type-component-title m-0 mb-4">
            {{ t(pending ? 'fundWithdrawal.approvalDetail.action' : 'fundWithdrawal.approvalDetail.result') }}
          </h2>
          <div aria-live="polite" class="space-y-3">
            <FaAlert v-if="actionError" variant="destructive" :title="t('fundWithdrawal.error.approve')" :description="actionError" />
            <FaAlert v-if="stale" :title="t('fundWithdrawal.approvalDetail.staleTitle')" :description="t('fundWithdrawal.approvalDetail.staleHint')" />
            <FaAlert v-if="!pending" :title="t('fundWithdrawal.approvalDetail.alreadyHandled')" class="text-primary border-primary/35 bg-primary/5 dark:text-emerald-300" />
          </div>
          <template v-if="pending">
            <p class="qs-type-meta text-muted-foreground m-0 mt-4">
              {{ t('fundWithdrawal.approve.negativeHint') }}
            </p>
            <div class="mt-5">
              <FaButton v-if="stale" variant="outline" class="min-h-11 w-full" :disabled="locked" @click="load">
                <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('fundWithdrawal.approvalDetail.recheck') }}
              </FaButton>
              <FaButton v-else type="button" class="min-h-11 w-full" :disabled="approveDisabled" :loading="busy" @click="approveWithdrawal">
                {{ t('fundWithdrawal.action.approve') }}
              </FaButton>
            </div>
            <div class="mt-6 pt-5 border-t border-border space-y-3">
              <h3 class="qs-type-component-title m-0">
                {{ t('fundWithdrawal.reject.title') }}
              </h3>
              <p class="qs-type-meta text-muted-foreground m-0">
                {{ t('fundWithdrawal.approvalDetail.rejectHint') }}
              </p>
              <FaForm :model="{ rejectReason }" :disabled="!canSubmit">
                <FaFormItem name="rejectReason" :label="t('fundWithdrawal.reject.reason')" required>
                  <FaTextarea
                    v-model="rejectReason"
                    class="w-full"
                    input-class="min-h-24 max-h-44"
                    maxlength="500"
                    :placeholder="t('fundWithdrawal.reject.reasonPlaceholder')"
                    :disabled="!canSubmit"
                    @update:model-value="fieldError = null"
                  />
                </FaFormItem>
              </FaForm>
              <p v-if="fieldError === 'reason'" role="alert" class="qs-type-meta text-destructive m-0">
                {{ t('fundWithdrawal.reject.reasonPlaceholder') }}
              </p>
              <FaButton
                type="button"
                variant="outline"
                class="text-destructive min-h-11 w-full"
                :loading="busy"
                :disabled="!canSubmit || rejectReason.trim() === ''"
                @click="rejectWithdrawal"
              >
                {{ t('fundWithdrawal.action.reject') }}
              </FaButton>
            </div>
          </template>
          <dl v-else class="m-0 mt-4 gap-4 grid lg:grid-cols-1 sm:grid-cols-2">
            <div class="min-w-0">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t('fundWithdrawal.detail.reviewer') }}
              </dt>
              <dd class="m-0">
                <QsPersonDisplay v-if="detail.reviewerName" :display-name="detail.reviewerName" size="sm" :avatar-url="detail.reviewerAvatarUrl" />
                <span v-else class="qs-type-meta">{{ t('fundWithdrawal.detail.noValue') }}</span>
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t('fundWithdrawal.detail.reviewedAt') }}
              </dt>
              <dd class="m-0">
                <DateTimeDisplay v-if="detail.reviewedAt" :value="detail.reviewedAt" format="datetime" />
                <span v-else class="qs-type-meta">{{ t('fundWithdrawal.detail.noValue') }}</span>
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t('fundWithdrawal.detail.batchNo') }}
              </dt>
              <dd class="font-qs-data-mono m-0">
                {{ detail.fundPostingBatchNo ?? t('fundWithdrawal.detail.noValue') }}
              </dd>
            </div>
            <div v-if="detail.status === 'REJECTED'" class="min-w-0 lg:col-span-1 sm:col-span-2">
              <dt class="qs-type-meta text-muted-foreground mb-1.5">
                {{ t('fundWithdrawal.detail.rejectReason') }}
              </dt>
              <dd class="m-0 whitespace-pre-wrap break-words">
                {{ detail.rejectReason ?? t('fundWithdrawal.detail.noValue') }}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </FaPageMain>
  </div>
</template>

<style scoped>
.fund-withdrawal-amount :deep([data-currency]) {
  font-size: var(--qs-type-size-2xl);
  font-weight: var(--qs-type-weight-semibold);
  line-height: var(--qs-type-leading-2xl);
}
</style>
