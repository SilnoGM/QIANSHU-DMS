<script setup lang="ts">
import type { FundWithdrawalDto, FundWithdrawalProofUploadDto } from '@/api/generated/types.gen'
import { getApiClientErrorMessage } from '@/api/errors'
import fundWithdrawalsApi from '@/api/modules/fund-withdrawals'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { IMAGE_ONLY_ACCEPT } from '@/utils/upload-policy'

defineOptions({ name: 'FundWithdrawalApproveModal' })

const props = defineProps<{
  modelValue: boolean
  request: FundWithdrawalDto | null
}>()

const emit = defineEmits<{
  'completed': []
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const fileInput = ref<HTMLInputElement | null>(null)
const upload = ref<FundWithdrawalProofUploadDto | null>(null)
const previewUrl = ref<string | null>(null)
const uploading = ref(false)
const submitting = ref(false)
const error = ref('')
let uploadController: AbortController | null = null

const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']

function releasePreview(): void {
  if (previewUrl.value !== null) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
}

function reset(): void {
  uploadController?.abort()
  uploadController = null
  upload.value = null
  uploading.value = false
  submitting.value = false
  error.value = ''
  releasePreview()
  if (fileInput.value !== null) {
    fileInput.value.value = ''
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    reset()
  }
  else {
    uploadController?.abort()
    uploadController = null
    releasePreview()
  }
})

onBeforeUnmount(() => {
  uploadController?.abort()
  releasePreview()
})

function chooseFile(): void {
  fileInput.value?.click()
}

async function handleFile(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (file === undefined || props.request === null) {
    return
  }
  if (!allowedTypes.includes(file.type)) {
    error.value = t('fundWithdrawal.approve.proofHint')
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    error.value = t('fundWithdrawal.approve.proofHint')
    return
  }
  error.value = ''
  releasePreview()
  previewUrl.value = URL.createObjectURL(file)
  uploadController?.abort()
  const controller = new AbortController()
  uploadController = controller
  uploading.value = true
  upload.value = null
  try {
    const response = await fundWithdrawalsApi.uploadProof(props.request.id, file, controller.signal)
    if (!controller.signal.aborted && uploadController === controller) {
      upload.value = response.data
    }
  }
  catch (failure) {
    if (!controller.signal.aborted && uploadController === controller) {
      error.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
        || t('fundWithdrawal.error.upload')
      releasePreview()
    }
  }
  finally {
    if (uploadController === controller) {
      uploading.value = false
      uploadController = null
    }
  }
}

async function submit(): Promise<void> {
  const request = props.request
  if (request === null || submitting.value || uploading.value) {
    return
  }
  if (upload.value === null) {
    error.value = t('fundWithdrawal.approve.proofRequired')
    return
  }
  submitting.value = true
  error.value = ''
  let succeeded = false
  try {
    await fundWithdrawalsApi.approve(request.id, {
      expectedVersion: request.version,
      paymentProofMediaAssetId: upload.value.mediaAssetId,
    }, new AbortController().signal)
    succeeded = true
  }
  catch (failure) {
    error.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
      || t('fundWithdrawal.error.approve')
  }
  finally {
    submitting.value = false
  }
  if (succeeded) {
    toast.success(t('fundWithdrawal.approve.success'))
    emit('completed')
    emit('update:modelValue', false)
  }
}

function close(): void {
  if (!submitting.value) {
    emit('update:modelValue', false)
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('fundWithdrawal.approve.title')"
    :description="request?.withdrawalNo"
    size="md"
    :submitting="submitting"
    :dismiss-on-escape="!submitting"
    :dismiss-on-overlay="!submitting"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="releasePreview"
  >
    <div v-if="request !== null" class="gap-4 grid">
      <section class="p-4 border border-border rounded-xl bg-muted/25">
        <dl class="m-0 gap-x-6 gap-y-3 grid grid-cols-2 max-sm:grid-cols-1">
          <div>
            <dt class="qs-type-compact-label">
              {{ t('fundWithdrawal.detail.applicant') }}
            </dt>
            <dd class="qs-type-body-strong m-0 flex flex-wrap gap-2 items-center">
              <QsPersonDisplay :display-name="request.applicantName" size="sm" :avatar-url="request.applicantAvatarUrl" />
              <span class="qs-type-meta text-muted-foreground">（{{ request.applicantUsername }}）</span>
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
        </dl>
        <p class="qs-type-meta text-muted-foreground m-0 mt-3">
          {{ t('fundWithdrawal.approve.negativeHint') }}
        </p>
      </section>

      <FaAlert v-if="error !== ''" variant="destructive" :title="error" role="alert" />

      <section aria-labelledby="fund-withdrawal-proof-upload-title">
        <h3 id="fund-withdrawal-proof-upload-title" class="qs-type-component-title m-0 mb-2">
          {{ t('fundWithdrawal.approve.proof') }}
        </h3>
        <p class="qs-type-meta text-muted-foreground m-0 mb-3">
          {{ t('fundWithdrawal.approve.proofHint') }}
        </p>
        <input
          ref="fileInput"
          class="sr-only"
          type="file"
          :accept="IMAGE_ONLY_ACCEPT"
          @change="handleFile"
        >
        <div v-if="previewUrl === null" class="p-6 text-center border border-border rounded-xl border-dashed">
          <FaButton type="button" variant="outline" :loading="uploading" @click="chooseFile">
            <FaIcon name="i-lucide:upload" aria-hidden="true" />
            {{ t('fundWithdrawal.approve.proof') }}
          </FaButton>
        </div>
        <div v-else class="gap-3 grid">
          <img :src="previewUrl" :alt="upload?.fileName ?? t('fundWithdrawal.approve.proof')" class="mx-auto border border-border rounded-xl max-h-72 max-w-full object-contain">
          <div class="flex flex-wrap gap-3 items-center justify-between">
            <p class="qs-type-meta text-muted-foreground m-0 break-all">
              {{ upload?.fileName ?? t('fundWithdrawal.loading') }}
            </p>
            <div class="flex gap-2">
              <FaButton type="button" variant="outline" size="sm" :disabled="uploading || submitting" @click="chooseFile">
                {{ t('fundWithdrawal.action.changeProof') }}
              </FaButton>
            </div>
          </div>
        </div>
      </section>
    </div>

    <template #footer>
      <FaButton type="button" variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="submitting" @click="close">
        {{ t('fundWithdrawal.action.cancel') }}
      </FaButton>
      <FaButton type="button" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="submitting" :disabled="submitting || uploading || upload === null" @click="submit">
        {{ t('fundWithdrawal.action.submit') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
