<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type {
  CurrentUserProfileDto,
  UpdateCurrentUserProfileRequestDto,
} from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  buildCurrentUserProfilePatch,
  getProfileConflictField,
  resolveAvatarPreviewUrl,
  validateCurrentUserProfileFields,
} from '@/utils/user-profile'

defineOptions({ name: 'AppAccountProfile' })

const props = defineProps<{
  modelValue: boolean
}>()

const emits = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

interface ProfileFormModel {
  avatarUrl: string
  email: string
  mobileE164: string
}

const appAccountStore = useAppAccountStore()
const { t } = useI18n()
const formRef = useTemplateRef<FormExpose<ProfileFormModel>>('formRef')
const model = reactive<ProfileFormModel>({
  avatarUrl: '',
  email: '',
  mobileE164: '',
})
const initialProfile = shallowRef<CurrentUserProfileDto | null>(null)
const submitting = ref(false)
const loadFailed = ref(false)
const errorMessage = ref('')
const fieldErrors = reactive<Partial<Record<keyof ProfileFormModel, string>>>({})
let openRequestVersion = 0

const loading = computed(() => appAccountStore.profileState === 'loading')
const previewUrl = computed(() => resolveAvatarPreviewUrl(model.avatarUrl))
const hasChanges = computed(() => {
  if (initialProfile.value === null) {
    return false
  }
  return Object.keys(
    buildCurrentUserProfilePatch(initialProfile.value, model),
  ).length > 0
})
const canSubmit = computed(() =>
  initialProfile.value !== null
  && !loading.value
  && !submitting.value
  && hasChanges.value,
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clearErrors(): void {
  errorMessage.value = ''
  formRef.value?.clearValidate()
  for (const field of Object.keys(fieldErrors)) {
    delete fieldErrors[field as keyof ProfileFormModel]
  }
}

function setFieldErrors(
  errors: Partial<Record<keyof ProfileFormModel, string>>,
): void {
  Object.assign(fieldErrors, errors)
  for (const [field, message] of Object.entries(errors)) {
    if (message !== undefined) {
      formRef.value?.setFieldError(field, message)
    }
  }
}

function resetModel(profile: CurrentUserProfileDto | null): void {
  initialProfile.value = profile
  model.email = profile?.email ?? ''
  model.mobileE164 = profile?.mobileE164 ?? ''
  model.avatarUrl = profile?.avatarUrl ?? ''
}

function readServerFieldErrors(
  error: unknown,
): Partial<Record<keyof ProfileFormModel, string>> {
  if (!isRecord(error) || !isRecord(error.body) || !isRecord(error.body.fieldErrors)) {
    return {}
  }

  const errors: Partial<Record<keyof ProfileFormModel, string>> = {}
  for (const field of ['avatarUrl', 'email', 'mobileE164'] as const) {
    const messages = error.body.fieldErrors[field]
    if (Array.isArray(messages) && typeof messages[0] === 'string') {
      errors[field] = messages[0]
    }
  }
  return errors
}

function safeErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined
  }
  if (typeof error.code === 'string') {
    return error.code
  }
  return isRecord(error.body) && typeof error.body.code === 'string'
    ? error.body.code
    : undefined
}

async function loadForOpen(): Promise<void> {
  const requestVersion = ++openRequestVersion
  clearErrors()
  loadFailed.value = false
  resetModel(null)

  try {
    const profile = await appAccountStore.loadProfile({ force: true })
    if (requestVersion !== openRequestVersion || !props.modelValue) {
      return
    }
    if (profile === null) {
      loadFailed.value = true
      return
    }
    resetModel(profile)
  }
  catch {
    if (requestVersion === openRequestVersion && props.modelValue) {
      loadFailed.value = true
    }
  }
}

function close(): void {
  if (submitting.value) {
    return
  }
  openRequestVersion += 1
  clearErrors()
  loadFailed.value = false
  resetModel(null)
  emits('update:modelValue', false)
}

function updateVisible(value: boolean): void {
  if (value) {
    emits('update:modelValue', true)
  }
  else {
    close()
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value || initialProfile.value === null) {
    return
  }

  clearErrors()
  const validationErrors = validateCurrentUserProfileFields(model, {
    avatarUrlInvalid: t('accountProfile.validation.avatarUrlInvalid'),
    avatarUrlTooLong: t('accountProfile.validation.avatarUrlTooLong'),
    emailInvalid: t('accountProfile.validation.emailInvalid'),
    emailTooLong: t('accountProfile.validation.emailTooLong'),
    mobileE164Invalid: t('accountProfile.validation.mobileE164Invalid'),
  })
  if (Object.keys(validationErrors).length > 0) {
    setFieldErrors(validationErrors)
    return
  }

  const patch: UpdateCurrentUserProfileRequestDto
    = buildCurrentUserProfilePatch(initialProfile.value, model)
  if (Object.keys(patch).length === 0) {
    return
  }

  submitting.value = true
  try {
    const profile = await appAccountStore.updateProfile(patch)
    resetModel(profile)
    useFaToast().success(t('accountProfile.saved'))
    // QsGenericModal 在提交态拒绝程序化关闭，先释放锁并等待属性同步。
    submitting.value = false
    await nextTick()
    emits('update:modelValue', false)
  }
  catch (error) {
    const conflictField = getProfileConflictField(error)
    if (conflictField !== undefined) {
      setFieldErrors({
        [conflictField]: t(
          conflictField === 'email'
            ? 'accountProfile.emailConflict'
            : 'accountProfile.mobileConflict',
        ),
      })
      return
    }

    const serverErrors = readServerFieldErrors(error)
    if (Object.keys(serverErrors).length > 0) {
      setFieldErrors(serverErrors)
      return
    }

    errorMessage.value = safeErrorCode(error) === 'PROFILE_UPDATE_RESULT_UNKNOWN'
      ? t('accountProfile.resultUnknown')
      : t('accountProfile.updateFailed')
  }
  finally {
    submitting.value = false
  }
}

