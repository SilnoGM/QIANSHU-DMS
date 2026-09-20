<script setup lang="ts">
import type { OceanContainerDetailPage, OceanContainerLine, OceanContainerSummary } from './types'
import type { CurrencyDescriptor } from '@/components/base/currency'
import { Decimal } from 'decimal.js'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import OceanContainerSource from './OceanContainerSource.vue'

const props = defineProps<{
  item: OceanContainerSummary
  detail?: OceanContainerDetailPage
  currencies: readonly CurrencyDescriptor[]
  expanded: boolean
  canViewSales: boolean
  canViewPurchase: boolean
  canModify: boolean
}>()
const emit = defineEmits<{
  toggle: [open: boolean]
  retry: []
  pageChange: [page: number]
  viewLine: [line: OceanContainerLine]
  viewSource: [value: { lineId: string, kind: 'sales' | 'purchase' }]
  changeLine: [value: { lineId: string, kind: 'RECIPIENT' | 'COD' }]
}>()
const { t } = useI18n()
const id = useId()
const toggleLabel = computed(() => t('qsOceanContainer.toggle', { action: t(props.expanded ? 'qsOceanContainer.collapse' : 'qsOceanContainer.expand'), name: props.item.containerBatchName }))
const hasPersonal = computed(() => props.item.myItemCount > 0)
const isLoading = computed(() => hasPersonal.value && (!props.detail || ['idle', 'loading'].includes(props.detail.status)))
function measurement(value: string | null, precision: number) {
  if (value == null) {
    return '—'
  }
  try {
    const number = new Decimal(value)
    return number.isFinite() && !number.isNegative() ? number.toFixed(precision) : '—'
  }
  catch {
    return '—'
  }
}
</script>

