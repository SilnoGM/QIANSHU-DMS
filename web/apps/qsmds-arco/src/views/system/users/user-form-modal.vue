<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type { UserDto } from '@/api/generated/types.gen'

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

const loading = ref(false)
const errorMessage = ref('')
const requestId = ref<string>()
const fieldErrors = reactive<Record<string, string>>({})

interface UserFormModel {
  username: string
  displayName: string
  mustChangePassword: boolean
  newPassword: string
  confirmPassword: string
}

const formRef = useTemplateRef<FormExpose<UserFormModel>>('formRef')
const model = reactive<UserFormModel>({
  username: '',
  displayName: '',
  mustChangePassword: true,
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
  const serverErrors: Record<string, string> = {}
  for (const field of ['username', 'displayName', 'password'] as const) {
    const message = getApiFieldError(error, field)
    if (message !== undefined) {
      serverErrors[field === 'password' ? 'newPassword' : field] = message
    }
  }
  setFieldErrors(serverErrors)
}

async function submit(): Promise<void> {
  if (loading.value) {
    return
  }

  clearErrors()
  setFieldErrors(
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

function updateVisible(value: boolean): void {
  if (value) {
    emits('update:modelValue', true)
    return
  }
  close()
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
  <FaModal
    :model-value="modelValue"
    :title="mode === 'create' ? '新建用户' : '编辑用户'"
    class="max-w-[calc(100%-1.5rem)] min-h-auto sm:max-w-[520px]"
    :closable="!loading"
    :close-on-click-overlay="!loading"
    :close-on-press-escape="!loading"
    :footer="false"
    destroy-on-close
    @update:model-value="updateVisible"
  >
    <FaAlert v-if="errorMessage" variant="destructive" icon="i-lucide:circle-alert" class="mb-4">
      <template #description>
        <div class="flex flex-wrap gap-2 items-center justify-between">
          <span>{{ errorMessage }}</span>
          <span v-if="requestId" class="text-xs font-mono">requestId: {{ requestId }}</span>
        </div>
      </template>
    </FaAlert>

    <FaForm ref="formRef" :model="model" :disabled="loading" class="gap-4" @submit="submit">
      <FaFormItem name="username" label="用户名" :required="mode === 'create'">
        <FaInput
          v-model="model.username"
          :disabled="mode === 'edit'"
          :maxlength="128"
          autocomplete="off"
          clearable
          class="w-full"
          placeholder="请输入用户名"
          @clear="model.username = ''"
        />
      </FaFormItem>

      <FaFormItem name="displayName" label="显示名称" required>
        <FaInput
          v-model="model.displayName"
          :maxlength="128"
          autocomplete="off"
          clearable
          class="w-full"
          placeholder="请输入显示名称"
          @clear="model.displayName = ''"
        />
      </FaFormItem>

      <template v-if="mode === 'create'">
        <FaFormItem name="newPassword" label="初始密码" required>
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
        <FaFormItem name="confirmPassword" label="确认密码" required>
          <FaInput
            v-model="model.confirmPassword"
            type="password"
            autocomplete="new-password"
            clearable
            class="w-full"
            placeholder="请再次输入初始密码"
            @clear="model.confirmPassword = ''"
          />
        </FaFormItem>
        <FaFormItem name="mustChangePassword" label="登录要求">
          <FaCheckbox v-model="model.mustChangePassword">
            下次登录必须修改密码
          </FaCheckbox>
        </FaFormItem>
      </template>

      <div class="mt-2 flex gap-3 justify-end">
        <FaButton type="button" variant="outline" :disabled="loading" @click="close">
          取消
        </FaButton>
        <FaButton type="submit" :loading="loading" :disabled="loading">
          {{ mode === 'create' ? '创建用户' : '保存修改' }}
        </FaButton>
      </div>
    </FaForm>
  </FaModal>
</template>