watch(() => props.modelValue, (visible) => {
  if (visible) {
    void loadForOpen()
  }
  else {
    openRequestVersion += 1
    clearErrors()
    loadFailed.value = false
    resetModel(null)
  }
}, { immediate: true })
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('accountProfile.title')"
    :description="t('accountProfile.description')"
    size="lg"
    :submitting="submitting"
    @update:model-value="updateVisible"
  >
    <FaAlert
      v-if="loadFailed"
      variant="destructive"
      icon="i-lucide:circle-alert"
      class="mb-4"
    >
      <template #description>
        <div class="flex flex-wrap gap-2 items-center justify-between">
          <span>{{ t('accountProfile.loadFailed') }}</span>
          <FaButton
            type="button"
            variant="outline"
            size="sm"
            :disabled="loading"
            @click="loadForOpen"
          >
            {{ t('accountProfile.retry') }}
          </FaButton>
        </div>
      </template>
    </FaAlert>

    <FaAlert
      v-if="errorMessage"
      variant="destructive"
      icon="i-lucide:circle-alert"
      class="mb-4"
    >
      <template #description>
        {{ errorMessage }}
      </template>
    </FaAlert>

    <div class="gap-6 grid grid-cols-1 md:grid-cols-[160px_minmax(0,1fr)]">
      <aside class="p-4 text-center border border-border rounded-lg bg-muted/30 flex flex-col gap-3 items-center">
        <FaAvatar
          :src="previewUrl ?? ''"
          class="border-4 border-background size-24 shadow-sm"
        >
          <FaIcon name="i-carbon:user-avatar-filled" class="text-muted-foreground size-12" />
        </FaAvatar>
        <div class="min-w-0 w-full space-y-1">
          <div class="text-foreground font-medium truncate">
            {{ appAccountStore.displayName }}
          </div>
          <div class="text-xs text-muted-foreground truncate">
            {{ appAccountStore.account }}
          </div>
        </div>
        <p class="text-xs text-muted-foreground leading-5">
          {{ t('accountProfile.avatarPreview') }}
        </p>
      </aside>

      <section class="min-w-0">
        <div v-if="loading && initialProfile === null" class="text-sm text-muted-foreground py-10 flex-center gap-2">
          <FaIcon name="i-svg-spinners:90-ring-with-bg" class="text-primary size-5" />
          {{ t('accountProfile.loading') }}
        </div>

        <FaForm
          v-else
          id="account-profile-form"
          ref="formRef"
          :model="model"
          :disabled="submitting || loadFailed || initialProfile === null"
          class="gap-4"
          @submit="submit"
        >
          <div class="gap-4 grid grid-cols-1 sm:grid-cols-2">
            <FaFormItem name="email" :label="t('accountProfile.email')">
              <FaInput
                v-model="model.email"
                type="email"
                autocomplete="email"
                clearable
                class="w-full"
                :placeholder="t('accountProfile.emailPlaceholder')"
                @clear="model.email = ''"
              />
            </FaFormItem>
            <FaFormItem name="mobileE164" :label="t('accountProfile.mobileE164')">
              <FaInput
                v-model="model.mobileE164"
                type="tel"
                autocomplete="tel"
                clearable
                class="w-full"
                :placeholder="t('accountProfile.mobilePlaceholder')"
                @clear="model.mobileE164 = ''"
              />
            </FaFormItem>
          </div>

          <FaFormItem name="avatarUrl" :label="t('accountProfile.avatarUrl')">
            <FaInput
              v-model="model.avatarUrl"
              type="url"
              autocomplete="url"
              clearable
              class="w-full"
              :placeholder="t('accountProfile.avatarPlaceholder')"
              @clear="model.avatarUrl = ''"
            />
          </FaFormItem>
        </FaForm>
      </section>
    </div>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="submitting"
        @click="close"
      >
        {{ t('accountProfile.cancel') }}
      </FaButton>
      <FaButton
        type="submit"
        form="account-profile-form"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :loading="submitting"
        :disabled="!canSubmit"
      >
        {{ t('accountProfile.save') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
