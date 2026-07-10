<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

defineOptions({
  name: 'ResetPasswordForm',
})

const props = defineProps<{
  account?: string
}>()

const emits = defineEmits<{
  onLogin: [account?: string]
  onResetPassword: [account?: string]
}>()

const { t } = useI18n()

const loading = ref(false)

interface ResetPasswordModel {
  account: string
  captcha: string
  newPassword: string
}

const model = ref<ResetPasswordModel>({
  account: props.account ?? '',
  captcha: '',
  newPassword: '',
})

const validationSchema = toTypedSchema(z.object({
  account: z.string().min(1, t('app.components.accountForm.resetPassword.rules.account')),
  captcha: z.string().min(6, t('app.components.accountForm.resetPassword.rules.captcha')),
  newPassword: z.string().min(1, t('app.components.accountForm.resetPassword.rules.newPassword')).min(6, t('app.components.accountForm.resetPassword.rules.newPasswordLength')).max(18, t('app.components.accountForm.resetPassword.rules.newPasswordLength')),
}))

function onSubmit(values: ResetPasswordModel) {
  loading.value = true
  emits('onResetPassword', values.account)
}

const countdown = ref(0)
const countdownInterval = ref(Number.NaN)
function handleSendCaptcha() {
  countdown.value = 60
  countdownInterval.value = window.setInterval(() => {
    countdown.value--
    if (countdown.value === 0) {
      clearInterval(countdownInterval.value)
    }
  }, 1000)
}
</script>

<template>
  <div class="p-12 flex-col-stretch-center min-h-500px w-full">
    <FaForm :model="model" :validation-schema="validationSchema" @submit="onSubmit">
      <FaBlurReveal :delay="0.2" :duration="0.4" class="mb-8 space-y-2">
        <h3 class="text-4xl font-bold">
          {{ t('app.components.accountForm.resetPassword.intro') }}
        </h3>
        <p class="text-sm text-muted-foreground lg:text-base">
          {{ t('app.components.accountForm.resetPassword.demoUnavailable') }}
        </p>
      </FaBlurReveal>
      <FaFormItem name="account">
        <FaInput type="text" :placeholder="t('app.components.accountForm.resetPassword.form.account')" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:user" />
          </template>
        </FaInput>
      </FaFormItem>
      <FaFormItem name="captcha" :auto-bind="false">
        <div class="flex-start-between gap-2">
          <FaInputOTP
            v-model="model.captcha"
            name="captcha"
            :length="6"
            class="border-destructive"
          />
          <FaButton variant="outline" type="button" :disabled="countdown > 0" class="px-4 flex-1" @click="handleSendCaptcha">
            {{ countdown === 0 ? t('app.components.accountForm.resetPassword.form.sendCaptcha') : t('app.components.accountForm.resetPassword.form.captchaCountdown', [countdown]) }}
          </FaButton>
        </div>
      </FaFormItem>
      <FaFormItem name="newPassword">
        <FaInput type="password" :placeholder="t('app.components.accountForm.resetPassword.form.newPassword')" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:lock" />
          </template>
        </FaInput>
      </FaFormItem>
      <FaButton :loading="loading" size="lg" class="mt-4 w-full" type="submit">
        {{ t('app.components.accountForm.resetPassword.form.confirm') }}
      </FaButton>
      <div class="text-sm mt-4 flex-center gap-2">
        <FaButton variant="link" class="p-0 h-auto" type="button" @click="emits('onLogin', model.account)">
          {{ t('app.components.accountForm.resetPassword.login') }}
        </FaButton>
      </div>
    </FaForm>
  </div>
</template>
