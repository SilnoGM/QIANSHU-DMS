<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type { UserDto } from '@/api/generated/types.gen'
import type {
  AdminUserProfileFormValue,
  AdminUserProfileValue,
} from '@/utils/user-profile'

import managementApi from '@/api/modules/management'
import {
  buildAdminUserProfilePatch,
  getProfileConflictField,
  validateAdminUserProfileFields,
} from '@/utils/user-profile'

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

interface UserFormModel extends AdminUserProfileFormValue {
  username: string
  mustChangePassword: boolean
  newPassword: string
  confirmPassword: string
}

const formRef = useTemplateRef<FormExpose<UserFormModel>>('formRef')
const model = reactive<UserFormModel>({
  username: '',
  displayName: '',
  email: '',
  mobileE164: '',
  avatarUrl: '',
  remark: '',
  mustChangePassword: true,
  ...createPasswordFields(),
})
const initialAdminProfile = ref<AdminUserProfileValue | null>(null)
const hasEditChanges = computed(() => {
  if (props.mode !== 'edit' || initialAdminProfile.value === null) {
    return false
  }
  return Object.keys(
    buildAdminUserProfilePatch(initialAdminProfile.value, model),
  ).length > 0
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
  model.email = ''
  model.mobileE164 = ''
  model.avatarUrl = ''
  model.remark = ''
  model.mustChangePassword = true
  initialAdminProfile.value = null
  clearPasswordFields(model)
}

function initializeModel(): void {
  clearErrors()
  clearModel()
  if (props.mode !== 'edit') {
    return
  }
  if (props.user === null || props.user === undefined) {
    errorMessage.value = '用户资料不完整，请关闭弹窗后重试'
    return
  }

  model.username = props.user.username
  model.displayName = props.user.displayName
  model.email = props.user.profile.email ?? ''
  model.mobileE164 = props.user.profile.mobileE164 ?? ''
  model.avatarUrl = props.user.profile.avatarUrl ?? ''
  model.remark = props.user.profile.remark ?? ''
  initialAdminProfile.value = {
    displayName: props.user.displayName,
    email: props.user.profile.email,
    mobileE164: props.user.profile.mobileE164,
    avatarUrl: props.user.profile.avatarUrl,
    remark: props.user.profile.remark,
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
  for (const field of [
    'username',
    'displayName',
    'email',
    'mobileE164',
    'avatarUrl',
    'remark',
    'password',
  ] as const) {
    const message = getApiFieldError(error, field)
    if (message !== undefined) {
      serverErrors[field === 'password' ? 'newPassword' : field] = message
    }
  }
  const conflictField = getProfileConflictField(error)
  if (conflictField !== undefined && serverErrors[conflictField] === undefined) {
    serverErrors[conflictField] = conflictField === 'email'
      ? '该邮箱已被其他用户使用'
      : '该手机号已被其他用户使用'
  }
  setFieldErrors(serverErrors)
}

async function submit(): Promise<void> {
  if (loading.value) {
    return
  }

  const submissionMode = props.mode
  clearErrors()
  setFieldErrors(
    submissionMode === 'create'
      ? {
          ...validateIdentityFields(model.username, model.displayName),
          ...validatePasswordFields(model.newPassword, model.confirmPassword),
        }
      : validateAdminUserProfileFields(model),
  )
  if (Object.keys(fieldErrors).length > 0) {
    return
  }

  let editMutation: {
    userId: string
    updatePatch: ReturnType<typeof buildAdminUserProfilePatch>
  } | null = null
  if (submissionMode === 'edit') {
    const user = props.user
    const initial = initialAdminProfile.value
    if (user === null || user === undefined || initial === null) {
      errorMessage.value = '用户资料不完整，请关闭弹窗后重试'
      return
    }
    const updatePatch = buildAdminUserProfilePatch(initial, model)
    if (Object.keys(updatePatch).length === 0) {
      return
    }
    editMutation = { userId: user.id, updatePatch }
  }

  loading.value = true
  try {
    let responseData: UserDto
    if (submissionMode === 'create') {
      responseData = (await managementApi.users.create({
        username: normalizeIdentityValue(model.username),
        displayName: normalizeIdentityValue(model.displayName),
        password: model.newPassword,
        mustChangePassword: model.mustChangePassword,
      })).data
    }
    else {
      // editMutation 在打开 loading 前已经构造；该保护分支只防御未来重构破坏前置条件。
      if (editMutation === null) {
        throw new Error('Missing administrator user update mutation')
      }
      responseData = (await managementApi.users.update(
        editMutation.userId,
        editMutation.updatePatch,
      )).data
    }

    clearModel()
    clearErrors()
    useFaToast().success(submissionMode === 'create' ? '用户创建成功' : '用户信息已更新')
    emits('success', responseData)
    emits('update:modelValue', false)
  }
  catch (error) {
    applyServerFieldErrors(error)
    const failure = getApiFailure(error)
    requestId.value = failure.requestId
    if (submissionMode === 'create' && failure.unknownResult) {
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
    class="max-w-[calc(100%-1.5rem)] min-h-auto sm:max-w-[720px]"
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
      <div class="gap-x-4 gap-y-4 grid grid-cols-1 md:grid-cols-2">
        <FaFormItem name="username" label="用户名" :required="mode === 'create'">
          <FaInput
            v-model="model.username"
            :disabled="mode === 'edit'"
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
          <FaFormItem name="mustChangePassword" label="登录要求" class="md:col-span-2">
            <FaCheckbox v-model="model.mustChangePassword">
              下次登录必须修改密码
            </FaCheckbox>
          </FaFormItem>
        </template>

        <template v-if="mode === 'edit'">
          <FaFormItem name="email" label="邮箱">
            <FaInput
              v-model="model.email"
              autocomplete="off"
              clearable
              class="w-full"
              placeholder="可选；清空后保存将移除邮箱"
              @clear="model.email = ''"
            />
          </FaFormItem>
          <FaFormItem name="mobileE164" label="手机号">
            <FaInput
              v-model="model.mobileE164"
              autocomplete="off"
              clearable
              class="w-full"
              inputmode="tel"
              placeholder="例如 +8613800138000"
              @clear="model.mobileE164 = ''"
            />
          </FaFormItem>
          <FaFormItem name="avatarUrl" label="头像 URL" class="md:col-span-2">
            <FaInput
              v-model="model.avatarUrl"
              autocomplete="off"
              clearable
              class="w-full"
              placeholder="可选；请输入 HTTP 或 HTTPS 绝对地址"
              @clear="model.avatarUrl = ''"
            />
          </FaFormItem>
          <FaFormItem name="remark" label="管理员备注" class="md:col-span-2">
            <FaTextarea
              v-model="model.remark"
              class="w-full"
              input-class="min-h-24 max-h-56"
              placeholder="可选；仅系统管理员可见"
            />
          </FaFormItem>
        </template>
      </div>

      <div class="mt-6 flex gap-3 justify-end">
        <FaButton type="button" variant="outline" :disabled="loading" @click="close">
          取消
        </FaButton>
        <FaButton
          type="submit"
          :loading="loading"
          :disabled="loading || (mode === 'edit' && !hasEditChanges)"
        >
          {{ mode === 'create' ? '创建用户' : '保存修改' }}
        </FaButton>
      </div>
    </FaForm>
  </FaModal>
</template>
