<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

defineOptions({
  name: 'SwitchAddForm',
})

const emits = defineEmits<{
  success: [account: string]
}>()

const { t } = useI18n()
const appAccountStore = useAppAccountStore()

const loading = ref(false)

interface SwitchAddModel {
  account: string
  password: string
}

const model = ref<SwitchAddModel>({
  account: '',
  password: '',
})

const validationSchema = toTypedSchema(z.object({
  account: z.string().min(1, t('app.components.accountForm.switchAdd.rules.account')),
  password: z.string().min(1, t('app.components.accountForm.switchAdd.rules.password')),
}))

function onSubmit(values: SwitchAddModel) {
  loading.value = true
  appAccountStore.multipleAccountsCheck(values).then(() => {
    emits('success', values.account)
  }).finally(() => {
    loading.value = false
  })
}
</script>

<template>
  <div class="p-12 flex-col-stretch-center w-full">
    <FaBlurReveal :delay="0.2" :duration="0.4" class="mb-6 space-y-2">
      <h3 class="text-4xl font-bold">
        {{ t('app.components.accountForm.switchAdd.intro') }}
      </h3>
      <p class="text-sm text-muted-foreground lg:text-base">
        {{ t('app.components.accountForm.switchAdd.subIntro') }}
      </p>
    </FaBlurReveal>
    <FaForm class="max-w-sm w-full" :model="model" :validation-schema="validationSchema" @submit="onSubmit">
      <FaFormItem name="account">
        <FaInput type="text" :placeholder="t('app.components.accountForm.switchAdd.form.account')" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:user" />
          </template>
        </FaInput>
      </FaFormItem>
      <FaFormItem name="password">
        <FaInput type="password" :placeholder="t('app.components.accountForm.switchAdd.form.password')" class="w-full">
          <template #start>
            <FaIcon name="i-lucide:lock" />
          </template>
        </FaInput>
      </FaFormItem>
      <FaButton :loading="loading" size="lg" class="mt-8 w-full" type="submit">
        {{ t('app.components.accountForm.switchAdd.form.login') }}
      </FaButton>
    </FaForm>
  </div>
</template>
