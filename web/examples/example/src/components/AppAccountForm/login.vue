<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

defineOptions({
  name: 'LoginForm',
})

const props = defineProps<{
  account?: string
}>()

const emits = defineEmits<{
  onLogin: [account?: string]
  onRegister: [account?: string]
  onResetPassword: [account?: string]
}>()

const { t } = useI18n()
const appAccountStore = useAppAccountStore()

const title = import.meta.env.VITE_APP_TITLE
const loading = ref(false)

// 登录方式，default 账号密码登录，qrcode 扫码登录
const type = ref<'default' | 'qrcode'>('default')

const formRef = useTemplateRef<FormExpose>('formRef')

interface LoginModel {
  account: string
  password: string
  remember: boolean
}

const model = ref<LoginModel>({
  account: props.account ?? localStorage.getItem('login_account') ?? '',
  password: '',
  remember: localStorage.has('login_account'),
})

const validationSchema = toTypedSchema(z.object({
  account: z.string().min(1, t('app.components.accountForm.login.rules.account')),
  password: z.string().min(1, t('app.components.accountForm.login.rules.password')),
  remember: z.boolean(),
}))

function onSubmit(values: LoginModel) {
  loading.value = true
  const formValues = values
  appAccountStore.login(formValues).then(() => {
    if (formValues.remember) {
      localStorage.setItem('login_account', formValues.account)
    }
    else {
      localStorage.removeItem('login_account')
    }
    emits('onLogin', formValues.account)
  }).finally(() => {
    loading.value = false
  })
}

async function testAccount(account: string) {
  model.value.account = account
  model.value.password = '123456'
  formRef.value?.submit()
}
</script>

<template>
  <div class="p-12 flex-col-stretch-center min-h-500px w-full">
    <FaBlurReveal :delay="0.2" :duration="0.4" class="mb-6 space-y-2">
      <h3 class="text-4xl font-bold">
        {{ t('app.components.accountForm.login.intro') }}
      </h3>
      <p class="text-sm text-muted-foreground lg:text-base">
        {{ title }}
      </p>
    </FaBlurReveal>
    <div class="mb-4">
      <FaTabs
        v-model="type" :list="[
          { label: t('app.components.accountForm.login.accountLogin'), value: 'default' },
          { label: t('app.components.accountForm.login.qrcodeLogin'), value: 'qrcode' },
        ]" class="inline-flex"
      />
    </div>
    <div v-show="type === 'default'">
      <FaForm
        ref="formRef"
        :model="model"
        :validation-schema="validationSchema"
        @submit="onSubmit"
      >
        <FaFormItem name="account">
          <FaInput type="text" :placeholder="t('app.components.accountForm.login.form.account')" class="w-full">
            <template #start>
              <FaIcon name="i-lucide:user" />
            </template>
          </FaInput>
        </FaFormItem>
        <FaFormItem name="password">
          <FaInput type="password" :placeholder="t('app.components.accountForm.login.form.password')" class="w-full">
            <template #start>
              <FaIcon name="i-lucide:lock" />
            </template>
          </FaInput>
        </FaFormItem>
        <div class="flex-start-between">
          <FaFormItem name="remember" class="min-w-0">
            <FaCheckbox>
              {{ t('app.components.accountForm.login.remember') }}
            </FaCheckbox>
          </FaFormItem>
          <FaButton variant="link" class="p-0 h-auto" type="button" @click="emits('onResetPassword', model.account)">
            {{ t('app.components.accountForm.login.forget') }}
          </FaButton>
        </div>
        <FaButton :loading="loading" size="lg" class="w-full" type="submit">
          {{ t('app.components.accountForm.login.form.login') }}
        </FaButton>
        <div class="text-sm mt-4 flex-center gap-2">
          <span class="text-secondary-foreground op-50">{{ t('app.components.accountForm.login.noAccount') }}</span>
          <FaButton variant="link" class="p-0 h-auto" type="button" @click="emits('onRegister', model.account)">
            {{ t('app.components.accountForm.login.register') }}
          </FaButton>
        </div>
      </FaForm>
      <div class="mt-4 text-center -mb-4">
        <FaDivider>{{ t('app.components.accountForm.login.testLogin') }}</FaDivider>
        <div class="space-x-2">
          <FaButton variant="default" size="sm" plain @click="testAccount('admin')">
            admin
          </FaButton>
          <FaButton variant="outline" size="sm" plain @click="testAccount('test')">
            test
          </FaButton>
        </div>
      </div>
    </div>
    <div v-show="type === 'qrcode'">
      <div class="flex-col-center">
        <img src="https://s2.loli.net/2024/04/26/GsahtuIZ9XOg5jr.png" class="h-[250px] w-[250px]">
        <div class="text-sm text-secondary-foreground mt-2 op-50">
          {{ t('app.components.accountForm.login.wechatQrcode') }}
        </div>
      </div>
    </div>
  </div>
</template>
