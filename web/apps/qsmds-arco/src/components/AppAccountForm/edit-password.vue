<script setup lang="ts">
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
    useFaToast().success('密码修改成功')
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
    <AAlert v-if="forced" type="warning" class="mb-4">
      管理员要求你修改密码后才能进入系统。
    </AAlert>
    <AAlert v-if="errorMessage" type="error" class="mb-4">
      {{ errorMessage }}
    </AAlert>
    <AForm
      id="change-password-form"
      :model="model"
      layout="vertical"
      @submit-success="submit"
    >
      <AFormItem v-if="!forced" field="currentPassword" label="当前密码" required>
        <AInputPassword v-model="model.currentPassword" autocomplete="current-password" allow-clear />
      </AFormItem>
      <AFormItem field="newPassword" label="新密码" required>
        <AInputPassword v-model="model.newPassword" autocomplete="new-password" allow-clear />
        <template #extra>
          8 至 20 个字符，支持空格与 Unicode。
        </template>
      </AFormItem>
      <AFormItem field="confirmPassword" label="确认新密码" required>
        <AInputPassword v-model="model.confirmPassword" autocomplete="new-password" allow-clear />
      </AFormItem>
    </AForm>

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
