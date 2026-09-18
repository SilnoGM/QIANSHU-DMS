<script setup lang="ts">
import type { PackagingCostRequestDto } from '@/api/generated/types.gen'
import ImageGroup from '@/components/base/ImageGroup/index.vue'

defineProps<{ record: PackagingCostRequestDto }>()
const { t } = useI18n()
const groups = ['PACKAGING', 'QUOTATION'] as const
function image(record: PackagingCostRequestDto, kind: typeof groups[number]) {
  const asset = kind === 'PACKAGING' ? record.packagingImage : record.quotationImage
  return [{ key: asset.mediaAssetId, src: `/api/packaging-cost-requests/${encodeURIComponent(record.id)}/images/${kind}`, alt: t(`packagingPayment.images.${kind}`), tooltip: t(`packagingPayment.images.${kind}`) }]
}
</script>

<template>
  <div class="flex gap-4 items-start">
    <div v-for="kind in groups" :key="kind" class="space-y-1">
      <ImageGroup :items="image(record, kind)" :max-count="1" :size="40" fit="contain" />
      <p class="qs-type-meta text-muted-foreground m-0">
        {{ t(`packagingPayment.imageShort.${kind}`) }}
      </p>
    </div>
  </div>
</template>
