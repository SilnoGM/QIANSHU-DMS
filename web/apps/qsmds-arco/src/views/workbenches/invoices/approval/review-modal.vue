<script setup lang="ts">
import type { InvoiceRequestDto } from '@/api/generated/types.gen'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
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
    submitError.value = null
    void load()
  }
  else {
    detail.value = null
    loadError.value = null
    submitError.value = null
  }
})

/**
 * 第二步的复制文本：展示与写入剪贴板必须同一来源，避免屏幕上看到的
 * 与复制出去的文本不一致。
 */
const copyText = computed(() => detail.value === null ? '' : buildInvoiceCopyText(detail.value))

/**
 * 第二步的主按钮＝复制并前进：复制是线下通知的工具；复制失败不拦路，
 * 只用 toast 提示手动选择（第二步内容区展示全文，可直接选中）。
 */
async function copyAndAdvance(): Promise<void> {
  if (copyText.value === '') {
    return
  }
  try {
    await navigator.clipboard.writeText(copyText.value)
    toast.success(t('invoiceRequest.approval.copied'))
  }
  catch {
    toast.error(t('invoiceRequest.approval.copyFailed'))
  }
  step.value = 2
}

async function confirmNotify(): Promise<void> {
  const request = detail.value
  if (request === null || submitting.value) {
    return
  }
  submitting.value = true
  submitError.value = null
  let succeeded = false
  try {
    await invoiceRequestsApi.notify(request.id, { expectedVersion: request.version }, new AbortController().signal)
    succeeded = true
  }
  catch (error) {
    submitError.value = t(resolveInvoiceFailureKey(error))
  }
  finally {
    submitting.value = false
  }
  // 关闭必须晚于释放 submitting：QsGenericModal 在提交期拒绝受控关闭并回写 true
  // （与 approval/index.vue 的 submitAction 同一约束），先关后放会被守卫弹回去。
  if (succeeded) {
    toast.success(t('invoiceRequest.approval.reviewDone'))
    emit('completed')
    emit('update:modelValue', false)
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

      <FaAlert
        v-if="detail.duplicateSuspected === true"
        icon="i-lucide:triangle-alert"
        :title="t('invoiceRequest.duplicate.title')"
        class="text-amber-700 border-amber-500/30 bg-amber-500/5 dark:text-amber-300"
      >
        <template #description>
          <p class="m-0">
            {{ t('invoiceRequest.duplicate.description') }}
          </p>
          <ul v-if="detail.duplicateSuspects?.length" class="m-0 mt-2 pl-4 space-y-1">
            <li v-for="suspect in detail.duplicateSuspects" :key="suspect.invoiceNo">
              {{ t('invoiceRequest.duplicate.item', {
                invoiceNo: suspect.invoiceNo,
                status: t(`invoiceRequest.status.${suspect.status}`),
                date: suspect.createdAt.slice(0, 10),
              }) }}
            </li>
          </ul>
        </template>
      </FaAlert>

      <FaAlert v-if="submitError !== null" variant="destructive" icon="i-lucide:circle-alert" :title="submitError" role="alert" />

      <template v-if="step === 0">
        <InvoiceRequestInfo :detail="detail" />
      </template>

      <template v-else-if="step === 1">
        <div class="min-w-0 space-y-3">
          <p class="qs-type-body text-muted-foreground m-0">
            {{ t('invoiceRequest.approval.reviewCopyHint') }}
          </p>
          <div class="p-4 rounded-lg bg-muted/50 relative">
            <span class="right-2 top-2 absolute">
              <CopyCellButton :always-visible="true" :label="t('invoiceRequest.approval.copyLabel')" :text="copyText" />
            </span>
            <pre class="text-sm m-0 pr-9 whitespace-pre-wrap [overflow-wrap:anywhere]">{{ copyText }}</pre>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="flex gap-3 items-start">
          <span class="text-primary rounded-lg bg-primary/10 flex shrink-0 size-9 items-center justify-center">
            <FaIcon name="i-lucide:send" class="size-5" aria-hidden="true" />
          </span>
          <div class="min-w-0 space-y-1">
            <h3 class="qs-type-component-title m-0">
              {{ t('invoiceRequest.approval.reviewConfirmTitle') }}
            </h3>
            <p class="qs-type-description text-muted-foreground m-0">
              {{ t('invoiceRequest.approval.reviewConfirmHint') }}
            </p>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <FaButton v-if="step > 0" type="button" variant="outline" :disabled="submitting" @click="step -= 1">
        {{ t('invoiceRequest.approval.reviewBack') }}
      </FaButton>
      <FaButton v-if="step !== 1" type="button" variant="outline" :disabled="submitting" @click="close">
        {{ t('invoiceRequest.common.cancel') }}
      </FaButton>
      <FaButton v-if="step === 0" type="button" :disabled="loading || detail === null || loadError !== null" @click="step += 1">
        {{ t('invoiceRequest.approval.reviewNext') }}
      </FaButton>
      <FaButton v-else-if="step === 1" type="button" :disabled="detail === null" @click="copyAndAdvance">
        <FaIcon name="i-lucide:clipboard-copy" class="size-4" aria-hidden="true" />{{ t('invoiceRequest.approval.copy') }}
      </FaButton>
      <FaButton v-else type="button" :loading="submitting" :disabled="submitting || detail === null" @click="confirmNotify">
        {{ t('invoiceRequest.approval.reviewConfirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
