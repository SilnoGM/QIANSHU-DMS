<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

defineOptions({
  name: 'EditPasswordForm',
})

const { t } = useI18n()
const appAccountStore = useAppAccountStore()

const loading = ref(false)

interface EditPasswordModel {
  password: string
  newPassword: string
  checkPassword: string
}

const model = ref<EditPasswordModel>({
  password: '',
  newPassword: '',
  checkPassword: '',
})

const validationSchema = toTypedSchema(
  z.object({
    password: z.string().min(1, t('app.components.accountForm.editPassword.rules.password')),
    newPassword: z.string().min(1, t('app.components.accountForm.editPassword.rules.newPassword')).min(6, t('app.components.accountForm.editPassword.rules.passwordLength')).max(18, t('app.components.accountForm.editPassword.rules.passwordLength')),
    checkPassword: z.string().min(1, t('app.components.accountForm.editPassword.rules.checkPassword')),
  }).refine(data => data.newPassword === data.checkPassword, {
    message: t('app.components.accountForm.editPassword.rules.checkPasswordError'),
    path: ['checkPassword'],
  }),
)

function onSubmit(values: EditPasswordModel) {
  loading.value = true
  appAccountStore.editPassword(values).then(async () => {
    useFaToast().success(t('app.components.accountForm.editPassword.success'))
    appAccountStore.logout()
  }).finally(() => {
    loading.value = false
  })
}
</script>

<template>
  <div class="flex-col-stretch-center w-full">
    <FaBlurReveal :delay="0.2" :duration="0.4" class="mb-6 space-y-2">
      <h3 class="text-4xl font-bold">
        {{ t('app.components.accountForm.editPassword.intro') }}
      </h3>
      <p class="text-sm text-muted-foreground lg:text-base">
        {{ t('app.components.accountForm.editPassword.subIntro') }}
      </p>
    </FaBlurReveal>
    <FaForm :model="model" :validation-schema="validationSchema" @submit="onSubmit">
      <FaFormItem name="password">
        <FaInput type="password" :placeholder="t('app.components.accountForm.editPassword.form.password')" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:lock" />
          </template>
        </FaInput>
      </FaFormItem>
      <FaFormItem name="newPassword">
        <FaInput type="password" :placeholder="t('app.components.accountForm.editPassword.form.newPassword')" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:lock" />
          </template>
        </FaInput>
      </FaFormItem>
      <FaFormItem name="checkPassword">
        <FaInput type="password" :placeholder="t('app.components.accountForm.editPassword.form.checkPassword')" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:lock" />
          </template>
        </FaInput>
      </FaFormItem>
      <FaButton :loading="loading" size="lg" class="mt-8 w-full" type="submit">
        {{ t('app.components.accountForm.editPassword.form.save') }}
      </FaButton>
    </FaForm>
  </div>
</template>
