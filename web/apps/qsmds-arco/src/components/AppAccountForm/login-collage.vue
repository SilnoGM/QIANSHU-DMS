<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type { InvalidSubmissionContext } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
import { useQsToast } from '@/components/base/QsToast/useQsToast'

defineOptions({ name: 'LoginCollageForm' })

const emits = defineEmits<{ onLogin: [] }>()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()

const loading = ref(false)
const checking = ref(false)
const errorMessage = ref('')
const resultUnknown = ref(false)
const displayedErrorMessage = computed(() => {
  if (errorMessage.value !== '') {
    return errorMessage.value
  }
  return appAccountStore.errorCode === 'PASSWORD_CHANGE_RESULT_UNKNOWN'
    ? '修改结果未知，请优先使用刚设置的新密码登录'
    : ''
})
const canCheckLoginState = computed(() => {
  return resultUnknown.value || appAccountStore.authState === 'unavailable'
})

interface LoginModel {
  username: string
  password: string
}

const model = ref<LoginModel>({ username: '', password: '' })
const formRef = useTemplateRef<FormExpose<LoginModel>>('formRef')
const validationSchema = toTypedSchema(z.object({
  username: z.string().min(1, '请输入账号'),
  password: z.string().min(1, '请输入密码'),
}))

async function handleInvalidSubmit(ctx: InvalidSubmissionContext) {
  const firstField = (['username', 'password'] as const).find(field => Boolean(ctx.errors[field]))
  if (firstField === undefined) {
    return
  }
  // FaForm 的 scrollToField 同时滚动并聚焦真实控件；等错误 DOM 完成后再执行。
  await nextTick()
  formRef.value?.scrollToField(firstField)
}

function readErrorCode(error: unknown): string | null {
  if (
    typeof error === 'object'
    && error !== null
    && 'body' in error
    && typeof error.body === 'object'
    && error.body !== null
    && 'code' in error.body
    && typeof error.body.code === 'string'
  ) {
    return error.body.code
  }
  return null
}

