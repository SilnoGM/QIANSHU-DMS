<script setup lang="ts">
import type {
  CreateFundAccountRequestDto,
  UserDto,
} from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import { buildFundAccountCreateRequest } from '../shared/fund-money.logic'

defineOptions({ name: 'FundAccountCreateModal' })

const props = withDefaults(defineProps<{
  error?: null | string
  loadingUsers?: boolean
  modelValue: boolean
  requestId?: null | string
  submitting?: boolean
  users: readonly UserDto[]
}>(), {
  error: null,
  loadingUsers: false,
  requestId: null,
  submitting: false,
})

const emit = defineEmits<{
  'retry': []
  'submit': [payload: CreateFundAccountRequestDto]
  'update:modelValue': [value: boolean]
}>()

const selectedUserId = ref('')
const userShareRate = ref('')
const localError = ref('')
const submitRequested = ref(false)

const locked = computed(() => props.submitting || submitRequested.value)
const userOptions = computed(() => props.users.map(user => ({
  label: `${user.displayName}（${user.username}）${user.status === 'DISABLED' ? ' · 已禁用' : ''}`,
  value: user.id,
})))

function resetForm(): void {
  selectedUserId.value = ''
  userShareRate.value = ''
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
  if (locked.value || props.loadingUsers) {
    return
  }
  try {
    const payload = buildFundAccountCreateRequest(
      selectedUserId.value,
      userShareRate.value,
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
      : '开户信息无效，请检查后重试'
  }
}

watch(() => props.modelValue, (visible) => {
  if (visible) {
    resetForm()
  }
  else {
    localError.value = ''
    submitRequested.value = false
  }
})

watch(() => props.submitting, (submitting) => {
  if (!submitting) {
    submitRequested.value = false
  }
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="创建资金账户"
    description="为尚未开户的系统用户建立唯一人民币资金账户。"
    size="md"
    :loading="loadingUsers"
    :submitting="locked"
    @update:model-value="updateVisible"
  >
    <FaAlert
      v-if="error || localError"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="开户失败"
      class="mb-4"
      role="alert"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ localError || error }}</span>
          <code v-if="requestId" class="qs-type-meta break-all">requestId: {{ requestId }}</code>
          <div v-if="error && users.length === 0" class="mt-1">
            <FaButton
              type="button"
              variant="outline"
              size="sm"
              class="min-h-11 sm:min-h-9"
              :disabled="locked"
              @click="emit('retry')"
            >
              重新加载候选用户
            </FaButton>
          </div>
        </div>
      </template>
    </FaAlert>

    <FaAlert
      v-if="!loadingUsers && users.length === 0"
      icon="i-lucide:circle-check"
      title="没有未开户用户"
      description="当前用户均已有资金账户，无需重复开户。"
      class="mb-4"
    />

    <FaForm :model="{ selectedUserId, userShareRate }" :disabled="locked" @submit="submit">
      <FaFormItem
        name="selectedUserId"
        label="未开户用户"
        required
        description="已开户用户由前端候选集合排除，数据库唯一约束仍是最终保护。"
      >
        <FaSelect
          v-model="selectedUserId"
          :options="userOptions"
          :disabled="locked || users.length === 0"
          class="min-h-11 w-full sm:min-h-9"
          placeholder="请选择用户"
          searchable
          @update:model-value="localError = ''"
        />
      </FaFormItem>

      <FaFormItem
        name="userShareRate"
        label="初始用户分成比例"
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
        :disabled="locked || loadingUsers || users.length === 0"
        @click="submit"
      >
        创建账户
      </FaButton>
    </template>
  </QsGenericModal>
</template>
