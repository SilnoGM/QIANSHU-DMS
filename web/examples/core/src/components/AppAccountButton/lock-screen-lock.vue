<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

const emits = defineEmits<{
  success: [lockPassword: string]
}>()

const { t } = useI18n()

interface LockFormModel {
  lockPassword: string
}

const model = ref<LockFormModel>({
  lockPassword: '',
})

const validationSchema = toTypedSchema(z.object({
  lockPassword: z.string().min(1, t('app.components.accountButton.lockScreenLock.rules.lockPassword')),
}))

function onLock(values: LockFormModel) {
  emits('success', values.lockPassword)
}
</script>

<template>
  <FaForm
    class="gap-4 justify-items-center"
    :model="model"
    :validation-schema="validationSchema"
    @submit="onLock"
  >
    <FaFormItem name="lockPassword" message-class="text-center">
      <FaInput type="password" :placeholder="t('app.components.accountButton.lockScreenLock.form.lockPassword')" class="text-center" />
    </FaFormItem>
    <FaButton size="lg" type="submit">
      {{ t('app.components.accountButton.lockScreenLock.form.lock') }}
    </FaButton>
  </FaForm>
</template>
