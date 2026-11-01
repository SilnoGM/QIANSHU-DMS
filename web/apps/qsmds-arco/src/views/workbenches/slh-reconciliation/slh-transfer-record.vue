<script setup lang="ts">
import type { SlhReconciliationTransferRecordDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

/**
 * 调货记录：只展示当前销售单对应的寄仓/认领摘要。
 * 原始收件人前后值、成本个人/公司分摊、位置/归属时间线不在这里展开，统一走底部完整记录。
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
const routeText = computed(() => {
  const values = [
    props.transfer.shipmentNo,
    props.transfer.containerBatchName,
    props.transfer.shippingMark,
  ].filter((value): value is string => value !== null && value !== undefined && value.trim() !== '')
  return values.length === 0 ? '—' : values.join(' · ')
})
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
const claimStatusKey = computed(() => claim.value === null
  ? 'slhReconciliation.detail.transfer.directClaim'
  : `slhReconciliation.detail.transfer.claimStatus.${claim.value.status}`)

const STORAGE_STATUS_CLASSES: Record<string, string> = {
  CLAIMED: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300',
  IN_STORAGE: 'border-amber-500/40 text-amber-700 dark:text-amber-300',
  RESERVED: 'border-sky-500/40 text-sky-700 dark:text-sky-300',
  VOIDED: 'border-border text-muted-foreground',
}
const LOCATION_SCOPE_CLASSES: Record<string, string> = {
  MAINLAND: 'border-border text-muted-foreground',
  OVERSEAS: 'border-indigo-500/40 text-indigo-700 dark:text-indigo-300',
}
const storageStatusClass = computed(() => STORAGE_STATUS_CLASSES[props.transfer.status] ?? 'border-border text-muted-foreground')
const locationScopeClass = computed(() => LOCATION_SCOPE_CLASSES[props.transfer.locationScope] ?? 'border-border text-muted-foreground')
</script>

<template>
  <section class="mt-3 p-3 border border-border rounded-lg flex flex-col gap-2 min-w-0" :aria-label="t('slhReconciliation.detail.transfer.title')">
    <div class="flex flex-wrap gap-2 min-w-0 items-center">
      <h3 class="qs-type-section-title m-0 flex gap-2 items-center">
        <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
        {{ t('slhReconciliation.detail.transfer.title') }}
      </h3>
      <FaTag variant="outline" class="qs-type-status-tag" :class="storageStatusClass">
        {{ t(`slhReconciliation.detail.transfer.storageStatus.${transfer.status}`) }}
      </FaTag>
      <FaTag variant="outline" class="qs-type-status-tag" :class="locationScopeClass">
        {{ t(`slhReconciliation.detail.transfer.locationScope.${transfer.locationScope}`) }}
      </FaTag>
    </div>

    <dl class="m-0 flex flex-col gap-2 min-w-0">
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.sourceOrder') }}
        </dt>
        <dd class="m-0 min-w-0">
          <span class="qs-type-data break-all">{{ sourceOrderNo }}</span>
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.targetOrder') }}
        </dt>
        <dd class="m-0 min-w-0">
          <span class="qs-type-data break-all">{{ targetOrderNo }}</span>
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.route') }}
        </dt>
        <dd class="m-0 min-w-0">
          <span class="qs-type-data break-all" :title="routeText">{{ routeText }}</span>
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.warehouse') }}
        </dt>
        <dd class="m-0 min-w-0">
          <span class="qs-type-data break-all" :title="`${transfer.warehouseValue}${transfer.releaseNote ? ` · ${transfer.releaseNote}` : ''}`">
            {{ transfer.warehouseLabel }}
          </span>
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.releasedAt') }}
        </dt>
        <dd class="m-0 min-w-0">
          <DateTimeDisplay v-if="transfer.releasedAt" :value="transfer.releasedAt" />
          <span v-else class="qs-type-data">—</span>
          <span class="qs-type-meta text-muted-foreground ml-2">{{ t('slhReconciliation.detail.transfer.releaseReason') }}：{{ t(`slhReconciliation.detail.transfer.releaseReasonValue.${transfer.releaseReason ?? 'OTHER'}`) }}</span>
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.appliedAt') }}
        </dt>
        <dd class="m-0 flex flex-wrap gap-x-2 min-w-0 items-baseline">
          <DateTimeDisplay v-if="claim" :value="claim.createdAt" />
          <span v-else class="qs-type-data">—</span>
          <QsPersonDisplay v-if="claim?.applicant" :display-name="claim.applicant.displayName" :avatar-url="claim.applicant.avatarUrl" size="sm" />
          <span v-else class="qs-type-data">—</span>
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.review') }}
        </dt>
        <dd class="m-0 flex flex-wrap gap-x-2 min-w-0 items-baseline">
          <span class="qs-type-data">{{ t(claimStatusKey) }}</span>
          <QsPersonDisplay v-if="claim?.reviewedBy" :display-name="claim.reviewedBy.displayName" :avatar-url="claim.reviewedBy.avatarUrl" size="sm" />
          <DateTimeDisplay v-if="claim?.reviewedAt" :value="claim.reviewedAt" />
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.claimedAt') }}
        </dt>
        <dd class="m-0 flex flex-wrap gap-x-2 min-w-0 items-baseline">
          <DateTimeDisplay v-if="transfer.claimedAt" :value="transfer.claimedAt" />
          <span v-else class="qs-type-data">—</span>
          <QsPersonDisplay v-if="transfer.claimedBy" :display-name="transfer.claimedBy.displayName" :avatar-url="transfer.claimedBy.avatarUrl" size="sm" />
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.lineSummary') }}
        </dt>
        <dd class="qs-type-data m-0 min-w-0">
          {{ lineSummary }}
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.cost') }}
        </dt>
        <dd class="m-0 text-right">
          <AmountDisplay
            v-if="costTotal !== null"
            :value="costTotal"
            currency="CNY"
            :currencies="currencyCatalog.currencies.value"
            class="!text-base !font-semibold"
          />
          <span v-else class="qs-type-data">—</span>
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline">
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