function safeErrorMessage(error: unknown): string {
  if (readErrorCode(error) === 'INVALID_CREDENTIALS') {
    return '账号或密码错误'
  }
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
  return '登录失败，请稍后重试'
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

async function onSubmit(values: LoginModel) {
  if (loading.value) {
    return
  }
  loading.value = true
  errorMessage.value = ''
  resultUnknown.value = false
  try {
    await appAccountStore.login(values)
    model.value.password = ''
    if (appAccountStore.authState === 'authenticated') {
      emits('onLogin')
    }
  }
  catch (error) {
    model.value.password = ''
    resultUnknown.value = isUnknownResult(error)
    errorMessage.value = safeErrorMessage(error)
  }
  finally {
    loading.value = false
  }
}

async function checkLoginState() {
  if (checking.value) {
    return
  }
  checking.value = true
  errorMessage.value = ''
  try {
    await appAccountStore.revalidateAfterMutation()
    if (appAccountStore.authState === 'authenticated') {
      resultUnknown.value = false
      emits('onLogin')
    }
    else if (appAccountStore.authState === 'anonymous') {
      resultUnknown.value = true
      errorMessage.value = '当前仍未登录，可稍后再次检查或重新输入密码登录'
    }
  }
  catch (error) {
    resultUnknown.value = true
    errorMessage.value = safeErrorMessage(error)
  }
  finally {
    checking.value = false
  }
}

function openForgotPassword() {
  toast.info('请联系管理员重置！')
}
</script>

<template>
  <section class="login-card" aria-labelledby="loginTitle">
    <h1 id="loginTitle" class="qs-type-page-title">
      欢迎登录
    </h1>
    <p class="card-sub">
      内部业务数据工作台 · <strong>管理员分配账号登录</strong>
    </p>

    <FaAlert
      v-if="displayedErrorMessage"
      variant="destructive"
      icon="i-lucide:circle-alert"
      class="login-alert"
    >
      <template #description>
        <div class="alert-body">
          <p class="m-0">
            {{ displayedErrorMessage }}
          </p>
          <button
            v-if="canCheckLoginState"
            type="button"
            class="alert-action"
            :disabled="checking"
            @click="checkLoginState"
          >
            {{ checking ? '检查中…' : '检查登录状态' }}
          </button>
        </div>
      </template>
    </FaAlert>

    <FaForm
      ref="formRef"
      :model="model"
      :validation-schema="validationSchema"
      :disabled="loading"
      class="login-form"
      :class="{ 'pointer-events-none': loading }"
      @submit="onSubmit"
      @invalid-submit="handleInvalidSubmit"
    >
      <FaFormItem name="username" label="账号" required>
        <FaInput
          type="text"
          placeholder="请输入账号"
          autocomplete="username"
          autocapitalize="off"
          spellcheck="false"
          enterkeyhint="next"
          class="login-input h-12 w-full"
          input-class="h-full"
        >
          <template #start>
            <FaIcon name="i-lucide:user" />
          </template>
        </FaInput>
      </FaFormItem>

      <FaFormItem name="password" label="密码" required>
        <FaInput
          type="password"
          placeholder="请输入登录密码"
          maxlength="20"
          autocomplete="current-password"
          autocapitalize="off"
          spellcheck="false"
          enterkeyhint="go"
          class="login-input h-12 w-full"
          input-class="h-full"
        >
          <template #start>
            <FaIcon name="i-lucide:lock" />
          </template>
        </FaInput>
      </FaFormItem>

      <div class="forgot-row">
        <button type="button" class="forgot-link" @click="openForgotPassword">
          忘记密码？
        </button>
      </div>

      <FaButton
        type="submit"
        size="lg"
        :loading="loading"
        :disabled="loading"
        class="login-submit w-full"
      >
        {{ loading ? '登录中…' : '登录系统' }}
      </FaButton>
    </FaForm>
  </section>
</template>

<style scoped>
.login-card {
  position: relative;
  width: 100%;
  max-width: 400px;
  padding: 40px;
  color: oklch(var(--foreground));
  background: oklch(var(--card));
  border: 1px solid color-mix(in oklch, oklch(var(--card)), oklch(var(--border)) 70%);
  border-radius: 24px;
  box-shadow: 0 25px 60px -15px rgb(6 78 59 / 12%), 0 4px 20px -2px rgb(0 0 0 / 3%);
}

.card-sub {
  margin: 6px 0 28px;
  font-size: 12px;
  line-height: 18px;
  color: oklch(var(--muted-foreground));
}

.card-sub strong {
  font-weight: 500;
  color: var(--login-accent-text);
}

.login-alert {
  padding: 10px 12px;
  margin-bottom: 20px;
  background: oklch(var(--destructive) / 6%);
  border-color: oklch(var(--destructive) / 22%);
  border-radius: 12px;
}

.login-alert :deep([data-slot="alert-description"]) {
  color: oklch(var(--foreground));
}

.alert-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.alert-action {
  align-self: flex-start;
  padding: 0;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  color: oklch(var(--destructive));
  text-decoration: underline;
  text-underline-offset: 3px;
  background: transparent;
  border: 0;
}

.alert-action:hover {
  text-decoration-thickness: 2px;
}

.alert-action:disabled {
  opacity: 0.55;
}

.login-form :deep([data-slot="input-group"]) {
  height: 48px;
  background: oklch(var(--muted) / 55%);
  border-color: oklch(var(--input));
  border-radius: 12px;
  box-shadow: none;
}

.login-form :deep([data-slot="input-group"]:hover) {
  background: oklch(var(--muted) / 78%);
}

.login-form :deep([data-slot="input-group"]:has([data-slot="input-group-control"]:focus-visible)) {
  background: oklch(var(--background));
  border-color: oklch(var(--primary) / 60%);
  box-shadow: 0 0 0 4px oklch(var(--primary) / 10%);
}

.login-form :deep([data-slot="input-group"]:has([data-slot="input-group-control"][aria-invalid="true"])) {
  background: oklch(var(--destructive) / 4%);
  border-color: oklch(var(--destructive) / 65%);
}

.login-form :deep([data-slot="input-group"]:has([data-slot="input-group-control"][aria-invalid="true"]):focus-within) {
  box-shadow: 0 0 0 4px oklch(var(--destructive) / 8%);
}

.forgot-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
}

.forgot-link {
  padding: 0;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  color: var(--login-accent-text);
  background: transparent;
  border: 0;
}

.forgot-link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.login-submit {
  height: 48px;
  margin-top: 18px;
  border-radius: 12px;
  box-shadow: 0 10px 24px -10px oklch(var(--primary) / 55%);
}

.login-submit:disabled {
  pointer-events: none;
  opacity: 0.6;
}

@media (width <= 640px) {
  .login-card {
    padding: 28px;
    border-radius: 20px;
  }
}
</style>
