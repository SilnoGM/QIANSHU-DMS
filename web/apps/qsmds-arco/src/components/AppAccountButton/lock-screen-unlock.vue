<script setup lang="ts">
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'

const props = defineProps<{
  lockPassword: string
}>()

const emits = defineEmits<{
  success: []
}>()

const { t } = useI18n()

interface UnlockFormModel {
  unlockPassword: string
}

const model = ref<UnlockFormModel>({
  unlockPassword: '',
})

const validationSchema = toTypedSchema(z.object({
  unlockPassword: z.string().min(1, t('app.components.accountButton.lockScreenUnlock.rules.unlockPassword')),
}))

function onUnlock(values: UnlockFormModel) {
  if (values.unlockPassword === props.lockPassword) {
    emits('success')
  }
  else {
    useFaToast().error(t('app.components.accountButton.lockScreenUnlock.form.unlockPasswordError'))
  }
}
</script>

<template>
  <FaForm
    class="gap-4 justify-items-center"
    :model="model"
    :validation-schema="validationSchema"
    @submit="onUnlock"
  >
    <FaFormItem name="unlockPassword" message-class="text-center">
      <FaInput type="password" :placeholder="t('app.components.accountButton.lockScreenUnlock.form.unlockPassword')" class="text-center" />
    </FaFormItem>
    <FaButton size="lg" type="submit">
      {{ t('app.components.accountButton.lockScreenUnlock.form.unlock') }}
    </FaButton>
  </FaForm>
</template>
