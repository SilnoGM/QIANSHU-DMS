<script setup lang="ts">
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { IMAGE_ONLY_ACCEPT } from '@/utils/upload-policy'
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
  <div class="gap-3 grid min-w-0">
    <div class="p-4 border border-border rounded-lg bg-background gap-4 grid min-w-0">
      <div v-if="previewUrl" class="gap-4 grid grid-cols-[96px_minmax(0,1fr)] items-center">
        <ImageGroup :items="[{ src: previewUrl, alt: filename, previewSrc: previewUrl }]" :size="96" :max-count="1" fit="contain" />
        <div class="gap-2 grid min-w-0">
          <p class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
            {{ filename }}
          </p>
          <p class="qs-type-meta text-primary m-0 flex gap-1.5 items-center dark:text-emerald-300">
            <FaIcon name="i-lucide:circle-check" class="shrink-0 size-4" aria-hidden="true" />
            {{ t('purchasePayment.voucherUploaded') }}
          </p>
          <p class="qs-type-meta text-muted-foreground m-0">
            {{ t('purchasePayment.previewVoucher') }}
          </p>
        </div>
      </div>
      <FaImageUpload v-else v-model="images" :accept="IMAGE_ONLY_ACCEPT" :max="1" :width="192" :height="144" :disabled="disabled || uploading || !enabled" :http-request="requestUpload" :aria-label="t('purchasePayment.uploadVoucher')">
        <span class="text-muted-foreground border border-border rounded-lg border-dashed flex flex-col gap-2 size-full items-center justify-center">
          <FaIcon :name="uploading ? 'i-lucide:loader-circle' : 'i-lucide:image-plus'" class="size-7" :class="{ 'animate-spin': uploading }" aria-hidden="true" />
          <span class="qs-type-meta">{{ t(uploading ? 'purchasePayment.uploading' : 'purchasePayment.uploadVoucher') }}</span>
        </span>
      </FaImageUpload>
      <div v-if="modelValue" class="pt-3 border-t border-border flex flex-wrap gap-2 justify-end">
        <FaButton type="button" variant="outline" size="sm" :disabled="disabled || uploading || !enabled" class="min-h-11 sm:min-h-9" @click="remove">
          <FaIcon name="i-lucide:replace" class="size-4" aria-hidden="true" />
          {{ t('purchasePayment.replaceVoucher') }}
        </FaButton>
        <FaButton type="button" variant="ghost" size="sm" :disabled="disabled || uploading || !enabled" class="text-muted-foreground min-h-11 hover:text-destructive sm:min-h-9" @click="remove">
          <FaIcon name="i-lucide:trash-2" class="size-4" aria-hidden="true" />
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
