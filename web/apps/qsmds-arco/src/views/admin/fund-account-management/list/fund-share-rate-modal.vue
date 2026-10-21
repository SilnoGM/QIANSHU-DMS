<script setup lang="ts">
import type {
  FundAccountDto,
  UpdateFundShareRateRequestDto,
} from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'

import { buildFundShareRateRequest } from '../shared/fund-money.logic'
import { formatFundShareRate } from './fund-account-list.logic'

defineOptions({ name: 'FundShareRateModal' })

const props = withDefaults(defineProps<{
  account: FundAccountDto | null
  error?: null | string
  modelValue: boolean
  requestId?: null | string
  submitting?: boolean
}>(), {
  error: null,
  requestId: null,
  submitting: false,
})

const emit = defineEmits<{
  'submit': [payload: UpdateFundShareRateRequestDto]
  'update:modelValue': [value: boolean]
}>()

const userShareRate = ref('')
const reason = ref('')
const localError = ref('')
const submitRequested = ref(false)
const locked = computed(() => props.submitting || submitRequested.value)

function resetForm(): void {
  userShareRate.value = props.account?.userShareRate ?? ''
  reason.value = ''
  localError.value = ''
  submitRequested.value = false
}

function close(): void {
  if (!locked.value) {
    emit('update:modelValue', false)
  }
}

function updateVisible(visible: boolean): void {
  if (visible) {
    emit('update:modelValue', true)
  }
  else {
    close()
  }
}

async function submit(): Promise<void> {
  if (locked.value || props.account?.ownerType !== 'USER') {
    return
  }
  try {
    const payload = buildFundShareRateRequest(
      userShareRate.value,
      props.account.version,
      reason.value,
    )
    localError.value = ''
    submitRequested.value = true
    emit('submit', payload)
    await nextTick()
    if (!props.submitting) {
      submitRequested.value = false
    }
  }
  catch (error) {
    localError.value = error instanceof RangeError
      ? error.message
      : '比例修改信息无效，请检查后重试'
  }
}

watch(
  [() => props.modelValue, () => props.account?.id],
  ([visible]) => {
    if (visible) {
      resetForm()
    }
    else {
      localError.value = ''
      submitRequested.value = false
    }
  },
)

watch(() => props.submitting, (submitting) => {
  if (!submitting) {
    submitRequested.value = false
  }
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="修改分成比例"
    :description="account?.user?.displayName ?? '用户账户不可用'"
    size="md"
    :submitting="locked"
    @update:model-value="updateVisible"
  >
    <template #description>
      <QsPersonDisplay v-if="account?.user" :display-name="account.user.displayName" size="sm" :avatar-url="account.user.avatarUrl" />
      <span v-else>用户账户不可用</span>
    </template>
    <FaAlert
      icon="i-lucide:info"
      title="只影响未来动账"
      description="新比例不会改写历史批次、流水或已保存的比例快照。"
      class="mb-4"
    />

    <FaAlert
      v-if="error || localError"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="保存失败"
      class="mb-4"
      role="alert"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ localError || error }}</span>
          <code v-if="requestId" class="qs-type-meta break-all">requestId: {{ requestId }}</code>
        </div>
      </template>
    </FaAlert>

    <dl class="m-0 mb-5 p-4 border border-border rounded-lg bg-muted/30 gap-4 grid grid-cols-2">
      <div>
        <dt class="qs-type-compact-label mb-1">
          当前用户比例
        </dt>
        <dd class="qs-type-data-emphasis m-0">
          {{ formatFundShareRate(account?.userShareRate ?? null) }}
        </dd>
      </div>
      <div>
        <dt class="qs-type-compact-label mb-1">
          当前公司比例
        </dt>
        <dd class="qs-type-data-emphasis m-0">
          {{ formatFundShareRate(account?.companyShareRate ?? null) }}
        </dd>
      </div>
    </dl>

    <FaForm :model="{ userShareRate, reason }" :disabled="locked" @submit="submit">
      <FaFormItem
        name="userShareRate"
        label="新用户分成比例"
        required
        description="允许 0–100，最多两位小数；公司比例自动取剩余部分。"
      >
        <FaInput
          v-model="userShareRate"
          autocomplete="off"
          class="w-full"
          input-class="font-mono tabular-nums text-right min-h-11 sm:min-h-9"
          inputmode="decimal"
          maxlength="8"
          placeholder="例如 30"
          spellcheck="false"
          @update:model-value="localError = ''"
        >
          <template #end>
            <span class="qs-type-meta px-2">%</span>
          </template>
        </FaInput>
      </FaFormItem>

      <FaFormItem name="reason" label="修改原因" required>
        <FaTextarea
          v-model="reason"
          class="w-full"
          input-class="min-h-24 max-h-44"
          maxlength="500"
          placeholder="说明本次比例调整原因"
          @update:model-value="localError = ''"
        />
      </FaFormItem>
    </FaForm>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="locked"
        @click="close"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :loading="locked"
        :disabled="locked || account?.ownerType !== 'USER'"
        @click="submit"
      >
        保存新比例
      </FaButton>
    </template>
  </QsGenericModal>
</template>
