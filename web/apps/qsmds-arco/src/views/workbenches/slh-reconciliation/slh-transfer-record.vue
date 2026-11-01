<script setup lang="ts">
import type { SlhReconciliationTransferRecordDto } from '@/api/generated/types.gen'
import { formatCurrencyAmount } from '@/components/base/AmountDisplay/format'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

/**
 * 调货记录：按设计稿的「标题 + 状态/仓库 + 三段摘要」结构展示。
 *
 * 卡面不展开时间/申请人/审批人；认领产品和完整变更前后值通过 Tooltip 查看，
 * 更长的完整留痕仍走底部寄仓记录入口。
 */
defineOptions({ name: 'SlhTransferRecord' })

const props = defineProps<{
  readonly transfer: SlhReconciliationTransferRecordDto
  readonly originOrderNo: string | null
  readonly currentOrderNo: string | null
}>()

const emit = defineEmits<{ flip: [] }>()

type TransferChange = NonNullable<SlhReconciliationTransferRecordDto['claimRequest']>['changes'][number]

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()

const claim = computed(() => props.transfer.claimRequest ?? null)
const targetOrderNo = computed(() => claim.value?.targetSalesOrderNo ?? props.currentOrderNo ?? '—')
const sourceOrderNo = computed(() => props.originOrderNo ?? '—')
const locationLabel = computed(() => t(`slhReconciliation.detail.transfer.locationScope.${props.transfer.locationScope}`))
const shipmentNoText = computed(() => props.transfer.shipmentNo ?? '—')
const containerMarkText = computed(() => {
  const parts = [props.transfer.containerBatchName, props.transfer.shippingMark]
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
  return parts.length === 0 ? '—' : parts.join(' · ')
})
const lines = computed(() => claim.value?.lines ?? [])
const changes = computed(() => claim.value?.changes ?? [])
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
const originalBearer = computed(() => props.transfer.cost?.originalBearer ?? null)
const currentBearer = computed(() => props.transfer.cost?.currentBearer ?? null)

const STORAGE_STATUS_CLASSES: Record<string, string> = {
  CLAIMED: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  IN_STORAGE: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  RESERVED: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  VOIDED: 'border-border text-muted-foreground',
}
const storageStatusClass = computed(() => STORAGE_STATUS_CLASSES[props.transfer.status] ?? 'border-border text-muted-foreground')

function display(value: string | null | undefined): string {
  return value ?? '—'
}

function differs(before: string | null | undefined, after: string | null | undefined): boolean {
  return (before ?? '') !== (after ?? '')
}

function hasRecipientFieldChange(change: TransferChange): boolean {
  return differs(change.beforeRecipientName, change.afterRecipientName)
    || differs(change.beforeRecipientPhone, change.afterRecipientPhone)
    || differs(change.beforeRecipientAddress, change.afterRecipientAddress)
}

function changeTitle(change: TransferChange): string {
  return change.shippingMark ?? change.containerBatchName ?? t('slhReconciliation.detail.transfer.changeLine', {
    line: String(change.lineNumber),
  })
}

