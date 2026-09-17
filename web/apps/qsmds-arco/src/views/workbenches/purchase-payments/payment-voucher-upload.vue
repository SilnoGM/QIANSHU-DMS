<script setup lang="ts">
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { usePurchasePaymentVoucher } from './use-purchase-payment-voucher'

const props = defineProps<{ modelValue: string | null, payableId: string, enabled: boolean, disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [id: string | null], 'busyChange': [busy: boolean] }>()
const { t } = useI18n()
const account = useAppAccountStore()
const images = ref<string[]>([])
const { uploading, previewUrl, filename, error, upload, remove } = usePurchasePaymentVoucher(
  computed(() => props.payableId),
  computed(() => props.enabled),
  computed(() => account.authEpoch),
  computed(() => props.disabled),
  id => emit('update:modelValue', id),
)
async function requestUpload({ file }: { file: File }) {
  await upload(file)
  return null
}
watch(uploading, value => emit('busyChange', value), { immediate: true })
onBeforeUnmount(() => emit('busyChange', false))
</script>

<template>
  <div class="space-y-3">
    <div class="p-4 border border-border rounded-lg bg-background space-y-3">
      <ImageGroup v-if="previewUrl" :items="[{ src: previewUrl, alt: filename, previewSrc: previewUrl }]" :size="160" :max-count="1" fit="contain" />
      <FaImageUpload v-else v-model="images" :max="1" :width="192" :height="144" :disabled="disabled || uploading || !enabled" :http-request="requestUpload" :aria-label="t('purchasePayment.uploadVoucher')">
        <span class="text-muted-foreground border border-border rounded-lg border-dashed flex flex-col gap-2 size-full items-center justify-center">
          <FaIcon :name="uploading ? 'i-lucide:loader-circle' : 'i-lucide:image-plus'" class="size-7" :class="{ 'animate-spin': uploading }" aria-hidden="true" />
          <span class="qs-type-meta">{{ t(uploading ? 'purchasePayment.uploading' : 'purchasePayment.uploadVoucher') }}</span>
        </span>
      </FaImageUpload>
      <p v-if="filename" class="qs-type-meta m-0 break-all">
        {{ filename }}
      </p>
      <div v-if="modelValue" class="flex flex-wrap gap-2">
        <FaButton type="button" variant="outline" :disabled="disabled || uploading || !enabled" class="flex-1 min-h-11" @click="remove">
          {{ t('purchasePayment.replaceVoucher') }}
        </FaButton>
        <FaButton type="button" variant="ghost" :disabled="disabled || uploading || !enabled" class="min-h-11" @click="remove">
          {{ t('purchasePayment.removeVoucher') }}
        </FaButton>
      </div>
    </div>
    <p v-if="uploading" role="status" class="qs-type-meta text-muted-foreground m-0">
      {{ t('purchasePayment.uploading') }}
    </p>
    <p v-if="error" role="alert" class="qs-type-meta text-destructive m-0">
      {{ error === 'purchasePayment.imageOnly' ? t(error) : error }}
    </p>
    <p class="qs-type-meta text-muted-foreground m-0">
      {{ t('purchasePayment.voucherArchiveHint') }}
    </p>
  </div>
</template>
