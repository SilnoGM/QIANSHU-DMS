<script setup lang="ts">
import type { FactoryShipmentModalPurchaseOrder, FactoryShipmentPart } from './types'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import { isPendingShipmentPart } from './logic'

const props = defineProps<{
  order: FactoryShipmentModalPurchaseOrder
  selectedIds: readonly string[]
  disabled?: boolean
}>()
const emit = defineEmits<{ toggle: [partId: string] }>()
const expandedId = ref<string | null>(null)
const records = computed(() => props.order.parts.map(part => ({
  ...part,
  products: part.items.map(item => ({
    ...props.order.lineSummary.previews.find(preview => preview.lineId === item.purchaseOrderLineId),
    lineId: item.purchaseOrderLineId,
    quantity: item.quantity,
  })),
})))
function images(part: typeof records.value[number]) {
  return part.products.flatMap(product => product.mainImage
    ? [{
        key: product.lineId,
        src: product.mainImage.contentUrl,
        alt: product.productName ?? '',
        tooltip: [product.productName, product.productNo].filter(Boolean).join(' · '),
      }]
    : [])
}
function toggleCard(event: MouseEvent, part: FactoryShipmentPart): void {
  if (event.target instanceof Element && event.target.closest('button, a, input, label, [role="button"]')) {
    return
  }
  expandedId.value = expandedId.value === part.id ? null : part.id
}
</script>

<template>
  <div class="space-y-2.5" data-slot="shipment-parts">
    <p class="qs-type-meta text-muted-foreground m-0">
      已发 {{ order.parts.filter(part => part.shippedAt).length }} / {{ order.parts.length }} 件
    </p>
    <article v-for="part in records" :key="part.id" class="border border-primary rounded-xl cursor-pointer transition-colors duration-150 overflow-hidden hover:bg-muted/25 motion-reduce:transition-none" @click="toggleCard($event, part)">
      <div class="p-3 flex gap-3 items-center">
        <input
          type="checkbox"
          class="accent-primary shrink-0 size-4"
          :aria-label="`货件-${part.partNumber}：选择发货`"
          :checked="selectedIds.includes(part.id)"
          :disabled="disabled || !isPendingShipmentPart(part)"
          @change="emit('toggle', part.id)"
        >
        <button type="button" class="py-1 text-start flex flex-1 gap-2 min-w-0 items-start" :aria-expanded="expandedId === part.id" :aria-controls="`shipment-part-${part.id}`" @click="expandedId = expandedId === part.id ? null : part.id">
          <FaIcon name="i-lucide:chevron-down" class="mt-1 shrink-0 size-4 transition-transform duration-150 motion-reduce:transition-none" :class="expandedId === part.id ? 'rotate-180' : ''" />
          <span class="min-w-0">
            <span class="flex flex-wrap gap-2 items-center">
              <strong class="qs-type-body-medium">货件-{{ String(part.partNumber).padStart(2, '0') }}</strong>
              <FaTag variant="outline" :class="part.shippedAt ? 'text-primary border-primary/30 bg-primary/10' : 'text-amber-700 border-amber-500/30 bg-amber-500/10 dark:text-amber-300'">{{ part.shippedAt ? '已发货' : part.status === 'ACTIVE' ? '待发货' : '不可发货' }}</FaTag>
            </span>
            <span class="qs-type-data text-muted-foreground mt-1.5 block break-all">唛头：{{ part.shippingMarkText || '未记录' }}</span>
          </span>
        </button>
        <div v-if="images(part).length" class="shrink-0 h-12 w-25 relative">
          <Transition enter-active-class="transition-opacity duration-150 motion-reduce:transition-none" leave-active-class="transition-opacity duration-150 motion-reduce:transition-none" enter-from-class="opacity-0" leave-to-class="opacity-0">
            <ImageGroup v-if="expandedId !== part.id" :items="images(part)" :max-count="3" :size="40" :tooltip="true" class="right-0 top-1 absolute" />
          </Transition>
        </div>
        <CopyCellButton v-if="part.shippingMarkText" always-visible :text="part.shippingMarkText" label="货件唛头" />
      </div>
      <FaCollapsible :model-value="expandedId === part.id">
        <div :id="`shipment-part-${part.id}`" class="p-4 border-t border-border/70 space-y-3">
          <p v-if="part.shippedAt" class="qs-type-meta text-muted-foreground m-0 whitespace-pre-wrap">
            发货时间：<DateTimeDisplay :value="part.shippedAt" /><br>
            记录时间：<DateTimeDisplay :value="part.shipmentRecordedAt" /><br>
            操作人：{{ part.shippedBy?.displayName || '未记录' }}<br>
            发货说明：{{ part.shipmentRemark || '—' }}
          </p>
          <div v-for="product in part.products" :key="product.lineId" class="flex gap-3 items-start">
            <ImageGroup v-if="product.mainImage" :items="[{ src: product.mainImage.contentUrl, alt: product.productName ?? '' }]" :size="48" :max-count="1" />
            <FaIcon v-else name="i-lucide:image-off" class="text-muted-foreground shrink-0 size-12" />
            <div class="min-w-0">
              <p v-if="product.productNo" class="qs-type-meta text-muted-foreground m-0 break-all">
                {{ product.productNo }}
              </p>
              <p class="qs-type-body-medium m-0 break-words">
                {{ product.productName || '产品信息未记录' }}
              </p>
              <p v-if="product.description" class="qs-type-meta text-muted-foreground m-0 mt-1 whitespace-pre-wrap">
                备注：{{ product.description }}
              </p>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                本货件数量 <strong class="qs-type-data-emphasis text-foreground">{{ product.quantity }}</strong>
              </p>
            </div>
          </div>
        </div>
      </FaCollapsible>
    </article>
    <p v-if="order.parts.length === 0" class="qs-type-meta text-muted-foreground">
      未记录货件，无法发货。
    </p>
  </div>
</template>
