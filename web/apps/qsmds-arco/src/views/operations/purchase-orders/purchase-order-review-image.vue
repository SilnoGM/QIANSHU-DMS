<script setup lang="ts">
import type { PurchaseOrderImageDraftDto } from '@/api/generated/types.gen'
import { formatDateTime } from '@/components/base/DateTimeDisplay/format'

const props = defineProps<{
  draft: PurchaseOrderImageDraftDto | null
  previewUrl: string | null
  imageLoaded: boolean
  imageFailed: boolean
  busy: boolean
  canGenerate: boolean
}>()
const emit = defineEmits<{
  generate: [regenerate: boolean]
  imageLoad: [url: string]
  imageError: [url: string]
}>()
const { t } = useI18n()

function openFocusedPreview(event: KeyboardEvent): void {
  if (props.imageLoaded && event.currentTarget instanceof HTMLElement) {
    event.currentTarget.querySelector('img')?.click()
  }
}
</script>

<template>
  <FaCard
    data-slot="purchase-order-review-image"
    class="py-0 border-border/70 rounded-xl gap-0 shadow-none"
    header-class="p-4 pb-3"
    content-class="p-4 pt-0"
  >
    <template #header>
      <div class="flex flex-wrap gap-3 items-center justify-between">
        <div class="flex gap-2 min-w-0 items-center">
          <h3 class="qs-type-body-medium m-0">
            {{ t('purchaseReview.image.title') }}
          </h3>
          <FaTag v-if="draft" variant="outline" :class="draft.isCurrent ? 'border-primary/30 bg-primary/5 text-primary' : 'border-destructive/30 bg-destructive/5 text-destructive'">
            {{ t(draft.isCurrent ? 'purchaseReview.image.ready' : 'purchaseReview.image.outdated') }}
          </FaTag>
        </div>
        <FaButton type="button" :variant="draft ? 'outline' : 'default'" size="sm" class="min-h-11 sm:min-h-8" :disabled="busy || !canGenerate" @click="emit('generate', draft !== null)">
          <FaIcon :name="draft ? 'i-lucide:refresh-cw' : 'i-lucide:image-plus'" aria-hidden="true" />
          {{ t(draft ? 'purchaseReview.image.regenerate' : 'purchaseReview.image.generate') }}
        </FaButton>
      </div>
    </template>
    <div class="flex flex-col gap-3 min-w-0">
      <p v-if="!draft || !draft.isCurrent || imageFailed" class="qs-type-body m-0" :class="imageFailed ? 'text-destructive' : 'text-muted-foreground'">
        {{ t(imageFailed ? 'purchaseReview.image.loadFailed' : draft ? 'purchaseReview.image.stale' : 'purchaseReview.image.required') }}
      </p>
      <div v-if="previewUrl" class="p-3 border border-border/60 rounded-lg bg-muted/15 flex min-w-0 justify-center">
        <FaImagePreview
          :key="previewUrl"
          :src="previewUrl"
          :aria-label="t('purchaseReview.image.preview')"
          :aria-disabled="!imageLoaded"
          role="button"
          tabindex="0"
          class="h-56 max-w-full w-48 object-contain sm:h-64 sm:w-56"
          @load="emit('imageLoad', previewUrl)"
          @error="emit('imageError', previewUrl)"
          @keydown.enter.prevent="openFocusedPreview"
          @keydown.space.prevent="openFocusedPreview"
        />
      </div>
      <div class="flex flex-wrap gap-x-3 gap-y-1 items-center justify-between">
        <span v-if="draft" class="qs-type-meta break-words">
          {{ t('purchaseReview.image.createdBy', { time: formatDateTime(draft.generatedAt), name: draft.generatedBy.displayName }) }}
        </span>
        <span v-if="previewUrl" class="qs-type-meta">{{ t('purchaseReview.image.preview') }}</span>
      </div>
      <p class="qs-type-meta m-0">
        {{ t('purchaseReview.image.retained') }}
      </p>
    </div>
  </FaCard>
</template>
