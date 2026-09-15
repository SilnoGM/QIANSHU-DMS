<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
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
// 卡片空白和文本均可展开，图片预览、复制等交互控件保留独立行为。
function toggleCard(event: MouseEvent, partId: string): void {
  if (event.target instanceof Element && event.target.closest('button, a, input, textarea, [role="button"]')) {
    return
  }
  expandedPart.value = expandedPart.value === partId ? null : partId
}
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
      <article v-for="part in parts" :key="part.id" :data-part-number="part.partNumber" class="border border-primary rounded-xl cursor-pointer transition-colors duration-150 overflow-hidden hover:bg-muted/25 motion-reduce:transition-none" @click="toggleCard($event, part.id)">
        <!-- 复制按钮与展开按钮为并列控件，避免按钮嵌套导致点击复制时同时展开。 -->
        <div class="p-3 flex gap-2 min-w-0 items-start sm:p-4">
          <div class="flex-1 min-w-0">
            <div class="pl-8 flex gap-2 min-w-0 items-center">
              <span class="qs-type-data-emphasis min-w-0 [overflow-wrap:anywhere]" :class="!part.shipmentNo && 'text-muted-foreground'">{{ part.shipmentNo || t('purchaseOrderDrawer.parts.unnumbered') }}</span>
              <CopyCellButton v-if="part.shipmentNo" always-visible :text="part.shipmentNo" :label="t('purchaseOrderDrawer.parts.shipmentNo')" />
            </div>
            <FaButton
              type="button"
              variant="ghost"
              class="p-1 text-start flex gap-3 h-auto min-h-11 min-w-0 w-full items-start justify-start hover:bg-transparent dark:hover:bg-transparent"
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
                  <FaTag v-if="part.status === 'ACTIVE'" variant="outline" :class="part.shippedAt ? 'text-primary border-primary/30 bg-primary/10' : 'text-amber-700 border-amber-500/30 bg-amber-500/10 dark:text-amber-300'">{{ part.warehouseReceivedAt ? t('purchaseWarehouseReceipt.received') : part.shippedAt ? '已发货' : '待发货' }}</FaTag>
                </span>
                <span class="qs-type-data text-muted-foreground mt-1.5 block whitespace-pre-wrap [overflow-wrap:anywhere]">{{ part.shippingMarkText ? t('purchaseOrderDrawer.parts.markValue', { value: part.shippingMarkText }) : t(detail.orderStatus === 'PENDING_REVIEW' ? 'purchaseOrderDrawer.parts.pendingMark' : 'purchaseOrderDrawer.parts.notGenerated') }}</span>
              </span>
            </FaButton>
          </div>
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
            <div v-if="part.shippedAt" class="qs-type-meta text-muted-foreground p-4 space-y-2">
              <p class="m-0 whitespace-pre-wrap">
                发货时间：<DateTimeDisplay :value="part.shippedAt" /> · {{ part.shippedBy?.displayName || '未记录操作人' }}<br>
                发货说明：{{ part.shipmentRemark || '—' }}
              </p>
              <dl class="m-0 flex gap-2 min-w-0 items-start">
                <dt class="shrink-0">
                  {{ t('purchaseOrderDrawer.parts.trackingNo') }}：
                </dt>
                <dd class="m-0 flex gap-2 min-w-0 items-start">
                  <span class="min-w-0 [overflow-wrap:anywhere]" :class="part.trackingNo ? 'qs-type-data text-foreground' : ''">{{ part.trackingNo || t('purchaseOrderDrawer.parts.trackingNoMissing') }}</span>
                  <CopyCellButton v-if="part.trackingNo" always-visible :text="part.trackingNo" :label="t('purchaseOrderDrawer.parts.trackingNo')" />
                </dd>
              </dl>
            </div>
            <dl v-if="part.warehouseReceivedAt" class="qs-type-meta m-0 px-4 pb-4 gap-3 grid sm:grid-cols-2">
              <div>
                <dt class="text-muted-foreground mb-1">
                  {{ t('purchaseWarehouseReceipt.receivedAt') }}
                </dt><dd class="m-0">
                  <DateTimeDisplay :value="part.warehouseReceivedAt" />
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground mb-1">
                  {{ t('purchaseWarehouseReceipt.operator') }}
                </dt><dd class="m-0">
                  <QsPersonDisplay v-if="part.warehouseReceivedBy" :display-name="part.warehouseReceivedBy.displayName" size="md" /><span v-else>—</span>
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground mb-1">
                  {{ t('purchaseWarehouseReceipt.recordedAt') }}
                </dt><dd class="m-0">
                  <DateTimeDisplay :value="part.warehouseRecordedAt" />
                </dd>
              </div>
              <div v-if="part.warehouseRemark" class="min-w-0 sm:col-span-2">
                <dt class="text-muted-foreground mb-1">
                  {{ t('purchaseWarehouseReceipt.remarkLabel') }}
                </dt><dd class="m-0 whitespace-pre-wrap break-all">
                  {{ part.warehouseRemark }}
                </dd>
              </div>
            </dl>
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
