<script setup lang="ts">
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

defineOptions({ name: 'ChangePasswordModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  forced?: boolean
}>(), {
  forced: false,
})

const emits = defineEmits<{
  'update:modelValue': [value: boolean]
  'success': []
}>()

const appAccountStore = useAppAccountStore()
const loading = ref(false)
const errorMessage = ref('')
const model = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

function clearPasswords(): void {
  model.currentPassword = ''
  model.newPassword = ''
  model.confirmPassword = ''
}

function close(): void {
  if (props.forced || loading.value) {
    return
  }
  clearPasswords()
  errorMessage.value = ''
  emits('update:modelValue', false)
}

function canCloseModal(): boolean {
  // 强制改密期间连父级程序化关闭也必须拒绝，直到身份状态切换后组件被根层卸载。
  return !props.forced && !loading.value
}

function updateVisible(value: boolean): void {
  if (value) {
    emits('update:modelValue', true)
    return
  }
  close()
}

function validate(): string | null {
  if (!props.forced) {
    const currentPasswordLength = Array.from(model.currentPassword).length
    if (currentPasswordLength < 8 || currentPasswordLength > 20) {
      return '当前密码长度应为 8 至 20 个字符'
    }
  }
  const length = Array.from(model.newPassword).length
  if (length < 8 || length > 20) {
    return '新密码长度应为 8 至 20 个字符'
  }
  if (model.newPassword !== model.confirmPassword) {
    return '两次输入的新密码不一致'
  }
  return null
}

function safeErrorMessage(
  error: unknown,
  fallback = '修改密码失败，请稍后重试',
): string {
  if (
    typeof error === 'object'
    && error !== null
    && 'body' in error
    && typeof error.body === 'object'
    && error.body !== null
    && 'message' in error.body
    && typeof error.body.message === 'string'
  ) {
    return error.body.message
  }
  return fallback
}

function isUnknownResult(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'kind' in error
    && (
      error.kind === 'network'
      || (
        'status' in error
        && typeof error.status === 'number'
        && error.status >= 500
      )
    )
}

async function submit(): Promise<void> {
  if (loading.value) {
    return
  }
  const validationError = validate()
  if (validationError !== null) {
    errorMessage.value = validationError
    return
  }

  loading.value = true
  errorMessage.value = ''
  try {
    await appAccountStore.changePassword({
      ...(props.forced ? {} : { currentPassword: model.currentPassword }),
      newPassword: model.newPassword,
    })
    clearPasswords()
    useQsToast().success('密码修改成功')
    // QsGenericModal 在提交态拒绝程序化关闭，先释放锁并等待属性同步。
    loading.value = false
    await nextTick()
    emits('success')
    emits('update:modelValue', false)
  }
  catch (error) {
    if (isUnknownResult(error)) {
      clearPasswords()
      errorMessage.value = '修改结果未知，请优先使用刚设置的新密码登录'
    }
    else {
      errorMessage.value = safeErrorMessage(error)
    }
  }
  finally {
    loading.value = false
  }
}

async function exit(): Promise<void> {
  if (loading.value) {
    return
  }
  loading.value = true
  try {
    await appAccountStore.logout()
  }
  catch (error) {
    errorMessage.value = isUnknownResult(error)
      ? '退出结果未知，请重新检查登录状态后再试'
      : safeErrorMessage(error, '退出失败，请稍后重试')
  }
  finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (visible) => {
  if (!visible) {
    clearPasswords()
    errorMessage.value = ''
  }
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="forced ? '请先修改密码' : '修改密码'"
    size="sm"
    :closable="!forced && !loading"
    :dismiss-on-overlay="!forced && !loading"
    :dismiss-on-escape="!forced && !loading"
    :submitting="loading"
    :before-close="canCloseModal"
    @update:model-value="updateVisible"
  >
    <FaAlert
      v-if="forced"
      variant="default"
      icon="i-lucide:triangle-alert"
      title="管理员要求你修改密码后才能进入系统。"
      class="mb-4"
    />
    <FaAlert
      v-if="errorMessage"
      variant="destructive"
      icon="i-lucide:circle-alert"
      :title="errorMessage"
      class="mb-4"
    />
    <form id="change-password-form" class="space-y-4" @submit.prevent="submit">
      <div v-if="!forced" class="space-y-1.5">
        <label for="change-password-current" class="qs-type-compact-label">当前密码</label>
        <FaInput
          id="change-password-current"
          v-model="model.currentPassword"
          type="password"
          autocomplete="current-password"
          placeholder="请输入当前密码"
          clearable
        />
      </div>
      <div class="space-y-1.5">
        <label for="change-password-new" class="qs-type-compact-label">新密码</label>
        <FaInput
          id="change-password-new"
          v-model="model.newPassword"
          type="password"
          autocomplete="new-password"
          placeholder="请输入新密码"
          clearable
        />
        <p class="text-xs text-muted-foreground m-0">
          8 至 20 个字符，支持空格与 Unicode。
        </p>
      </div>
      <div class="space-y-1.5">
        <label for="change-password-confirm" class="qs-type-compact-label">确认新密码</label>
        <FaInput
          id="change-password-confirm"
          v-model="model.confirmPassword"
          type="password"
          autocomplete="new-password"
          placeholder="请再次输入新密码"
          clearable
        />
      </div>
    </form>

    <template #footer>
      <FaButton
        v-if="forced"
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="loading"
        @click="exit"
      >
        退出登录
      </FaButton>
      <FaButton
        v-else
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="loading"
        @click="close"
      >
        取消
      </FaButton>
      <FaButton
        type="submit"
        form="change-password-form"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :loading="loading"
        :disabled="loading"
      >
        修改密码
      </FaButton>
    </template>
  </QsGenericModal>
</template>
