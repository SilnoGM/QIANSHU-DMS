<script setup lang="ts">
import type { UserDto } from '@/api/generated/types.gen'

import { useMediaQuery } from '@vueuse/core'

import managementApi from '@/api/modules/management'

import {
  clearPasswordFields,
  createPasswordFields,
  getApiFailure,
  getApiFieldError,
  normalizeIdentityValue,
  validateIdentityFields,
  validatePasswordFields,
} from './users.logic'

const props = defineProps<{
  modelValue: boolean
  mode: 'create' | 'edit'
  user?: UserDto | null
}>()

const emits = defineEmits<{
  'update:modelValue': [value: boolean]
  'success': [user: UserDto]
  'unknownResult': [username: string]
}>()

const isNarrow = useMediaQuery('(max-width: 767px)')
const loading = ref(false)
const errorMessage = ref('')
const requestId = ref<string>()
const fieldErrors = reactive<Record<string, string>>({})
const model = reactive({
  username: '',
  displayName: '',
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

function clearModel(): void {
  model.username = ''
  model.displayName = ''
  model.mustChangePassword = true
  clearPasswordFields(model)
}

function initializeModel(): void {
  clearErrors()
  clearModel()
  if (props.mode === 'edit' && props.user !== null && props.user !== undefined) {
    model.username = props.user.username
    model.displayName = props.user.displayName
  }
}

function close(): void {
  if (loading.value) {
    return
  }
  clearModel()
  clearErrors()
  emits('update:modelValue', false)
}

function applyServerFieldErrors(error: unknown): void {
  for (const field of ['username', 'displayName', 'password'] as const) {
    const message = getApiFieldError(error, field)
    if (message !== undefined) {
      fieldErrors[field === 'password' ? 'newPassword' : field] = message
    }
  }
}

async function submit(): Promise<void> {
  if (loading.value) {
    return
  }

  clearErrors()
  Object.assign(
    fieldErrors,
    props.mode === 'create'
      ? {
          ...validateIdentityFields(model.username, model.displayName),
          ...validatePasswordFields(model.newPassword, model.confirmPassword),
        }
      : validateIdentityFields('unchanged', model.displayName),
  )
  if (Object.keys(fieldErrors).length > 0) {
    return
  }

  loading.value = true
  try {
    const response = props.mode === 'create'
      ? await managementApi.users.create({
          username: normalizeIdentityValue(model.username),
          displayName: normalizeIdentityValue(model.displayName),
          password: model.newPassword,
          mustChangePassword: model.mustChangePassword,
        })
      : await managementApi.users.update(props.user!.id, {
          displayName: normalizeIdentityValue(model.displayName),
        })

    clearModel()
    clearErrors()
    useFaToast().success(props.mode === 'create' ? '用户创建成功' : '用户信息已更新')
    emits('success', response.data)
    emits('update:modelValue', false)
  }
  catch (error) {
    applyServerFieldErrors(error)
    const failure = getApiFailure(error)
    requestId.value = failure.requestId
    if (props.mode === 'create' && failure.unknownResult) {
      const username = normalizeIdentityValue(model.username)
      clearPasswordFields(model)
      errorMessage.value = '创建结果未知，已按用户名刷新列表核查；如未创建，请重新输入密码后提交。'
      emits('unknownResult', username)
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
    initializeModel()
  }
  else {
    clearModel()
    clearErrors()
  }
})
</script>

<template>
  <AModal
    :visible="modelValue"
    :title="mode === 'create' ? '新建用户' : '编辑用户'"
    :width="isNarrow ? 'calc(100vw - 24px)' : 520"
    :closable="!loading"
    :mask-closable="!loading"
    :esc-to-close="!loading"
    :footer="false"
    unmount-on-close
    @cancel="close"
  >
    <AAlert v-if="errorMessage" type="error" class="mb-4">
      {{ errorMessage }}
      <template v-if="requestId" #action>
        <span class="text-xs font-mono">requestId: {{ requestId }}</span>
      </template>
    </AAlert>

    <AForm :model="model" layout="vertical" @submit-success="submit">
      <AFormItem
        field="username"
        label="用户名"
        :required="mode === 'create'"
        :validate-status="fieldErrors.username ? 'error' : undefined"
        :help="fieldErrors.username"
      >
        <AInput
          v-model="model.username"
          :disabled="mode === 'edit'"
          :maxlength="128"
          autocomplete="off"
          allow-clear
          placeholder="请输入用户名"
        />
      </AFormItem>

      <AFormItem
        field="displayName"
        label="显示名称"
        required
        :validate-status="fieldErrors.displayName ? 'error' : undefined"
        :help="fieldErrors.displayName"
      >
        <AInput
          v-model="model.displayName"
          :maxlength="128"
          autocomplete="off"
          allow-clear
          placeholder="请输入显示名称"
        />
      </AFormItem>

      <template v-if="mode === 'create'">
        <AFormItem
          field="newPassword"
          label="初始密码"
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
          label="确认密码"
          required
          :validate-status="fieldErrors.confirmPassword ? 'error' : undefined"
          :help="fieldErrors.confirmPassword"
        >
          <AInputPassword
            v-model="model.confirmPassword"
            autocomplete="new-password"
            allow-clear
            placeholder="请再次输入初始密码"
          />
        </AFormItem>
        <AFormItem field="mustChangePassword" label="登录要求">
          <ACheckbox v-model="model.mustChangePassword">
            下次登录必须修改密码
          </ACheckbox>
        </AFormItem>
      </template>

      <div class="mt-6 flex gap-3 justify-end">
        <AButton :disabled="loading" @click="close">
          取消
        </AButton>
        <AButton type="primary" html-type="submit" :loading="loading" :disabled="loading">
          {{ mode === 'create' ? '创建用户' : '保存修改' }}
        </AButton>
      </div>
    </AForm>
  </AModal>
</template>
