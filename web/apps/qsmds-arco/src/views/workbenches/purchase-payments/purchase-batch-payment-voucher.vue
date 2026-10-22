<script setup lang="ts">
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { IMAGE_ONLY_ACCEPT, UPLOAD_POLICIES, validateUploadFile } from '@/utils/upload-policy'

const props = defineProps<{ modelValue: File | null, disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [file: File | null] }>()
const { t } = useI18n()
const images = ref<string[]>([])
const preview = ref('')
const error = ref('')

function clearPreview() {
  if (preview.value) {
    URL.revokeObjectURL(preview.value)
  }
  preview.value = ''
}
function select({ file }: { file: File }) {
  if (props.disabled) {
    return null
  }
  error.value = ''
  const failure = validateUploadFile(file, UPLOAD_POLICIES.IMAGE_ONLY)
  if (failure !== null) {
    error.value = t(
      failure === 'too-large'
        ? 'purchasePayment.batch.imageTooLarge'
        : failure === 'empty'
          ? 'purchasePayment.batch.imageEmpty'
          : 'purchasePayment.batch.imageOnly',
    )
    return null
  }
  emit('update:modelValue', file)
  return null
}
function remove() {
  if (!props.disabled) {
    emit('update:modelValue', null)
  }
}
// 截图只在此处本地预览；提交时由父级统一上传并归档到所选订单，切换供应商会释放旧图。
watch(() => props.modelValue, (file) => {
  clearPreview()
  error.value = ''
  if (file) {
    preview.value = URL.createObjectURL(file)
  }
}, { immediate: true })
onBeforeUnmount(clearPreview)
</script>

<template>
  <div class="gap-3 grid min-w-0">
    <div class="p-3 border border-border rounded-lg bg-background gap-3 grid min-w-0">
      <div v-if="modelValue && preview" class="flex gap-3 min-w-0 items-center">
        <ImageGroup :items="[{ src: preview, alt: modelValue.name }]" :size="64" :max-count="1" fit="contain" :tooltip="false" class="shrink-0 [&_img]:size-15.5!" />
        <div class="gap-1 grid min-w-0">
          <p class="qs-type-meta m-0 [overflow-wrap:anywhere]">
            {{ modelValue.name }}
          </p>
          <p class="qs-type-meta text-muted-foreground m-0">
            {{ t('purchasePayment.batch.previewVoucher') }}
          </p>
        </div>
      </div>
      <FaImageUpload v-else v-model="images" :accept="IMAGE_ONLY_ACCEPT" :max="1" :width="192" :height="104" :disabled="disabled" :http-request="select" :aria-label="t('purchasePayment.batch.uploadVoucher')" class="max-w-full">
        <span class="text-muted-foreground border border-border rounded-lg border-dashed flex flex-col gap-2 size-full items-center justify-center">
          <FaIcon name="i-lucide:image-plus" class="size-6" aria-hidden="true" />
          <span class="qs-type-meta">{{ t('purchasePayment.batch.uploadVoucher') }}</span>
        </span>
      </FaImageUpload>
      <div v-if="modelValue" class="pt-2 border-t border-border flex flex-wrap gap-1 justify-end">
        <FaButton type="button" variant="outline" size="sm" :disabled="disabled" class="min-h-11 sm:min-h-8" @click="remove">
          {{ t('purchasePayment.batch.replaceVoucher') }}
        </FaButton>
        <FaButton type="button" variant="ghost" size="sm" :disabled="disabled" class="text-muted-foreground min-h-11 hover:text-destructive sm:min-h-8" @click="remove">
          {{ t('purchasePayment.batch.removeVoucher') }}
        </FaButton>
      </div>
    </div>
    <p v-if="error" role="alert" class="qs-type-meta text-destructive m-0">
      {{ error }}
    </p>
    <p class="qs-type-meta text-muted-foreground m-0">
      {{ t('purchasePayment.batch.voucherHint') }}
    </p>
  </div>
</template>
