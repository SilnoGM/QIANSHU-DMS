<script setup lang="ts">
import type { FundWithdrawalDto } from '@/api/generated/types.gen'
import { getApiClientErrorMessage } from '@/api/errors'
import fundWithdrawalsApi from '@/api/modules/fund-withdrawals'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

defineOptions({ name: 'FundWithdrawalRejectModal' })

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
const reason = ref('')
const submitting = ref(false)
const error = ref('')

watch(() => props.modelValue, (open) => {
  if (open) {
    reason.value = ''
    error.value = ''
    submitting.value = false
  }
})

async function submit(): Promise<void> {
  const request = props.request
  if (request === null || submitting.value) {
    return
  }
  const trimmed = reason.value.trim()
  if (trimmed === '') {
    error.value = t('fundWithdrawal.reject.reasonPlaceholder')
    return
  }
  submitting.value = true
  error.value = ''
  let succeeded = false
  try {
    await fundWithdrawalsApi.reject(request.id, {
      expectedVersion: request.version,
      reason: trimmed,
    }, new AbortController().signal)
    succeeded = true
  }
  catch (failure) {
    error.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
      || t('fundWithdrawal.error.reject')
  }
  finally {
    submitting.value = false
  }
  if (succeeded) {
    toast.success(t('fundWithdrawal.reject.success'))
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
    :title="t('fundWithdrawal.reject.title')"
    :description="request?.withdrawalNo"
    size="sm"
    :submitting="submitting"
    :dismiss-on-escape="!submitting"
    :dismiss-on-overlay="!submitting"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <FaAlert v-if="error !== ''" variant="destructive" :title="error" class="mb-4" role="alert" />
    <FaForm :model="{ reason }" @submit="submit">
      <FaFormItem
        name="reason"
        :label="t('fundWithdrawal.reject.reason')"
        required
      >
        <FaTextarea
          v-model="reason"
          class="w-full"
          input-class="min-h-24 max-h-44"
          maxlength="500"
          :placeholder="t('fundWithdrawal.reject.reasonPlaceholder')"
          @update:model-value="error = ''"
        />
      </FaFormItem>
    </FaForm>

    <template #footer>
      <FaButton type="button" variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="submitting" @click="close">
        {{ t('fundWithdrawal.action.cancel') }}
      </FaButton>
      <FaButton type="button" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="submitting" :disabled="submitting || reason.trim() === ''" @click="submit">
        {{ t('fundWithdrawal.action.submit') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
