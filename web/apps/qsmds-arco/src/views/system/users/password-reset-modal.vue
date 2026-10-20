<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type { UserDto } from '@/api/generated/types.gen'

import managementApi from '@/api/modules/management'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  clearPasswordFields,
  createPasswordFields,
  getApiFailure,
  getApiFieldError,
  validatePasswordFields,
} from './users.logic'

const props = defineProps<{
  modelValue: boolean
  user: UserDto | null
}>()

const emits = defineEmits<{
  'update:modelValue': [value: boolean]
  'success': [user: UserDto]
}>()

const loading = ref(false)
const errorMessage = ref('')
const requestId = ref<string>()
const fieldErrors = reactive<Record<string, string>>({})

interface PasswordResetModel {
  mustChangePassword: boolean
  newPassword: string
  confirmPassword: string
  username: string
}

const formRef = useTemplateRef<FormExpose<PasswordResetModel>>('formRef')
const model = reactive<PasswordResetModel>({
  mustChangePassword: true,
  username: '',
  ...createPasswordFields(),
})

function clearErrors(): void {
  errorMessage.value = ''
  requestId.value = undefined
  formRef.value?.clearValidate()
  for (const key of Object.keys(fieldErrors)) {
    delete fieldErrors[key]
  }
}

function setFieldErrors(errors: Record<string, string>): void {
  Object.assign(fieldErrors, errors)
  for (const [field, message] of Object.entries(errors)) {
    formRef.value?.setFieldError(field, message)
  }
}

function resetModel(): void {
  clearPasswordFields(model)
  model.mustChangePassword = true
  model.username = props.user?.username ?? ''
}

function close(): void {
  if (loading.value) {
    return
  }
  resetModel()
  clearErrors()
  emits('update:modelValue', false)
}

async function submit(): Promise<void> {
  if (loading.value || props.user === null) {
    return
  }
  clearErrors()
  setFieldErrors(validatePasswordFields(model.newPassword, model.confirmPassword))
  if (Object.keys(fieldErrors).length > 0) {
    return
  }

  loading.value = true
  try {
    const response = await managementApi.users.resetPassword(props.user.id, {
      newPassword: model.newPassword,
      mustChangePassword: model.mustChangePassword,
    })
    resetModel()
    clearErrors()
    useQsToast().success('密码已设置，用户现有登录已失效。')
    emits('success', response.data)
    // QsGenericModal 在提交态拒绝程序化关闭，必须先让提交锁完成一次渲染。
    loading.value = false
    await nextTick()
    emits('update:modelValue', false)
  }
  catch (error) {
    const serverPasswordError = getApiFieldError(error, 'newPassword')
    if (serverPasswordError !== undefined) {
      setFieldErrors({ newPassword: serverPasswordError })
    }
    const failure = getApiFailure(error)
    requestId.value = failure.requestId
    if (failure.unknownResult) {
      clearPasswordFields(model)
      errorMessage.value = '设置结果未知。请重新明确输入并设置一次最终密码，系统不会自动重放本次请求。'
    }
    else {
      errorMessage.value = failure.message
    }
  }
  finally {
    loading.value = false
  }
}

function updateVisible(value: boolean): void {
  if (value) {
    emits('update:modelValue', true)
    return
  }
  close()
}

watch(() => props.modelValue, (visible) => {
  if (visible) {
    resetModel()
    clearErrors()
  }
  else {
    resetModel()
    clearErrors()
  }
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="设置或重置密码"
    size="md"
    :submitting="loading"
    @update:model-value="updateVisible"
  >
    <FaAlert icon="i-lucide:triangle-alert" class="mb-4 border-primary/30 bg-primary/5">
      <template #description>
        保存后，新密码立即成为用户登录密码，并撤销该用户的全部现有 Session。
      </template>
    </FaAlert>
    <FaAlert v-if="errorMessage" variant="destructive" icon="i-lucide:circle-alert" class="mb-4">
      <template #description>
        <div class="flex flex-wrap gap-2 items-center justify-between">
          <span>{{ errorMessage }}</span>
          <span v-if="requestId" class="text-xs font-mono">requestId: {{ requestId }}</span>
        </div>
      </template>
    </FaAlert>

    <FaForm ref="formRef" :model="model" :disabled="loading" class="gap-4" @submit="submit">
      <FaFormItem name="username" label="用户名">
        <FaInput v-model="model.username" class="w-full" disabled />
      </FaFormItem>
      <FaFormItem name="newPassword" label="新密码" required>
        <FaInput
          v-model="model.newPassword"
          type="password"
          autocomplete="new-password"
          clearable
          class="w-full"
          placeholder="请输入 8 至 20 个字符"
          @clear="model.newPassword = ''"
        />
      </FaFormItem>
      <FaFormItem name="confirmPassword" label="确认新密码" required>
        <FaInput
          v-model="model.confirmPassword"
          type="password"
          autocomplete="new-password"
          clearable
          class="w-full"
          placeholder="请再次输入新密码"
          @clear="model.confirmPassword = ''"
        />
      </FaFormItem>
      <FaFormItem name="mustChangePassword" label="登录要求">
        <FaCheckbox v-model="model.mustChangePassword">
          下次登录必须修改密码
        </FaCheckbox>
      </FaFormItem>
    </FaForm>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="loading"
        @click="close"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :loading="loading"
        :disabled="loading"
        @click="submit"
      >
        设置密码
      </FaButton>
    </template>
  </QsGenericModal>
</template>
