<script setup lang="ts">
import type { PartConfiguratorProduct } from './types'

defineProps<{ product?: PartConfiguratorProduct }>()
const { t } = useI18n()
</script>

<template>
  <div class="flex gap-3 min-w-0 items-start">
    <FaImagePreview
      v-if="product?.mainImage"
      :src="product.mainImage.contentUrl"
      :aria-label="product.name"
      class="border border-border rounded-md shrink-0 size-14"
    />
    <div v-else :aria-label="t('partConfigurator.noImage')" class="text-muted-foreground border border-border rounded-md bg-muted/40 flex shrink-0 size-14 items-center justify-center">
      <FaIcon name="i-lucide:image" class="size-5" aria-hidden="true" />
    </div>
    <div class="flex-1 min-w-0">
      <p class="text-xs text-muted-foreground m-0 break-all">
        {{ product?.productNo || t('partConfigurator.localProduct') }}
      </p>
      <p class="text-sm text-foreground font-medium my-1 break-words">
        {{ product?.name || t('partConfigurator.missingProduct') }}
      </p>
      <p class="text-xs text-muted-foreground m-0 whitespace-pre-wrap break-words">
        {{ product?.description || t('partConfigurator.noDescription') }}
      </p>
    </div>
  </div>
</template>
