<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { mediaThumbnailUrl } from '@/utils/media-variant'
import { getOrderDocuments } from './logic'
import OrderDocument from './OrderDocument.vue'

const props = defineProps<{ detail: PurchaseOrderDetailDto, canAttachDocument: boolean, busy: boolean }>()
const emit = defineEmits<{ attachDocument: [] }>()
const { t } = useI18n()
// 付款截图归档在订单凭证中；实际付款记录也引用同一份媒体，不重复保存。
const documents = computed(() => getOrderDocuments(props.detail.documents))
const expandedDocument = ref<string | null>(null)
watch(() => props.detail.id, () => {
  expandedDocument.value = null
})
</script>

<template>
  <section :aria-label="t('purchaseOrderDrawer.documents')" class="pt-5 border-t border-border/70">
    <div class="mb-3 flex flex-wrap gap-3 items-center justify-between">
      <h3 class="qs-type-component-title m-0 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
        {{ t('purchaseOrderDrawer.documents') }}
        <span class="qs-type-meta px-2 py-0.5 rounded-md bg-muted tabular-nums">{{ documents.length }}</span>
      </h3>
      <FaButton v-if="canAttachDocument && detail.orderStatus !== 'PENDING_REVIEW'" type="button" size="sm" variant="outline" :disabled="busy" @click="emit('attachDocument')">
        <FaIcon name="i-lucide:plus" aria-hidden="true" />{{ t('purchaseOrderDrawer.attachDocument') }}
      </FaButton>
    </div>
    <FaEmpty v-if="!documents.length" :title="t('purchaseOrderDrawer.noDocuments')" class="py-6" />
    <div v-else class="space-y-2.5">
      <FaCollapsible
        v-for="document in documents" :key="document.id" :model-value="expandedDocument === document.id"
        class="border border-border rounded-xl transition-colors duration-150 overflow-hidden [&_[data-slot=collapsible-trigger]]:w-full motion-reduce:transition-none"
        :class="expandedDocument === document.id ? 'border-primary/35' : ''"
        @update:model-value="expandedDocument = $event ? document.id : null"
      >
        <template #trigger="{ open }">
          <TransitionGroup name="document-summary" tag="span" class="p-4 text-start flex gap-3 min-h-22 min-w-0 items-center relative hover:bg-muted/25 sm:gap-4">
            <span v-if="!open" key="thumbnail" class="border border-border/70 rounded-lg bg-muted/20 flex shrink-0 size-14 items-center justify-center overflow-hidden">
              <img v-if="document.mediaType === 'IMAGE' && document.contentUrl" :src="mediaThumbnailUrl(document.contentUrl) ?? document.contentUrl" :alt="t(`purchaseOrderDrawer.documentTypes.${document.documentType}`)" class="size-full object-cover">
              <FaIcon v-else name="i-lucide:file-text" class="text-muted-foreground size-6" aria-hidden="true" />
            </span>
            <span key="details" class="flex-1 min-w-0">
              <span class="flex flex-wrap gap-2 items-center">
                <span class="qs-type-body-medium [overflow-wrap:anywhere]">{{ document.title || document.originalFilename }}</span>
                <FaTag variant="outline" :class="document.documentType === 'DELIVERY_RECEIPT' ? 'text-emerald-700 border-emerald-500/30 bg-emerald-500/8 dark:text-emerald-300' : 'text-sky-700 border-sky-500/30 bg-sky-500/8 dark:text-sky-300'">
                  {{ t(`purchaseOrderDrawer.documentTypes.${document.documentType}`) }}
                </FaTag>
              </span>
              <span class="qs-type-meta mt-1.5 block"><DateTimeDisplay :value="document.createdAt" /></span>
            </span>
            <span key="toggle" class="text-muted-foreground rounded-full bg-muted/50 flex shrink-0 size-7 items-center justify-center">
              <FaIcon name="i-lucide:chevron-down" class="size-4 transition-transform duration-150 motion-reduce:transition-none" :class="open ? 'rotate-180' : ''" aria-hidden="true" />
            </span>
          </TransitionGroup>
        </template>
        <div class="p-4 border-t border-border/70 bg-muted/15 sm:p-5">
          <OrderDocument :document="document" />
        </div>
      </FaCollapsible>
    </div>
  </section>
</template>

<style scoped>
/* 与实际付款摘要保持同一缩略图退场节奏；FLIP 仅变换位移，不逐帧改变布局宽度。 */
.document-summary-move {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.document-summary-enter-active,
.document-summary-leave-active {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.document-summary-leave-active {
  position: absolute;
  inset-inline-start: 1rem;
  pointer-events: none;
}

.document-summary-enter-from,
.document-summary-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

@media (prefers-reduced-motion: reduce) {
  .document-summary-move,
  .document-summary-enter-active,
  .document-summary-leave-active {
    transition: none;
  }
}
</style>
