<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

defineOptions({
  name: 'LoginAgainForm',
})

const emits = defineEmits<{
  onAfterLogin: [account?: string]
}>()

const { t } = useI18n()
const appSettingsStore = useAppSettingsStore()
const appAccountStore = useAppAccountStore()
const appPreferencesStore = useAppPreferencesStore()

const loading = ref(false)

// 登录方式，default 账号密码登录，qrcode 扫码登录
const type = ref<'default' | 'qrcode'>('default')

interface LoginAgainModel {
  account: string
  password: string
}

const model = ref<LoginAgainModel>({
  account: appAccountStore.account,
  password: '',
})

const validationSchema = toTypedSchema(z.object({
  account: z.string().min(1, t('app.components.accountForm.loginAgain.rules.account')),
  password: z.string().min(1, t('app.components.accountForm.loginAgain.rules.password')),
}))

function onSubmit(values: LoginAgainModel) {
  loading.value = true
  appAccountStore.login(values).then(async () => {
    // 获取用户权限
    appSettingsStore.settings.app.account.auth && await appAccountStore.getPermissions()
    // 获取用户偏好设置
    appPreferencesStore.isEnabled && await appPreferencesStore.getPreferences()
    emits('onAfterLogin', values.account)
  }).finally(() => {
    loading.value = false
  })
}
</script>

<template>
  <div class="p-12 flex-col-stretch-center w-full">
    <FaBlurReveal :delay="0.2" :duration="0.4" class="mb-6 space-y-2">
      <h3 class="text-4xl font-bold">
        {{ t('app.components.accountForm.loginAgain.intro') }}
      </h3>
      <p class="text-sm text-muted-foreground lg:text-base">
        {{ t('app.components.accountForm.loginAgain.subIntro') }}
      </p>
    </FaBlurReveal>
    <div class="mb-4">
      <FaTabs
        v-model="type" :list="[
          { label: t('app.components.accountForm.loginAgain.accountLogin'), value: 'default' },
          { label: t('app.components.accountForm.loginAgain.qrcodeLogin'), value: 'qrcode' },
        ]" class="inline-flex"
      />
    </div>
    <div v-show="type === 'default'">
      <FaForm :model="model" :validation-schema="validationSchema" @submit="onSubmit">
        <FaFormItem name="account">
          <FaInput type="text" :placeholder="t('app.components.accountForm.loginAgain.form.account')" disabled class="w-full">
            <template #start>
              <FaIcon name="i-lucide:user" />
            </template>
          </FaInput>
        </FaFormItem>
        <FaFormItem name="password">
          <FaInput type="password" :placeholder="t('app.components.accountForm.loginAgain.form.password')" class="w-full">
            <template #start>
              <FaIcon name="i-lucide:lock" />
            </template>
          </FaInput>
        </FaFormItem>
        <FaButton :loading="loading" size="lg" class="mt-8 w-full" type="submit">
          {{ t('app.components.accountForm.loginAgain.form.login') }}
        </FaButton>
      </FaForm>
    </div>
    <div v-show="type === 'qrcode'">
      <div class="flex-col-center">
        <img src="https://s2.loli.net/2024/04/26/GsahtuIZ9XOg5jr.png" class="h-[250px] w-[250px]">
        <div class="text-sm text-secondary-foreground mt-2 op-50">
          {{ t('app.components.accountForm.loginAgain.wechatQrcode') }}
        </div>
      </div>
    </div>
  </div>
</template>
