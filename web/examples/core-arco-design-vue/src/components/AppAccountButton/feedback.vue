<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import { toTypedSchema } from '@vee-validate/zod'
import { snapdom } from '@zumer/snapdom'
import * as z from 'zod'
import FeedbackCanvas from './feedback-canvas.vue'

const emits = defineEmits<{
  close: []
}>()

const { t } = useI18n()

const canvasBase64 = ref('')
const isLoading = ref(false)
const formRef = useTemplateRef<FormExpose>('formRef')

interface FeedbackModel {
  description: string
}

const model = ref<FeedbackModel>({
  description: '',
})

async function onGenerate() {
  if (isLoading.value) {
    return
  }
  isLoading.value = true
  const result = await snapdom(document.getElementById('app-content')!)
  canvasBase64.value = await result.toRaw()
  isLoading.value = false
}

const validationSchema = toTypedSchema(z.object({
  description: z.string().min(1, t('app.components.accountButton.feedback.rules.description')),
}))

function onSubmit(values: FeedbackModel) {
  const result: Record<string, any> = {
    ...values,
  }
  if (canvasBase64.value) {
    result.canvasBase64 = canvasBase64.value
  }
  // eslint-disable-next-line no-console
  console.log(result)
  emits('close')
  useFaToast().success(t('app.components.accountButton.feedback.submitSuccess'))
}

defineExpose({
  onSubmit: () => formRef.value?.submit(),
})
</script>

<template>
  <div class="pb-2 flex flex-col gap-4">
    <FeedbackCanvas v-if="canvasBase64" v-model="canvasBase64" />
    <div
      v-else class="p-12 border-2 rounded-lg border-dashed flex-col-center gap-2 cursor-pointer transition-all relative" :class="{
        'hover:border-muted-foreground': !isLoading,
        'opacity-50': isLoading,
      }" @click="onGenerate"
    >
      <FaIcon name="i-ri:screenshot-2-line" class="text-muted-foreground opacity-50 size-20" />
      <div class="text-sm text-muted-foreground">
        {{ t('app.components.accountButton.feedback.tips') }}
      </div>
      <div v-if="isLoading" class="flex-col-center inset-b-4 absolute">
        <FaIcon name="i-line-md:loading-twotone-loop" class="text-muted-foreground size-6" />
      </div>
    </div>
    <FaForm
      ref="formRef"
      :model="model"
      :validation-schema="validationSchema"
      @submit="onSubmit"
    >
      <FaFormItem name="description">
        <FaTextarea class="w-full" :placeholder="t('app.components.accountButton.feedback.description')" />
      </FaFormItem>
      <FaButton class="w-full" type="submit">
        {{ t('app.components.accountButton.feedback.submit') }}
      </FaButton>
    </FaForm>
  </div>
</template>