function codText(value: string | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : formatCurrencyAmount(value, 'TWD', currencyCatalog.currencies.value)
}
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
      <span
        class="text-sm text-indigo-700 px-3 py-1.5 border border-indigo-200 rounded-lg bg-indigo-50 inline-flex shrink-0 gap-1.5 max-w-full w-60 items-center dark:text-indigo-300 dark:border-indigo-500/30 dark:bg-indigo-500/10"
        :title="`${locationLabel} · ${transfer.warehouseLabel}`"
      >
        <FaIcon name="i-lucide:map-pin" class="shrink-0 size-4" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ locationLabel }} · {{ transfer.warehouseLabel }}</span>
      </span>
    </div>

    <div class="border-t border-border" aria-hidden="true" />

    <!-- 货件编号、柜号唛头分两行；柜号与唛头合并成一行。 -->
    <dl class="m-0 flex flex-col gap-1 min-w-0">
      <div class="flex flex-wrap gap-x-2 gap-y-1 min-w-0 items-baseline">
        <dt class="qs-type-meta text-muted-foreground shrink-0">
          {{ t('slhReconciliation.detail.transfer.routeShipmentNo') }}
        </dt>
        <dd class="qs-type-data m-0 min-w-0 break-all" :title="shipmentNoText">
          {{ shipmentNoText }}
        </dd>
      </div>
      <div class="flex flex-wrap gap-x-2 gap-y-1 min-w-0 items-baseline">
        <dt class="qs-type-meta text-muted-foreground shrink-0">
          {{ t('slhReconciliation.detail.transfer.routeContainerMark') }}
        </dt>
        <dd class="qs-type-data m-0 min-w-0 break-all" :title="containerMarkText">
          {{ containerMarkText }}
        </dd>
      </div>
    </dl>

    <!-- 来源单 → 当前单：来源单号可点击直接翻到背面。 -->
    <div class="p-3 border border-border rounded-lg bg-muted/30 gap-3 grid min-w-0 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
      <div class="min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('slhReconciliation.detail.transfer.sourceOrder') }}
        </p>
        <button
          v-if="sourceOrderNo !== '—'"
          type="button"
          class="qs-type-data mt-1 p-0 text-left border-0 rounded-sm bg-transparent underline-offset-4 min-w-0 cursor-pointer break-all focus-visible:outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary/40"
          :aria-label="t('slhReconciliation.detail.flip.showOrigin')"
          :title="t('slhReconciliation.detail.flip.showOrigin')"
          @click="emit('flip')"
        >
          {{ sourceOrderNo }}
        </button>
        <p v-else class="qs-type-data m-0 mt-1 break-all">
          —
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
          <FaTooltip>
            <span
              tabindex="0"
              class="qs-type-data cursor-pointer"
              :aria-label="t('slhReconciliation.detail.transfer.productsTooltipAria')"
            >
              {{ lineSummary }}
            </span>
            <template #content>
              <div class="text-background flex flex-col gap-1 max-w-xs">
                <p v-if="lines.length === 0" class="m-0">
                  {{ t('slhReconciliation.detail.transfer.productsEmpty') }}
                </p>
                <p v-for="line in lines" :key="`${line.lineNumber}-${line.productName}`" class="m-0 break-words">
                  {{ line.productName }} × {{ line.quantity }}
                </p>
              </div>
            </template>
          </FaTooltip>
        </dd>
      </div>
      <div class="p-3 border border-border rounded-lg bg-muted/20 gap-x-3 gap-y-2 grid grid-cols-[6.5rem_minmax(0,1fr)] min-w-0 items-center">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.cost') }}
        </dt>
        <dd class="m-0 min-w-0">
          <AmountDisplay
            v-if="costTotal !== null"
            :value="costTotal"
            currency="CNY"
            :currencies="currencyCatalog.currencies.value"
            class="!text-xl !font-semibold"
          />
          <span v-else class="qs-type-data">—</span>
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.originalBearer') }}
        </dt>
        <dd class="m-0 min-w-0">
          <QsPersonDisplay
            v-if="originalBearer !== null"
            :display-name="originalBearer.displayName"
            :avatar-url="originalBearer.avatarUrl"
            size="sm"
            class="max-w-full"
          />
          <span v-else class="qs-type-data">—</span>
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.currentBearer') }}
        </dt>
        <dd class="m-0 min-w-0">
          <QsPersonDisplay
            v-if="currentBearer !== null"
            :display-name="currentBearer.displayName"
            :avatar-url="currentBearer.avatarUrl"
            size="sm"
            class="max-w-full"
          />
          <span v-else class="qs-type-data">—</span>
        </dd>
      </div>
      <div class="gap-x-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-center">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('slhReconciliation.detail.transfer.changeSummary') }}
        </dt>
        <dd class="m-0 flex flex-wrap gap-x-1 gap-y-1 min-w-0 items-center">
          <span class="qs-type-data">{{ changeSummary }}</span>
          <FaTooltip>
            <span
              tabindex="0"
              class="text-muted-foreground rounded-full inline-flex size-5 cursor-pointer items-center justify-center focus-visible:outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40"
              :aria-label="t('slhReconciliation.detail.transfer.changesTooltipAria')"
            >
              <FaIcon name="i-lucide:info" class="size-4" aria-hidden="true" />
            </span>
            <template #content>
              <div class="text-background flex flex-col gap-2 max-w-sm break-words">
                <p v-if="changes.length === 0" class="m-0">
                  {{ t('slhReconciliation.detail.transfer.noChanges') }}
                </p>
                <div v-for="change in changes" :key="`${change.lineNumber}-${change.shippingMark ?? ''}`" class="flex flex-col gap-0.5">
                  <p class="font-medium m-0">
                    {{ changeTitle(change) }}
                  </p>
                  <p
                    v-if="change.recipientChanged && differs(change.beforeRecipientName, change.afterRecipientName)"
                    class="text-background/80 m-0"
                  >
                    {{ t('slhReconciliation.detail.transfer.changeRecipient', { before: display(change.beforeRecipientName), after: display(change.afterRecipientName) }) }}
                  </p>
                  <p
                    v-if="change.recipientChanged && differs(change.beforeRecipientPhone, change.afterRecipientPhone)"
                    class="text-background/80 m-0"
                  >
                    {{ t('slhReconciliation.detail.transfer.changePhone', { before: display(change.beforeRecipientPhone), after: display(change.afterRecipientPhone) }) }}
                  </p>
                  <p
                    v-if="change.recipientChanged && differs(change.beforeRecipientAddress, change.afterRecipientAddress)"
                    class="text-background/80 m-0"
                  >
                    {{ t('slhReconciliation.detail.transfer.changeAddress', { before: display(change.beforeRecipientAddress), after: display(change.afterRecipientAddress) }) }}
                  </p>
                  <p
                    v-if="change.recipientChanged && !hasRecipientFieldChange(change)"
                    class="text-background/80 m-0"
                  >
                    {{ t('slhReconciliation.detail.transfer.changeRecipientFallback') }}
                  </p>
                  <p v-if="change.codChanged" class="text-background/80 m-0">
                    {{ t('slhReconciliation.detail.transfer.changeCod', { before: codText(change.beforeCodAmountTwd), after: codText(change.afterCodAmountTwd) }) }}
                  </p>
                </div>
              </div>
            </template>
          </FaTooltip>
        </dd>
      </div>
    </dl>
  </section>
</template>
