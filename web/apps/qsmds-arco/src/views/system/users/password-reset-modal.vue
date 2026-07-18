<script setup lang="ts">
import type { UserDto } from '@/api/generated/types.gen'

import { useMediaQuery } from '@vueuse/core'

import managementApi from '@/api/modules/management'

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

const isNarrow = useMediaQuery('(max-width: 767px)')
const loading = ref(false)
const errorMessage = ref('')
const requestId = ref<string>()
const fieldErrors = reactive<Record<string, string>>({})
const model = reactive({
  mustChangePassword: true,
  ...createPasswordFields(),
})

function clearErrors(): void {
  errorMessage.value = ''
  requestId.value = undefined
  for (const key of Object.keys(fieldErrors)) {
    delete fieldErrors[key]
  }
}

function resetModel(): void {
  clearPasswordFields(model)
  model.mustChangePassword = true
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
  Object.assign(
    fieldErrors,
    validatePasswordFields(model.newPassword, model.confirmPassword),
  )
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
    useFaToast().success('密码已设置，用户现有登录已失效。')
    emits('success', response.data)
    emits('update:modelValue', false)
  }
  catch (error) {
    const serverPasswordError = getApiFieldError(error, 'newPassword')
    if (serverPasswordError !== undefined) {
      fieldErrors.newPassword = serverPasswordError
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
  <AModal
    :visible="modelValue"
    title="设置或重置密码"
    :width="isNarrow ? 'calc(100vw - 24px)' : 520"
    :closable="!loading"
    :mask-closable="!loading"
    :esc-to-close="!loading"
    :footer="false"
    unmount-on-close
    @cancel="close"
  >
    <AAlert type="warning" class="mb-4">
      保存后，新密码立即成为用户登录密码，并撤销该用户的全部现有 Session。
    </AAlert>
    <AAlert v-if="errorMessage" type="error" class="mb-4">
      {{ errorMessage }}
      <template v-if="requestId" #action>
        <span class="text-xs font-mono">requestId: {{ requestId }}</span>
      </template>
    </AAlert>

    <AForm :model="model" layout="vertical" @submit-success="submit">
      <AFormItem label="用户名">
        <AInput :model-value="user?.username ?? ''" disabled />
      </AFormItem>
      <AFormItem
        field="newPassword"
        label="新密码"
        required
        :validate-status="fieldErrors.newPassword ? 'error' : undefined"
        :help="fieldErrors.newPassword"
      >
        <AInputPassword
          v-model="model.newPassword"
          autocomplete="new-password"
          allow-clear
          placeholder="请输入 15 至 128 个字符"
        />
      </AFormItem>
      <AFormItem
        field="confirmPassword"
        label="确认新密码"
        required
        :validate-status="fieldErrors.confirmPassword ? 'error' : undefined"
        :help="fieldErrors.confirmPassword"
      >
        <AInputPassword
          v-model="model.confirmPassword"
          autocomplete="new-password"
          allow-clear
          placeholder="请再次输入新密码"
        />
      </AFormItem>
      <AFormItem field="mustChangePassword" label="登录要求">
        <ACheckbox v-model="model.mustChangePassword">
          下次登录必须修改密码
        </ACheckbox>
      </AFormItem>

      <div class="mt-6 flex gap-3 justify-end">
        <AButton :disabled="loading" @click="close">
          取消
        </AButton>
        <AButton type="primary" html-type="submit" :loading="loading" :disabled="loading">
          设置密码
        </AButton>
      </div>
    </AForm>
  </AModal>
</template>
