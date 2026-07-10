<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

defineOptions({
  name: 'RegisterForm',
})

const props = defineProps<{
  account?: string
}>()

const emits = defineEmits<{
  onLogin: [account?: string]
  onRegister: [account?: string]
}>()

const { t } = useI18n()

const loading = ref(false)

interface RegisterModel {
  account: string
  password: string
  checkPassword: string
}

const model = ref<RegisterModel>({
  account: props.account ?? '',
  password: '',
  checkPassword: '',
})

const validationSchema = toTypedSchema(
  z.object({
    account: z.string().min(1, t('app.components.accountForm.register.rules.account')),
    password: z.string().min(1, t('app.components.accountForm.register.rules.password')).min(6, t('app.components.accountForm.register.rules.passwordLength')).max(18, t('app.components.accountForm.register.rules.passwordLength')),
    checkPassword: z.string().min(1, t('app.components.accountForm.register.rules.checkPassword')),
  }).refine(data => data.password === data.checkPassword, {
    message: t('app.components.accountForm.register.rules.checkPasswordError'),
    path: ['checkPassword'],
  }),
)

function onSubmit(values: RegisterModel) {
  loading.value = true
  emits('onRegister', values.account)
}
</script>

<template>
  <div class="p-12 flex-col-stretch-center min-h-500px w-full">
    <FaForm :model="model" :validation-schema="validationSchema" @submit="onSubmit">
      <FaBlurReveal :delay="0.2" :duration="0.4" class="mb-8 space-y-2">
        <h3 class="text-4xl font-bold">
          {{ t('app.components.accountForm.register.intro') }}
        </h3>
        <p class="text-sm text-muted-foreground lg:text-base">
          {{ t('app.components.accountForm.register.demoUnavailable') }}
        </p>
      </FaBlurReveal>
      <FaFormItem name="account">
        <FaInput type="text" :placeholder="t('app.components.accountForm.register.form.account')" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:user" />
          </template>
        </FaInput>
      </FaFormItem>
      <FaFormItem name="password">
        <FaInput type="password" :placeholder="t('app.components.accountForm.register.form.password')" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:lock" />
          </template>
        </FaInput>
        <FaPasswordStrength :password="model.password" />
      </FaFormItem>
      <FaFormItem name="checkPassword">
        <FaInput type="password" :placeholder="t('app.components.accountForm.register.form.checkPassword')" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:lock" />
          </template>
        </FaInput>
      </FaFormItem>
      <FaButton :loading="loading" size="lg" class="mt-4 w-full" type="submit">
        {{ t('app.components.accountForm.register.form.register') }}
      </FaButton>
      <div class="text-sm mt-4 flex-center gap-2">
        <span class="text-secondary-foreground op-50">{{ t('app.components.accountForm.register.hasAccount') }}</span>
        <FaButton variant="link" class="p-0 h-auto" type="button" @click="emits('onLogin', model.account)">
          {{ t('app.components.accountForm.register.login') }}
        </FaButton>
      </div>
    </FaForm>
  </div>
</template>
