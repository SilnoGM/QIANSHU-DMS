<script setup lang="ts">
import type { SlhReconciliationTransferRecordDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

/**
 * 调货记录：按设计稿的「标题 + 状态/仓库 + 三段摘要」结构展示。
 *
 * 时间、申请人/审批人、释放原因等审计字段不在卡面展开，完整留痕统一走底部寄仓记录入口；
 * 卡面只保留财务核对时最常看的关系、行数、成本和变更摘要。
 */
defineOptions({ name: 'SlhTransferRecord' })

const props = defineProps<{
  readonly transfer: SlhReconciliationTransferRecordDto
  readonly originOrderNo: string | null
  readonly currentOrderNo: string | null
}>()

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()

const claim = computed(() => props.transfer.claimRequest ?? null)
const targetOrderNo = computed(() => claim.value?.targetSalesOrderNo ?? props.currentOrderNo ?? '—')
const sourceOrderNo = computed(() => props.originOrderNo ?? '—')
const locationLabel = computed(() => t(`slhReconciliation.detail.transfer.locationScope.${props.transfer.locationScope}`))
const routeValues = computed(() => [
  { id: 'shipment', value: props.transfer.shipmentNo ?? '—' },
  { id: 'container', value: props.transfer.containerBatchName ?? '—' },
  { id: 'mark', value: props.transfer.shippingMark ?? '—' },
])
const lineSummary = computed(() => t('slhReconciliation.detail.transfer.lineSummaryValue', {
  lines: String(claim.value?.lineCount ?? 0),
  quantity: String(claim.value?.totalQuantity ?? 0),
}))
const changeSummary = computed(() => {
  const recipient = claim.value?.recipientChangeCount ?? 0
  const cod = claim.value?.codChangeCount ?? 0
  return recipient === 0 && cod === 0
    ? t('slhReconciliation.detail.transfer.noChanges')
    : t('slhReconciliation.detail.transfer.changeSummaryValue', {
        recipient: String(recipient),
        cod: String(cod),
      })
})
const costTotal = computed(() => props.transfer.cost?.totalCostCny ?? null)

const STORAGE_STATUS_CLASSES: Record<string, string> = {
  CLAIMED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  IN_STORAGE: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  RESERVED: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  VOIDED: 'border-border text-muted-foreground',
}
const storageStatusClass = computed(() => STORAGE_STATUS_CLASSES[props.transfer.status] ?? 'border-border text-muted-foreground')
</script>

<template>
  <section
    class="mt-3 p-4 border border-border rounded-xl bg-background flex flex-col gap-3 min-w-0"
    :aria-label="t('slhReconciliation.detail.transfer.title')"
  >
    <div class="flex flex-wrap gap-2 min-w-0 items-center justify-between">
      <div class="flex flex-wrap gap-2 min-w-0 items-center">
        <h3 class="qs-type-section-title m-0 flex gap-2 items-center">
          <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
          {{ t('slhReconciliation.detail.transfer.title') }}
        </h3>
        <FaTag variant="outline" class="qs-type-status-tag" :class="storageStatusClass">
          {{ t(`slhReconciliation.detail.transfer.storageStatus.${transfer.status}`) }}
        </FaTag>
      </div>
      <span class="text-sm text-indigo-700 px-3 py-1.5 border border-indigo-200 rounded-lg bg-indigo-50 inline-flex gap-1.5 max-w-full items-center dark:text-indigo-300 dark:border-indigo-500/30 dark:bg-indigo-500/10">
        <FaIcon name="i-lucide:map-pin" class="shrink-0 size-4" aria-hidden="true" />
        <span class="truncate">{{ locationLabel }} · {{ transfer.warehouseLabel }}</span>
      </span>
    </div>

    <div class="border-t border-border" aria-hidden="true" />

    <!-- 货件 / 柜号 / 唛头：三项独立白底标签，避免长字符串糊在一起。 -->
    <div class="p-3 border border-border rounded-lg bg-muted/30 flex flex-wrap gap-3 min-w-0 items-center">
      <span class="qs-type-meta text-muted-foreground shrink-0">
        {{ t('slhReconciliation.detail.transfer.route') }}
      </span>
      <div class="flex flex-wrap gap-2 min-w-0 sm:ml-auto">
        <span
          v-for="item in routeValues"
          :key="item.id"
          class="text-sm qs-type-data px-3 py-1.5 border border-border rounded-md bg-background break-all"
          :title="item.value"
        >
          {{ item.value }}
        </span>
      </div>
    </div>

    <!-- 来源单 → 当前单：中间只保留方向与「调货至」，右侧当前单用主题色强调。 -->
    <div class="p-3 border border-border rounded-lg bg-muted/30 gap-3 grid min-w-0 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
      <div class="min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('slhReconciliation.detail.transfer.sourceOrder') }}
        </p>
        <p class="qs-type-data m-0 mt-1 break-all">
          {{ sourceOrderNo }}
        </p>
      </div>
      <div class="text-primary flex flex-col gap-1 items-center">
        <span class="qs-type-meta text-muted-foreground">{{ t('slhReconciliation.detail.transfer.transferTo') }}</span>
        <FaIcon name="i-lucide:arrow-right" class="size-5" aria-hidden="true" />
      </div>
      <div class="min-w-0 sm:text-right">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('slhReconciliation.detail.transfer.targetOrder') }}
        </p>
        <p class="qs-type-data text-primary font-semibold m-0 mt-1 break-all">
          {{ targetOrderNo }}
        </p>
      </div>
    </div>

    <dl class="m-0 flex flex-col gap-2 min-w-0">
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-center">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.lineSummary') }}
        </dt>
        <dd class="m-0 min-w-0">
          <span class="text-sm qs-type-data px-2 py-0.5 rounded-md bg-muted inline-block">{{ lineSummary }}</span>
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-center">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.cost') }}
        </dt>
        <dd class="m-0 flex flex-wrap gap-x-2 min-w-0 items-baseline">
          <AmountDisplay
            v-if="costTotal !== null"
            :value="costTotal"
            currency="CNY"
            :currencies="currencyCatalog.currencies.value"
            class="!text-xl !font-semibold"
          />
          <span v-else class="qs-type-data">—</span>
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-center">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.changeSummary') }}
        </dt>
        <dd class="qs-type-data m-0 min-w-0">
          {{ changeSummary }}
        </dd>
      </div>
    </dl>
  </section>
</template>
