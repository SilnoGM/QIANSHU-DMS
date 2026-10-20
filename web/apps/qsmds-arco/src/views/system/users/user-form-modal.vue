<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type { UserDto } from '@/api/generated/types.gen'
import type {
  AdminUserProfileFormValue,
  AdminUserProfileValue,
} from '@/utils/user-profile'

import managementApi from '@/api/modules/management'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsAvatarUploader from '@/components/business/QsAvatarUploader/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useChinaMobileField } from '@/composables/app/use-china-mobile-field'
import {
  buildAdminUserProfilePatch,
  getProfileConflictField,
  validateAdminUserProfileFields,
} from '@/utils/user-profile'

import {
  buildCreateUserFundAccountInput,
  clearPasswordFields,
  createPasswordFields,
  getApiFailure,
  getApiFieldError,
  normalizeIdentityValue,
  validateFundAccountFields,
  validateIdentityFields,
  validatePasswordFields,
} from './users.logic'

const props = withDefaults(defineProps<{
  canCreateFundAccount?: boolean
  modelValue: boolean
  mode: 'create' | 'edit'
  user?: UserDto | null
}>(), {
  canCreateFundAccount: false,
})

const emits = defineEmits<{
  'update:modelValue': [value: boolean]
  'success': [user: UserDto]
  'unknownResult': [username: string]
}>()

const loading = ref(false)
const avatarUploading = ref(false)
const errorMessage = ref('')
const requestId = ref<string>()
const fieldErrors = reactive<Record<string, string>>({})

interface UserFormModel extends AdminUserProfileFormValue {
  username: string
  mustChangePassword: boolean
  createFundAccount: boolean
  userShareRate: string
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
  createFundAccount: false,
  userShareRate: '',
  ...createPasswordFields(),
})
const initialAdminProfile = ref<AdminUserProfileValue | null>(null)
const { t } = useI18n()
const {
  clearNotice: clearMobileNotice,
  clearUnsupported: clearUnsupportedMobile,
  inputNotice: mobileInputNotice,
  national: mobileNational,
  onInput: onMobileInput,
  syncFromModel: syncMobileFromModel,
  unsupported: mobileUnsupported,
} = useChinaMobileField({
  getInitial: () => initialAdminProfile.value?.mobileE164 ?? null,
  getValue: () => model.mobileE164,
  setValue: (value) => {
    model.mobileE164 = value
  },
})

const mobileDescription = computed(() => {
  if (mobileInputNotice.value === 'digits') {
    return t('accountProfile.mobileDigitsHint')
  }
  if (mobileInputNotice.value === 'foreign') {
    return t('accountProfile.mobileForeignHint')
  }
  if (mobileInputNotice.value === 'length') {
    return t('accountProfile.mobileLengthHint')
  }
  if (mobileUnsupported.value) {
    return t('accountProfile.mobileUnsupportedHint')
  }
  return t('accountProfile.mobileHint')
})
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
  model.createFundAccount = false
  model.userShareRate = ''
  initialAdminProfile.value = null
  avatarUploading.value = false
  clearMobileNotice()
  syncMobileFromModel()
  clearPasswordFields(model)
}

function handleMobileInput(value: string | number | undefined): void {
  onMobileInput(value)
  formRef.value?.clearValidate('mobileE164')
}

function clearMobile(): void {
  model.mobileE164 = ''
  clearMobileNotice()
  syncMobileFromModel()
  formRef.value?.clearValidate('mobileE164')
}