<template>
  <FaCard role="article" :aria-labelledby="`${id}-title`" class="ocean-container-card py-0 gap-0 shadow-none overflow-hidden" header-class="p-0" content-class="p-0">
    <template #header>
      <div class="p-4 flex flex-col gap-4 sm:p-5">
        <div class="flex gap-3 items-start justify-between">
          <div class="flex gap-3 min-w-0 items-start">
            <FaIcon name="qs-ocean-containers" class="ocean-accent mt-0.5 shrink-0 size-6" aria-hidden="true" />
            <div class="flex flex-wrap gap-x-3 gap-y-1 min-w-0 items-baseline">
              <h3 :id="`${id}-title`" class="qs-type-section-title m-0 [overflow-wrap:anywhere]">
                {{ item.containerBatchName }}
              </h3>
              <span class="qs-type-data text-muted-foreground [overflow-wrap:anywhere]">{{ item.containerBatchNo }}</span>
            </div>
          </div>
          <FaButton variant="ghost" size="sm" class="shrink-0" :aria-label="toggleLabel" :aria-expanded="expanded" :aria-controls="`${id}-details`" @click="emit('toggle', !expanded)">
            {{ t(expanded ? 'qsOceanContainer.collapse' : 'qsOceanContainer.expand') }}
            <FaIcon name="i-lucide:chevron-down" class="size-4 motion-safe:transition-transform" :class="expanded && 'rotate-180'" aria-hidden="true" />
          </FaButton>
        </div>
        <dl class="m-0 flex flex-wrap gap-x-8 gap-y-3">
          <div class="flex gap-2 items-baseline">
            <dt class="qs-type-meta text-muted-foreground shrink-0">
              {{ t('qsOceanContainer.date') }}
            </dt>
            <dd class="m-0">
              <time :datetime="item.loadingDate" class="qs-type-data">{{ item.loadingDate || '—' }}</time>
            </dd>
          </div>
          <div class="flex gap-2 min-w-0 items-baseline">
            <dt class="qs-type-meta text-muted-foreground shrink-0">
              {{ t('qsOceanContainer.warehouse') }}
            </dt>
            <dd class="qs-type-body m-0 [overflow-wrap:anywhere]">
              {{ item.warehouseName || '—' }}
            </dd>
          </div>
        </dl>
      </div>
    </template>
    <div class="px-4 py-3 border-t border-border bg-muted/20 flex flex-wrap gap-x-6 gap-y-2 sm:px-5">
      <dl class="m-0 flex flex-wrap gap-x-5 gap-y-2">
        <div class="flex gap-2 items-baseline">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('qsOceanContainer.allItems') }}
          </dt>
          <dd class="qs-type-data m-0">
            {{ t('qsOceanContainer.count', { count: item.itemCount }) }}
          </dd>
        </div>
        <div class="flex gap-2 items-baseline">
          <dt class="ocean-accent qs-type-meta">
            {{ t('qsOceanContainer.myItems') }}
          </dt>
          <dd class="ocean-accent qs-type-data-emphasis m-0">
            {{ t('qsOceanContainer.count', { count: item.myItemCount }) }}
          </dd>
        </div>
      </dl>
      <dl class="m-0 flex flex-wrap gap-x-5 gap-y-2">
        <div class="flex gap-2 items-baseline">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('qsOceanContainer.weight') }}
          </dt>
          <dd class="qs-type-data m-0">
            {{ measurement(item.grossWeightKgTotal, 0) }}<span v-if="item.grossWeightKgTotal !== null" class="qs-type-meta text-muted-foreground ml-1">kg</span>
          </dd>
        </div>
        <div class="flex gap-2 items-baseline">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('qsOceanContainer.volume') }}
          </dt>
          <dd class="qs-type-data m-0">
            {{ measurement(item.volumeCaiTotal, 2) }}<span v-if="item.volumeCaiTotal !== null" class="qs-type-meta text-muted-foreground ml-1">{{ t('qsOceanContainer.volumeUnit') }}</span>
          </dd>
        </div>
      </dl>
    </div>
    <FaCollapsible :model-value="expanded" @update:model-value="emit('toggle', $event)">
      <section :id="`${id}-details`" :aria-label="`${item.containerBatchName} · ${t('qsOceanContainer.myDetails')}`" :aria-busy="isLoading" class="border-t border-border">
        <div v-if="isLoading" role="status" class="qs-type-description text-muted-foreground px-5 py-10 flex gap-2 items-center justify-center">
          <FaIcon name="i-lucide:loader-circle" class="size-4 motion-safe:animate-spin" aria-hidden="true" />{{ t('qsOceanContainer.loadingItems') }}
        </div>
        <div v-else-if="hasPersonal && detail?.status === 'error'" class="px-4 py-8 flex flex-col gap-3 items-center">
          <FaEmpty icon="i-lucide:circle-alert" :title="t('qsOceanContainer.itemsError')" :description="detail.error" />
          <FaButton variant="outline" size="sm" @click="emit('retry')">
            {{ t('qsOceanContainer.retryItems') }}
          </FaButton>
        </div>
        <FaEmpty
          v-else-if="!hasPersonal || !detail?.items.length"
          icon="i-lucide:package-open" class="px-4 py-8"
          :title="t(item.itemCount === 0 ? 'qsOceanContainer.noItems' : 'qsOceanContainer.noPersonal')"
          :description="t(item.itemCount === 0 ? 'qsOceanContainer.noItemsHint' : 'qsOceanContainer.noPersonalHint')"
        />
        <template v-else>
          <div class="ocean-lines-desktop">
            <table class="qs-type-body text-left w-full border-collapse table-fixed">
              <colgroup><col class="w-[15%]"><col class="w-[calc(12em+2rem)]"><col><col class="w-[218px]"><col class="w-[calc(6em+2rem)]"><col class="w-[184px]"><col :class="canModify ? 'w-56' : 'w-24'"></colgroup>
              <thead class="qs-type-meta text-muted-foreground bg-muted/10">
                <tr>
                  <th v-for="key in ['mark', 'goods', 'shippingMark', 'source', 'recipient', 'cod', 'actions']" :key="key" scope="col" class="font-medium px-4 py-3" :class="key === 'cod' && 'text-right'">
                    {{ t(`qsOceanContainer.${key}`) }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in detail.items" :key="line.id" class="group border-t border-border hover:bg-muted/20">
                  <td class="px-4 py-3">
                    <div class="flex gap-1 min-w-0 items-center">
                      <FaTooltip :text="line.oceanShippingMarkText ?? ''" :disabled="!line.oceanShippingMarkText">
                        <span class="ocean-accent ocean-emphasis qs-type-data truncate" :tabindex="line.oceanShippingMarkText ? 0 : undefined">{{ line.oceanShippingMarkText || '—' }}</span>
                      </FaTooltip>
                      <CopyCellButton v-if="line.oceanShippingMarkText" :text="line.oceanShippingMarkText" :label="t('qsOceanContainer.mark')" always-visible />
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <FaTooltip :text="line.goodsName ?? ''" :disabled="!line.goodsName">
                      <div class="truncate" :tabindex="line.goodsName ? 0 : undefined">
                        {{ line.goodsName }}
                      </div>
                    </FaTooltip>
                  </td>
                  <td class="px-4 py-3">
                    <FaTooltip :text="line.shippingMark ?? ''" :disabled="!line.shippingMark">
                      <div class="qs-type-data truncate" :tabindex="line.shippingMark ? 0 : undefined">
                        {{ line.shippingMark || '—' }}
                      </div>
                    </FaTooltip>
                  </td>
                  <td class="px-4 py-3">
                    <OceanContainerSource :line="line" :can-view-sales="canViewSales" :can-view-purchase="canViewPurchase" @view="emit('viewSource', { lineId: line.id, kind: $event })" />
                  </td>
                  <td class="px-4 py-3">
                    <FaTooltip :text="line.recipientName ?? ''" :disabled="!line.recipientName">
                      <div class="truncate" :tabindex="line.recipientName ? 0 : undefined">
                        {{ line.recipientName || '—' }}
                      </div>
                    </FaTooltip>
                  </td>
                  <td class="px-4 py-3 text-right">
                    <AmountDisplay :value="line.codAmountTwd" currency="TWD" :currencies="currencies" class="ocean-accent ocean-emphasis" />
                  </td>
                  <td class="px-2 py-3">
                    <div class="flex gap-1 items-center">
                      <template v-if="canModify">
                        <FaButton v-for="kind in (['RECIPIENT', 'COD'] as const)" :key="kind" variant="ghost" size="sm" class="text-foreground px-2" :aria-label="t('qsOceanContainer.changeLabel', { action: t(`qsOceanContainer.change${kind}`), mark: line.oceanShippingMarkText ?? line.goodsName })" @click="emit('changeLine', { lineId: line.id, kind })">
                          {{ t(`qsOceanContainer.change${kind}`) }}
                        </FaButton>
                      </template>
                      <FaButton variant="ghost" size="sm" class="text-foreground px-2" :aria-label="t('qsOceanContainer.viewLabel', { name: line.goodsName, mark: line.oceanShippingMarkText ?? '' })" @click="emit('viewLine', line)">
                        {{ t('qsOceanContainer.view') }}
                      </FaButton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="ocean-lines-mobile">
            <div v-for="line in detail.items" :key="line.id" class="p-4 border-b border-border flex flex-col gap-2 last:border-b-0">
              <div class="flex gap-2 min-w-0 items-center justify-between">
                <div class="flex gap-1 min-w-0 items-center">
                  <FaTooltip :text="line.oceanShippingMarkText ?? ''" :disabled="!line.oceanShippingMarkText">
                    <span class="ocean-accent ocean-emphasis qs-type-data truncate" :tabindex="line.oceanShippingMarkText ? 0 : undefined">{{ line.oceanShippingMarkText || '—' }}</span>
                  </FaTooltip>
                  <CopyCellButton v-if="line.oceanShippingMarkText" :text="line.oceanShippingMarkText" :label="t('qsOceanContainer.mark')" always-visible />
                </div>
              </div>
              <p class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
                {{ line.goodsName }}
              </p>
              <p class="qs-type-meta text-muted-foreground m-0 [overflow-wrap:anywhere]">
                {{ t('qsOceanContainer.shippingMark') }}：<span class="qs-type-data">{{ line.shippingMark || '—' }}</span>
              </p>
              <OceanContainerSource :line="line" :can-view-sales="canViewSales" :can-view-purchase="canViewPurchase" @view="emit('viewSource', { lineId: line.id, kind: $event })" />
              <div class="flex flex-wrap gap-2 items-center justify-between">
                <span class="qs-type-body [overflow-wrap:anywhere]">{{ line.recipientName || '—' }}</span>
                <AmountDisplay :value="line.codAmountTwd" currency="TWD" :currencies="currencies" class="ocean-accent ocean-emphasis" />
              </div>
              <div class="pt-2 border-t border-border flex gap-1 justify-end">
                <template v-if="canModify">
                  <FaButton v-for="kind in (['RECIPIENT', 'COD'] as const)" :key="kind" variant="ghost" size="sm" class="text-foreground px-2 min-h-11" :aria-label="t('qsOceanContainer.changeLabel', { action: t(`qsOceanContainer.change${kind}`), mark: line.oceanShippingMarkText ?? line.goodsName })" @click="emit('changeLine', { lineId: line.id, kind })">
                    {{ t(`qsOceanContainer.change${kind}`) }}
                  </FaButton>
                </template>
                <FaButton variant="ghost" size="sm" class="text-foreground px-2 min-h-11" :aria-label="t('qsOceanContainer.viewLabel', { name: line.goodsName, mark: line.oceanShippingMarkText ?? '' })" @click="emit('viewLine', line)">
                  {{ t('qsOceanContainer.view') }}
                </FaButton>
              </div>
            </div>
          </div>
          <nav v-if="detail.total > detail.pageSize" :aria-label="t('qsOceanContainer.itemPagination', { name: item.containerBatchName })" class="px-4 py-3 border-t border-border overflow-x-auto">
            <FaPagination :page="detail.page" :size="detail.pageSize" :total="detail.total" layout="total, ->, pager" :text-templates="{ total: value => t('qsOceanContainer.totalItems', { count: value }) }" @update:page="emit('pageChange', $event)" />
          </nav>
        </template>
      </section>
    </FaCollapsible>
  </FaCard>
</template>

<style scoped>
.ocean-container-card {
  --ocean-accent: oklch(var(--primary));

  container-type: inline-size;
}

/* 深色下沿用主题色相，以前景色提高细小标识和金额的对比度。 */
:global(.dark .ocean-container-card) {
  --ocean-accent: color-mix(in oklab, oklch(var(--primary)), oklch(var(--foreground)) 45%);
}

.ocean-accent {
  color: var(--ocean-accent);
}

/* 唛头与代收金额按业务要求突出，沿用全局粗体字重。 */
.ocean-emphasis {
  font-weight: var(--qs-type-weight-bold, 700);
}

.ocean-lines-mobile {
  display: none;
}

@container (width < 1280px) {
  .ocean-lines-desktop {
    display: none;
  }

  .ocean-lines-mobile {
    display: block;
  }
}

@media (prefers-reduced-motion: reduce) {
  :deep([data-slot="collapsible-content"]) {
    animation: none;
  }
}
</style>
