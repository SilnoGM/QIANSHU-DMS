<script setup lang="ts">
import type { InvoiceRequestDto } from '@/api/generated/types.gen'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { resolveInvoiceFailureKey } from '../invoice-failure.logic'
import InvoiceRequestInfo from '../invoice-request-info.vue'
import { buildInvoiceCopyText } from '../invoice-status.logic'

/**
 * 发票审批（审核并通知）三步弹窗：开票信息 → 复制并通知 → 确认已通知。
 *
 * 展示口径与只读详情同源（同一详情接口）；复制文本供线下发给代开票方，
 * 确认动作是服务端唯一的「已通知开票」写入点。
 */
const props = defineProps<{
  readonly id: string | null
  readonly modelValue: boolean
}>()
const emit = defineEmits<{
  'completed': []
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const toast = useQsToast()

const detail = ref<InvoiceRequestDto | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)
const copyState = ref<'copied' | 'failed' | 'idle'>('idle')
const step = ref(0)

const steps = computed(() => [
  t('invoiceRequest.approval.reviewStepInfo'),
  t('invoiceRequest.approval.reviewStepCopy'),
  t('invoiceRequest.approval.reviewStepConfirm'),
].map((title, index) => ({ id: String(index), title })))

async function load(): Promise<void> {
  if (props.id === null) {
    return
  }
  loading.value = true
  loadError.value = null
  detail.value = null
  try {
    const { data } = await invoiceRequestsApi.get(props.id, new AbortController().signal)
    detail.value = data
  }
  catch (error) {
    loadError.value = t(resolveInvoiceFailureKey(error))
  }
  finally {
    loading.value = false
  }
}

watch(() => [props.modelValue, props.id], ([open]) => {
  if (open) {
    step.value = 0
    copyState.value = 'idle'
    submitError.value = null
    void load()
  }
  else {
    detail.value = null
    loadError.value = null
    submitError.value = null
  }
})

async function copyInvoiceInfo(): Promise<void> {
  const request = detail.value
  if (request === null) {
    return
  }
  try {
    await navigator.clipboard.writeText(buildInvoiceCopyText(request))
    copyState.value = 'copied'
  }
  catch {
    // 复制失败不谎报：让财务手动选择文本。
    copyState.value = 'failed'
  }
}

async function confirmNotify(): Promise<void> {
  const request = detail.value
  if (request === null || submitting.value) {
    return
  }
  submitting.value = true
  submitError.value = null
  try {
    await invoiceRequestsApi.notify(request.id, { expectedVersion: request.version }, new AbortController().signal)
    toast.success(t('invoiceRequest.approval.reviewDone'))
    emit('completed')
    emit('update:modelValue', false)
  }
  catch (error) {
    submitError.value = t(resolveInvoiceFailureKey(error))
  }
  finally {
    submitting.value = false
  }
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('invoiceRequest.action.review')"
    :description="detail === null ? undefined : `${detail.invoiceNo} · ${detail.buyerName}`"
    size="xl"
    :loading="loading"
    :error="loadError"
    :submitting="submitting"
    :dismiss-on-escape="!submitting"
    :dismiss-on-overlay="!submitting"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #error-actions>
      <FaButton variant="outline" size="sm" @click="load">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
        {{ t('invoiceRequest.detail.retry') }}
      </FaButton>
    </template>

    <div v-if="detail !== null && loadError === null" class="space-y-5">
      <FaSteps v-model="step" :steps="steps" class="w-full" />

      <FaAlert v-if="submitError !== null" variant="destructive" icon="i-lucide:circle-alert" :title="submitError" role="alert" />

      <template v-if="step === 0">
        <InvoiceRequestInfo :detail="detail" />
      </template>

      <template v-else-if="step === 1">
        <p class="qs-type-body text-muted-foreground m-0">
          {{ t('invoiceRequest.approval.reviewCopyHint') }}
        </p>
        <div class="flex flex-wrap gap-3 items-center">
          <FaButton type="button" variant="outline" size="sm" @click="copyInvoiceInfo">
            <FaIcon name="i-lucide:clipboard-copy" class="size-4" aria-hidden="true" />{{ t('invoiceRequest.approval.copy') }}
          </FaButton>
          <span v-if="copyState === 'copied'" class="qs-type-meta text-primary m-0">{{ t('invoiceRequest.approval.copied') }}</span>
          <span v-if="copyState === 'failed'" role="alert" class="qs-type-meta text-destructive m-0">{{ t('invoiceRequest.approval.copyFailed') }}</span>
        </div>
      </template>

      <template v-else>
        <p class="qs-type-meta m-0">
          {{ t('invoiceRequest.approval.notifyBody') }}
        </p>
      </template>
    </div>

    <template #footer>
      <FaButton v-if="step > 0" type="button" variant="outline" :disabled="submitting" @click="step -= 1">
        {{ t('invoiceRequest.approval.reviewBack') }}
      </FaButton>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="close">
        {{ t('invoiceRequest.common.cancel') }}
      </FaButton>
      <FaButton v-if="step < 2" type="button" :disabled="loading || detail === null || loadError !== null" @click="step += 1">
        {{ t('invoiceRequest.approval.reviewNext') }}
      </FaButton>
      <FaButton v-else type="button" :loading="submitting" :disabled="submitting || detail === null" @click="confirmNotify">
        {{ t('invoiceRequest.approval.reviewConfirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