function handleClearUnsupportedMobile(): void {
  clearUnsupportedMobile()
  formRef.value?.clearValidate('mobileE164')
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
  syncMobileFromModel()
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
  const shareRateMessage = getApiFieldError(error, 'fundAccount.userShareRate')
    ?? getApiFieldError(error, 'userShareRate')
    ?? getApiFieldError(error, 'shareRate')
  if (shareRateMessage !== undefined) {
    serverErrors.userShareRate = shareRateMessage
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
  if (loading.value || avatarUploading.value) {
    return
  }

  const submissionMode = props.mode
  const createsFundAccount = submissionMode === 'create' && model.createFundAccount
  clearErrors()
  if (mobileInputNotice.value === 'foreign') {
    setFieldErrors({
      mobileE164: t('accountProfile.validation.mobileForeignInvalid'),
    })
    return
  }
  if (mobileInputNotice.value === 'length') {
    setFieldErrors({
      mobileE164: t('accountProfile.validation.mobileLengthInvalid'),
    })
    return
  }
  setFieldErrors(
    submissionMode === 'create'
      ? {
          ...validateIdentityFields(model.username, model.displayName),
          ...validatePasswordFields(model.newPassword, model.confirmPassword),
          ...validateFundAccountFields(
            model.createFundAccount,
            model.userShareRate,
          ),
        }
      : validateAdminUserProfileFields(model, {
          requireChinaMainland: true,
          preserveUnsupportedMobile: mobileUnsupported.value,
        }),
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
        ...(createsFundAccount
          ? { fundAccount: buildCreateUserFundAccountInput(model.userShareRate) }
          : {}),
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
    const successMessage = submissionMode === 'edit'
      ? '用户信息已更新'
      : createsFundAccount
        ? '用户与资金账户已创建'
        : '用户创建成功'
    useQsToast().success(successMessage)
    emits('success', responseData)
    // QsGenericModal 在提交态拒绝程序化关闭，必须先让提交锁完成一次渲染。
    loading.value = false
    await nextTick()
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

watch(() => model.createFundAccount, (enabled) => {
  if (enabled) {
    return
  }
  // 取消勾选后比例字段被移除，不能把旧错误留在表单状态里。
  delete fieldErrors.userShareRate
  formRef.value?.clearValidate('userShareRate')
})

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
  <QsGenericModal
    :model-value="modelValue"
    :title="mode === 'create' ? '新建用户' : '编辑用户'"
    size="lg"
    :submitting="loading"
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
          <FaFormItem name="createFundAccount" label="资金账户" class="md:col-span-2">
            <FaCheckbox
              v-model="model.createFundAccount"
              :disabled="!canCreateFundAccount"
            >
              同时创建资金账户
            </FaCheckbox>
            <p v-if="!canCreateFundAccount" class="qs-type-meta mt-1">
              需要「新增资金账户」权限（fund-accounts:create）
            </p>
          </FaFormItem>
          <FaFormItem
            v-if="model.createFundAccount"
            name="userShareRate"
            label="用户分成比例"
            required
            class="md:col-span-2"
            description="允许 0–100，最多两位小数；公司比例自动取剩余部分。"
          >
            <FaInput
              v-model="model.userShareRate"
              autocomplete="off"
              class="w-full"
              clearable
              input-class="font-mono tabular-nums text-right min-h-11 sm:min-h-9"
              inputmode="decimal"
              maxlength="8"
              placeholder="例如 30"
              spellcheck="false"
              @clear="model.userShareRate = ''"
            >
              <template #end>
                <span class="qs-type-meta px-2">%</span>
              </template>
            </FaInput>
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
          <FaFormItem
            name="mobileE164"
            :auto-bind="false"
            :label="t('accountProfile.mobile')"
            :description="mobileDescription"
          >
            <FaInput
              :model-value="mobileNational"
              autocomplete="tel-national"
              clearable
              class="w-full"
              inputmode="numeric"
              :placeholder="t('accountProfile.mobilePlaceholder')"
              type="tel"
              @update:model-value="handleMobileInput"
              @clear="clearMobile"
            >
              <template #start>
                <span aria-hidden="true" class="text-sm text-muted-foreground font-medium">+86</span>
              </template>
            </FaInput>
            <template #description>
              <span>{{ mobileDescription }}</span>
              <FaButton
                v-if="mobileUnsupported"
                type="button"
                variant="link"
                size="sm"
                class="ml-1 p-0 align-baseline h-auto"
                @click="handleClearUnsupportedMobile"
              >
                {{ t('accountProfile.mobileClearUnsupported') }}
              </FaButton>
            </template>
          </FaFormItem>
          <FaFormItem name="avatarUrl" label="头像" class="md:col-span-2">
            <QsAvatarUploader
              v-model="model.avatarUrl"
              v-model:uploading="avatarUploading"
              :disabled="loading"
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
        :disabled="loading || avatarUploading || (mode === 'edit' && !hasEditChanges)"
        @click="submit"
      >
        {{ mode === 'create' ? '创建用户' : '保存修改' }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
