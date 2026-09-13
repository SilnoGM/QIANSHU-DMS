<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import { getPurchaseOrderPartRecords } from './logic'

const props = defineProps<{ detail: PurchaseOrderDetailDto }>()
const { t } = useI18n()
const parts = computed(() => getPurchaseOrderPartRecords(props.detail).map(part => ({
  ...part,
  images: part.items.flatMap(item => item.imageSrc
    ? [{
        key: item.purchaseOrderLineId,
        src: item.imageSrc,
        alt: item.productName ?? '',
        tooltip: [item.productName, item.productNo].filter(Boolean).join(' · '),
      }]
    : []),
})))
const expandedPart = ref<string | null>(null)
// 同一个抽屉切换采购单时恢复默认收起，避免沿用上单的货件展开状态。
watch(() => props.detail.id, () => {
  expandedPart.value = null
})
function partTitle(partNumber: number): string {
  return t('purchaseOrderDrawer.parts.part', { number: String(partNumber).padStart(2, '0') })
}
</script>

<template>
  <section v-if="parts.length > 0" data-slot="purchase-order-drawer-parts" :aria-label="t('purchaseOrderDrawer.parts.title')" class="pt-5 border-t border-border/70">
    <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
      <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
      {{ t('purchaseOrderDrawer.parts.title') }}
      <span class="qs-type-meta px-2 py-0.5 rounded-md bg-muted tabular-nums">{{ parts.length }}</span>
    </h3>
    <div class="space-y-2.5">
      <article v-for="part in parts" :key="part.id" :data-part-number="part.partNumber" class="border border-border rounded-xl overflow-hidden">
        <!-- 复制按钮与展开按钮为并列控件，避免按钮嵌套导致点击复制时同时展开。 -->
        <div class="p-3 flex gap-2 min-w-0 items-start sm:p-4">
          <FaButton
            type="button"
            variant="ghost"
            class="p-1 text-start flex flex-1 gap-3 h-auto min-h-11 min-w-0 items-start justify-start"
            :aria-label="partTitle(part.partNumber)"
            :aria-expanded="expandedPart === part.id"
            :aria-controls="`purchase-part-${detail.id}-${part.id}`"
            @click="expandedPart = expandedPart === part.id ? null : part.id"
          >
            <FaIcon name="i-lucide:chevron-down" class="text-muted-foreground mt-0.5 shrink-0 size-4 transition-transform duration-150 motion-reduce:transition-none" :class="expandedPart === part.id ? 'rotate-180' : ''" aria-hidden="true" />
            <span class="min-w-0">
              <span class="flex flex-wrap gap-2 items-center">
                <span class="qs-type-body-medium">{{ partTitle(part.partNumber) }}</span>
                <FaTag variant="outline" :class="part.status === 'ACTIVE' ? 'text-primary border-primary/30 bg-primary/10' : part.status === 'CANCELLED' ? 'text-destructive border-destructive/30 bg-destructive/10' : 'text-amber-700 border-amber-500/30 bg-amber-500/10 dark:text-amber-300'">
                  {{ t(`purchaseOrderDrawer.parts.status.${part.status}`) }}
                </FaTag>
              </span>
              <span class="qs-type-data text-muted-foreground mt-1.5 block whitespace-pre-wrap [overflow-wrap:anywhere]">{{ part.shippingMarkText ?? t(detail.orderStatus === 'PENDING_REVIEW' ? 'purchaseOrderDrawer.parts.pendingMark' : 'purchaseOrderDrawer.parts.notGenerated') }}</span>
            </span>
          </FaButton>
          <!-- 保留图片位宽高，淡出时不挤动标题；预览按钮独立于折叠按钮。 -->
          <div v-if="part.images.length" class="shrink-0 h-12 w-25 self-center relative">
            <Transition
              enter-active-class="transition-opacity duration-150 ease-out motion-reduce:transition-none"
              leave-active-class="transition-opacity duration-150 ease-out motion-reduce:transition-none"
              enter-from-class="opacity-0"
              leave-to-class="opacity-0"
            >
              <ImageGroup
                v-if="expandedPart !== part.id"
                :items="part.images"
                :max-count="3"
                :size="40"
                :tooltip="true"
                class="right-0 top-1 absolute"
              />
            </Transition>
          </div>
          <CopyCellButton v-if="part.shippingMarkText" always-visible :label="`${partTitle(part.partNumber)}${t('purchaseOrderDrawer.parts.shippingMark')}`" :text="part.shippingMarkText" class="[&_button]:size-11 sm:[&_button]:size-9" />
        </div>
        <FaCollapsible :model-value="expandedPart === part.id">
          <div :id="`purchase-part-${detail.id}-${part.id}`" class="border-t border-border/70">
            <ol class="m-0 p-0 list-none divide-border/70 divide-y">
              <li v-for="item in part.items" :key="item.purchaseOrderLineId" :data-line-number="item.lineNumber" class="p-4 flex gap-3 min-w-0 items-start">
                <ImageGroup v-if="item.imageSrc" :items="[{ src: item.imageSrc, alt: item.productName ?? '' }]" :size="56" :max-count="1" class="shrink-0" />
                <span v-else class="text-muted-foreground border border-border rounded-lg bg-muted/25 flex shrink-0 size-14 items-center justify-center"><FaIcon name="i-lucide:image-off" class="size-5" aria-hidden="true" /></span>
                <div class="flex-1 min-w-0">
                  <p class="qs-type-meta m-0 [overflow-wrap:anywhere]" :class="item.productNo ? 'font-mono' : ''">
                    {{ item.productNo || (item.productName ? t('purchaseOrderDesc.lineTypes.CUSTOM') : '-') }}
                  </p>
                  <p class="qs-type-body-medium m-0 mt-1 [overflow-wrap:anywhere]">
                    {{ item.productName || t('purchaseOrderDrawer.parts.productUnavailable') }}
                  </p>
                  <p class="qs-type-meta m-0 mt-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {{ t('purchaseOrderDesc.fields.lineRemark') }}{{ item.description || '-' }}
                  </p>
                  <p class="text-sm m-0 mt-2 flex flex-wrap gap-2 items-baseline">
                    <span class="text-muted-foreground">{{ t('purchaseOrderDrawer.parts.quantity') }}</span>
                    <span data-part-quantity class="qs-type-data-emphasis">{{ item.quantity }}</span>
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </FaCollapsible>
      </article>
    </div>
  </section>
</template>
