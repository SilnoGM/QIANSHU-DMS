<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

defineOptions({ name: 'LoginForm' })

const emits = defineEmits<{ onLogin: [] }>()
const appAccountStore = useAppAccountStore()
const title = import.meta.env.VITE_APP_TITLE
const loading = ref(false)
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

interface LoginModel {
  username: string
  password: string
}

const model = ref<LoginModel>({ username: '', password: '' })
const validationSchema = toTypedSchema(z.object({
  username: z.string().min(1, '请输入用户名'),
  password: z.string().min(1, '请输入密码').refine(
    (value) => {
      const length = Array.from(value).length
      return length >= 8 && length <= 20
    },
    '密码长度应为 8 至 20 个字符',
  ),
}))

function safeErrorMessage(error: unknown): string {
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
}
</script>

<template>
  <div class="p-8 flex-col-stretch-center min-h-440px w-full sm:p-12">
    <FaBlurReveal :delay="0.2" :duration="0.4" class="mb-8 space-y-2">
      <h3 class="text-4xl font-bold">
        欢迎登录
      </h3>
      <p class="text-sm text-muted-foreground lg:text-base">
        {{ title }}
      </p>
    </FaBlurReveal>
    <AAlert v-if="displayedErrorMessage" type="error" class="mb-4">
      {{ displayedErrorMessage }}
      <template v-if="resultUnknown || appAccountStore.authState === 'unavailable'" #action>
        <AButton size="mini" @click="checkLoginState">
          检查登录状态
        </AButton>
      </template>
    </AAlert>
    <FaForm :model="model" :validation-schema="validationSchema" @submit="onSubmit">
      <FaFormItem name="username">
        <FaInput type="text" placeholder="用户名" autocomplete="username" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:user" />
          </template>
        </FaInput>
      </FaFormItem>
      <FaFormItem name="password">
        <FaInput type="password" placeholder="密码" autocomplete="current-password" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:lock" />
          </template>
        </FaInput>
      </FaFormItem>
      <FaButton :loading="loading" :disabled="loading" size="lg" class="mt-3 w-full" type="submit">
        登录
      </FaButton>
    </FaForm>
  </div>
</template>
