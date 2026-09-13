<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'

defineProps<{ detail: PurchaseOrderDetailDto }>()
const { t } = useI18n()
</script>

<template>
  <div class="pr-1 flex flex-col gap-4">
    <dl class="m-0 gap-3 grid sm:grid-cols-2">
      <div class="min-w-0">
        <dt class="qs-type-meta text-muted-foreground">
          {{ t('purchaseOrderList.review.orderNo') }}
        </dt>
        <dd class="qs-type-data-emphasis m-0 mt-1 break-all">
          {{ detail.orderNo }}
        </dd>
      </div>
      <div class="min-w-0 sm:text-right">
        <dt class="qs-type-meta text-muted-foreground">
          {{ t('purchaseOrderList.review.supplier') }}
        </dt>
        <dd class="qs-type-body-medium m-0 mt-1 break-words">
          {{ detail.supplier.label }}
        </dd>
      </div>
    </dl>
    <section class="p-4 border border-primary/30 rounded-lg bg-primary/5" :aria-label="t('purchaseOrderDesc.fields.baseShippingMark')">
      <h3 class="qs-type-meta text-muted-foreground m-0">
        {{ t('purchaseOrderDesc.fields.baseShippingMark') }}
      </h3>
      <div class="mt-2 flex gap-3 items-start justify-between">
        <p class="qs-type-data-emphasis m-0 whitespace-pre-wrap break-all">
          {{ detail.shippingMarkText || t('purchaseOrderDrawer.baseMarkNotRecorded') }}
        </p>
        <CopyCellButton v-if="detail.shippingMarkText" always-visible :text="detail.shippingMarkText" :label="t('purchaseOrderDesc.fields.baseShippingMark')" class="shrink-0" />
      </div>
    </section>
    <p v-if="detail.parts.length === 0" class="qs-type-meta text-muted-foreground m-0">
      {{ t('purchaseOrderList.review.noParts') }}
    </p>
  </div>
</template>
