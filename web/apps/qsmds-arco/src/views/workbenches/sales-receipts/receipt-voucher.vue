<script setup lang="ts">
import type { SalesReceiptVoucherDto } from '@/api/generated/types.gen'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'
import ImageGroup from '@/components/base/ImageGroup/index.vue'

const props = defineProps<{
  voucher?: SalesReceiptVoucherDto | null
  url: string
}>()
const { t } = useI18n()
const failedSource = ref<string | null>(null)
const source = computed(() => props.url.trim())
const isAvailable = computed(() => Boolean(props.voucher && source.value))
const isImage = computed(() => props.voucher?.mediaType === 'IMAGE')
const imageItems = computed<ImageGroupItem[]>(() => {
  const voucher = props.voucher
  return voucher && source.value && isImage.value
    ? [{ key: voucher.mediaAssetId, src: source.value, alt: voucher.title, tooltip: voucher.title }]
    : []
})
const imageFailed = computed(() => failedSource.value === source.value)
watch(() => [props.voucher?.mediaAssetId, source.value], () => {
  failedSource.value = null
})
</script>

<template>
  <ImageGroup
    v-if="isAvailable && isImage"
    :items="imageItems"
    :max-count="1"
    :size="44"
    fit="contain"
    radius="lg"
    @image-error="failedSource = $event.item.src"
  >
    <template #error="{ item }">
      <span class="flex size-full items-center justify-center" :aria-label="`${item.alt || t('salesReceipt.voucherTitle')} · ${t('salesReceipt.voucherImageFailed')}`">
        <FaIcon name="i-lucide:image-off" class="size-5" aria-hidden="true" />
      </span>
    </template>
    <template #tooltip="{ item }">
      <div class="max-w-full w-52 space-y-2">
        <img v-if="!imageFailed" :src="item.src" :alt="item.alt" class="border border-border rounded-lg bg-background w-full aspect-square object-contain">
        <div v-else class="text-muted-foreground border border-border rounded-lg bg-muted flex w-full aspect-square items-center justify-center">
          <FaIcon name="i-lucide:image-off" class="size-8" aria-hidden="true" />
        </div>
        <p class="m-0 break-words">
          {{ item.tooltip }}
        </p>
        <p class="text-xs m-0 opacity-75">
          {{ t(imageFailed ? 'salesReceipt.voucherImageFailed' : 'salesReceipt.voucherImageHint') }}
        </p>
      </div>
    </template>
  </ImageGroup>
  <FaTooltip v-else-if="isAvailable" :text="`${voucher?.title} · ${t('salesReceipt.voucherFileHint')}`" :delay="300">
    <a :href="source" target="_blank" rel="noopener noreferrer" :aria-label="`${voucher?.title} · ${t('salesReceipt.voucherFileHint')}`" class="qs-type-body text-primary inline-flex gap-2 max-w-full min-h-11 min-w-11 items-center" @click.stop>
      <FaIcon name="i-lucide:file-text" class="shrink-0 size-5" aria-hidden="true" />
      <span class="max-w-40 min-w-0 truncate">{{ voucher?.title }}</span>
      <FaIcon name="i-lucide:external-link" class="shrink-0 size-3.5" aria-hidden="true" />
    </a>
  </FaTooltip>
  <span v-else class="qs-type-meta inline-flex gap-2 min-h-11 items-center">
    <FaIcon name="i-lucide:image-off" class="size-5" aria-hidden="true" />{{ t('salesReceipt.voucherEmpty') }}
  </span>
</template>
