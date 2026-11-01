<script setup lang="ts">
import type { SlhReconciliationRecordAllocationParty, SlhReconciliationRecordAmount, SlhReconciliationRecordBlockId, SlhReconciliationRecordCard } from './records-modal.logic'
import type { SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import { getApiClientErrorMessage } from '@/api/errors'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import SlhReconciliationOverflowText from './overflow-text.vue'
import { buildSlhReconciliationRecordCards, resolveRecordAmountTone } from './records-modal.logic'

defineOptions({ name: 'SlhReconciliationRecordsModal' })

const props = defineProps<{
  readonly modelValue: boolean
  readonly batchId: string
  readonly member: SlhReconciliationBatchMemberDto | null
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const { t } = useI18n()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const cards = ref<readonly SlhReconciliationRecordCard[]>([])
const loading = ref(false)
const loadError = ref('')
let controller: AbortController | null = null

/** 公式区域显示哪一块：每张卡片各自记住自己的选择，默认看结算金额。 */
const selectedBlock = ref<Record<string, SlhReconciliationRecordBlockId>>({})
/** 展开的快照：已被取代的记录默认折起，展开后与当前有效同一套版式。 */
const expandedRecords = ref<Record<string, boolean>>({})

/** 每次打开都重新取一次：刚确认结算过的行要立刻看到新记录。 */
async function load(): Promise<void> {
  const member = props.member
  if (member === null) {
    cards.value = []
    return
  }
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  loadError.value = ''
  try {
    const response = await slhReconciliationBatchesApi.settlements(props.batchId, member.id, current.signal)
    if (current.signal.aborted) {
      return
    }
    cards.value = buildSlhReconciliationRecordCards(response.data.items, currencyCatalog.currencies.value, (key, params) => (
      params === undefined ? t(key) : t(key, params)
    ))
    selectedBlock.value = {}
    expandedRecords.value = {}
  }
  catch (failure) {
    if (!current.signal.aborted) {
      cards.value = []
      loadError.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
      toast.error(t('slhReconciliation.records.loadFailed'))
    }
  }
  finally {
    if (controller === current) {
      loading.value = false
    }
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    void load()
  }
  else {
    controller?.abort()
  }
})

/** 金额着色：与结算弹窗同一套语义（结算金额按符号、金流费用恒红）。 */
const AMOUNT_TONE_CLASSES: Record<'danger' | 'neutral' | 'success', string> = {
  danger: '!text-destructive',
  success: '!text-primary',
  neutral: '',
}
function amountClass(value: SlhReconciliationRecordAmount): string {
  return AMOUNT_TONE_CLASSES[resolveRecordAmountTone(value)]
}

const ALLOCATION_DIRECTION_CLASSES: Record<SlhReconciliationRecordAllocationParty['direction'], string> = {
  INFLOW: 'text-primary border-primary/30 bg-primary/10',
  OUTFLOW: 'text-destructive border-destructive/30 bg-destructive/10',
  ZERO: '',
}

function allocationPartyTone(direction: SlhReconciliationRecordAllocationParty['direction']): string {
  if (direction === 'INFLOW') {
    return '!text-primary'
  }
  if (direction === 'OUTFLOW') {
    return '!text-destructive'
  }
  return ''
}

function allocationPartyDirectionClass(direction: SlhReconciliationRecordAllocationParty['direction']): string {
  return ALLOCATION_DIRECTION_CLASSES[direction]
}

/** 已被取代的记录默认折起；点一次展开完整快照，再点收起。 */
function isExpanded(card: SlhReconciliationRecordCard): boolean {
  return card.collapsedByDefault ? expandedRecords.value[card.id] === true : true
}
function toggleExpanded(card: SlhReconciliationRecordCard): void {
  expandedRecords.value = { ...expandedRecords.value, [card.id]: !isExpanded(card) }
}
function selectedOf(card: SlhReconciliationRecordCard): SlhReconciliationRecordBlockId {
  return selectedBlock.value[card.id] ?? 'settlement'
}
function selectBlock(card: SlhReconciliationRecordCard, id: SlhReconciliationRecordBlockId): void {
  selectedBlock.value = { ...selectedBlock.value, [card.id]: id }
}
</script>

<template>
  <QsGenericModal
    v-model="visible"
    :title="t('slhReconciliation.records.title')"
    :description="t('slhReconciliation.records.description')"
    size="2xl"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:history" class="size-5" aria-hidden="true" />
    </template>

    <div class="flex flex-col gap-4 min-w-0">
      <p v-if="loading" class="qs-type-meta text-muted-foreground m-0">
        {{ t('slhReconciliation.records.loading') }}
      </p>
      <p v-else-if="loadError !== ''" class="text-sm text-destructive m-0">
        {{ t('slhReconciliation.records.loadFailed') }}
      </p>
      <!-- 空态与列表互斥：没有记录时不渲染任何卡片，只给一句说明。 -->
      <p v-else-if="cards.length === 0" class="qs-type-meta text-muted-foreground m-0">
        {{ t('slhReconciliation.records.empty') }}
      </p>

      <article
        v-for="card in cards"
        :key="card.id"
        class="border border-border rounded-xl min-w-0 overflow-hidden"
        :data-record-status="card.status"
      >
        <!-- 头部：状态 + 核对时间 + 核对人（时间与人都不再单独挂标签）。 -->
        <header class="px-4 py-3 border-b flex flex-wrap gap-x-3 gap-y-2 items-center" :class="card.headerClass">
          <FaTag variant="outline" class="qs-type-status-tag bg-background" :class="card.statusClass">
            {{ t(card.statusKey) }}
          </FaTag>
          <span class="text-sm">
            {{ t('slhReconciliation.records.checkedAt') }}：<DateTimeDisplay :value="card.createdAt" class="text-sm" />
          </span>
          <QsPersonDisplay :display-name="card.createdByDisplayName" size="sm" class="ml-auto" :avatar-url="card.createdByAvatarUrl" />
        </header>

        <!-- 折叠态摘要：当时结算金额 / 汇率（含来源）/ 费率 + 展开入口。 -->
        <div
          v-if="!isExpanded(card)"
          class="px-4 py-3 flex flex-wrap gap-x-6 gap-y-2 min-w-0 items-center"
        >
          <span class="flex gap-2 min-w-0 items-baseline">
            <span class="qs-type-meta text-muted-foreground shrink-0">{{ t(card.summaryAmountLabelKey) }}：</span>
            <AmountDisplay
              :value="card.summaryAmount.value"
              :currency="card.summaryAmount.currencyCode"
              :currencies="currencyCatalog.currencies.value"
              class="!text-lg !font-semibold"
              :class="amountClass(card.summaryAmount)"
            />
          </span>
          <span class="qs-type-meta text-muted-foreground">
            {{ t('slhReconciliation.settle.rateRow') }}：<span class="qs-type-data">{{ card.summaryRateText }}</span>（{{ t(card.summaryRateSourceKey) }}）
          </span>
          <span class="qs-type-meta text-muted-foreground">
            {{ t('slhReconciliation.settle.paymentFeeRate') }}：<span class="qs-type-data">{{ card.summaryFeeRateText }}</span>
          </span>
          <button
            type="button"
            class="text-sm text-primary font-medium ml-auto flex shrink-0 gap-1 items-center hover:underline"
            @click="toggleExpanded(card)"
          >
            {{ t('slhReconciliation.records.expandSnapshot') }}
            <FaIcon name="i-lucide:chevron-down" class="size-4" aria-hidden="true" />
          </button>
        </div>

        <template v-else>
          <div class="p-4 flex flex-col gap-3 min-w-0">
            <!-- 两个大区块：点哪块，下面的公式区域就显示哪块的计算式。 -->
            <div class="gap-3 grid grid-cols-1 min-w-0 sm:grid-cols-2">
              <button
                v-for="block in card.blocks"
                :key="block.id"
                type="button"
                class="p-3 text-left border rounded-lg flex flex-col gap-1 min-w-0 transition-colors"
                :class="selectedOf(card) === block.id
                  ? 'border-primary bg-primary/[0.03]'
                  : 'border-border hover:border-primary/40 hover:bg-muted/20'"
                :aria-pressed="selectedOf(card) === block.id"
                @click="selectBlock(card, block.id)"
              >
                <span class="qs-type-meta text-muted-foreground">{{ t(block.labelKey) }}</span>
                <AmountDisplay
                  :value="block.amount.value"
                  :currency="block.amount.currencyCode"
                  :currencies="currencyCatalog.currencies.value"
                  class="!text-2xl !font-semibold"
                  :class="amountClass(block.amount)"
                />
                <span class="qs-type-meta text-muted-foreground">
                  {{ t(block.rateLabelKey) }} <span class="qs-type-data">{{ block.rateText }}</span>
                </span>
              </button>
            </div>

            <!-- 公式区域：显示当前选中大区块的计算式（代入后的数值）。 -->
            <p class="text-sm qs-type-data m-0 p-3 rounded-lg bg-muted/40 break-all">
              {{ card.formulas[selectedOf(card)] }}
            </p>
            <!-- 区块级补充说明：金流费用按销售单计一次，选中它时顺带说明，免得误以为按行重复收。 -->
            <p v-if="card.blockNoteKeys[selectedOf(card)]" class="qs-type-meta text-muted-foreground m-0">
              {{ t(card.blockNoteKeys[selectedOf(card)] ?? '') }}
            </p>

            <!-- 三段来源信息：订单 / 运输 / 账单。 -->
            <div class="gap-3 grid grid-cols-1 min-w-0 sm:grid-cols-3">
              <section
                v-for="group in card.groups"
                :key="group.id"
                class="p-3 border border-border rounded-lg flex flex-col gap-2 min-w-0"
              >
                <h4 class="text-sm font-medium m-0 flex gap-2 items-center">
                  <FaIcon :name="group.icon" class="shrink-0 size-4" :class="group.titleClass" aria-hidden="true" />
                  {{ t(group.titleKey) }}
                </h4>
                <dl class="m-0 flex flex-col gap-1 min-w-0">
                  <div v-for="row in group.rows" :key="row.id" class="flex gap-2 min-w-0 items-baseline">
                    <dt class="qs-type-meta text-muted-foreground shrink-0">
                      {{ row.label }}：
                    </dt>
                    <dd class="m-0 min-w-0">
                      <SlhReconciliationOverflowText :text="row.value" />
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            <!-- 入账分摊：全宽只读快照；左侧逐项归属，右侧目标合计。 -->
            <section v-if="card.allocation !== null" class="p-3 border border-border rounded-lg flex flex-col gap-3 min-w-0">
              <header class="flex flex-wrap gap-x-3 gap-y-1 items-baseline justify-between">
                <h4 class="text-sm font-medium m-0 flex gap-2 items-center">
                  <FaIcon name="i-lucide:split" class="text-emerald-700 shrink-0 size-4 dark:text-emerald-300" aria-hidden="true" />
                  {{ t('slhReconciliation.records.allocationTitle') }}
                </h4>
                <div class="flex flex-wrap gap-2 items-center">
                  <span class="qs-type-meta text-muted-foreground">
                    {{ t('slhReconciliation.records.allocationCount', { items: String(card.allocation.itemCount), parties: String(card.allocation.partyCount) }) }}
                  </span>
                  <span class="qs-type-meta text-muted-foreground px-2 py-0.5 border border-border rounded-md">
                    {{ t('slhReconciliation.records.allocationReadOnly') }}
                  </span>
                </div>
              </header>

              <div class="gap-3 grid grid-cols-1 min-w-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <div class="p-3 border border-border rounded-lg bg-muted/20 flex flex-col gap-2 min-w-0">
                  <h5 class="qs-type-meta text-muted-foreground m-0">
                    {{ t('slhReconciliation.records.allocationItemsTitle') }}
                  </h5>
                  <div class="flex flex-col gap-2 min-w-0">
                    <div
                      v-for="item in card.allocation.items"
                      :key="item.id"
                      class="gap-x-3 gap-y-1 grid grid-cols-[minmax(0,1fr)_auto] min-w-0 items-baseline sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
                    >
                      <span class="text-sm min-w-0 truncate" :title="item.label">{{ item.label }}</span>
                      <span class="text-sm qs-type-data whitespace-nowrap tabular-nums">{{ item.amountText }} {{ item.currencyCode }}</span>
                      <span class="flex flex-wrap gap-1 col-span-full min-w-0 items-center sm:col-span-1 sm:justify-end">
                        <span class="qs-type-meta text-muted-foreground px-2 py-0.5 border border-border rounded-md break-all">
                          {{ item.targetLabel }}
                        </span>
                        <FaTooltip v-if="item.overridden">
                          <span tabindex="0" class="qs-type-meta text-amber-700 cursor-help dark:text-amber-300">
                            {{ t('slhReconciliation.records.allocationAdjusted') }}
                          </span>
                          <template #content>
                            <p class="m-0">
                              {{ t('slhReconciliation.records.allocationReason', { reason: item.reason ?? '—' }) }}
                            </p>
                          </template>
                        </FaTooltip>
                      </span>
                      <span v-if="item.contributionText !== null" class="qs-type-meta text-muted-foreground col-span-full">
                        {{ t('slhReconciliation.records.allocationContribution', { amount: item.contributionText }) }}
                      </span>
                    </div>
                  </div>
                </div>

                <div v-if="card.allocation.parties.length > 0" class="p-3 border border-border rounded-lg bg-muted/20 flex flex-col gap-2 min-w-0">
                  <h5 class="qs-type-meta text-muted-foreground m-0">
                    {{ t('slhReconciliation.records.allocationPartiesTitle') }}
                  </h5>
                  <div class="flex flex-col gap-2 min-w-0">
                    <div
                      v-for="party in card.allocation.parties"
                      :key="party.target"
                      class="p-2.5 border border-border rounded-md bg-card flex flex-col gap-1.5 min-w-0"
                    >
                      <div class="min-w-0">
                        <span class="qs-type-meta text-muted-foreground block truncate">{{ party.title }}</span>
                        <span
                          v-if="party.salesOrderNo !== null"
                          class="text-xs qs-type-data text-muted-foreground mt-0.5 block break-all"
                        >
                          {{ party.salesOrderNo }}
                        </span>
                      </div>
                      <div class="flex flex-wrap gap-x-2 gap-y-1 items-center">
                        <span class="qs-type-meta text-muted-foreground">
                          {{ t('slhReconciliation.settle.allocation.partySettlementLabel') }}
                        </span>
                        <span class="text-base qs-type-data tabular-nums" :class="allocationPartyTone(party.direction)">
                          {{ party.settlementAmountCny ?? '—' }}
                          <span class="text-xs font-normal">CNY</span>
                        </span>
                        <span
                          v-if="party.direction !== 'ZERO'"
                          class="qs-type-meta px-2 py-0.5 border rounded-md"
                          :class="allocationPartyDirectionClass(party.direction)"
                        >
                          {{ t(party.direction === 'OUTFLOW'
                            ? 'slhReconciliation.settle.allocation.partyOutflow'
                            : 'slhReconciliation.settle.allocation.partyInflow') }}
                        </span>
                      </div>
                      <div class="pt-1.5 border-t border-border flex flex-wrap gap-x-2 items-baseline justify-between">
                        <span class="qs-type-meta text-muted-foreground">
                          {{ t('slhReconciliation.settle.allocation.partyFeeLabel') }}
                        </span>
                        <span
                          class="text-sm qs-type-data tabular-nums"
                          :class="party.paymentFeeAmountCny !== null ? 'text-destructive' : 'text-muted-foreground'"
                        >
                          {{ party.paymentFeeAmountCny ?? '—' }}
                          <span v-if="party.paymentFeeAmountCny !== null" class="text-xs font-normal">CNY</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <div class="pt-2 border-t border-border flex flex-col gap-1">
                    <div class="flex flex-wrap gap-x-2 items-baseline justify-between">
                      <span class="qs-type-meta text-muted-foreground">
                        {{ t('slhReconciliation.settle.allocation.partyTotalSettlement') }}
                      </span>
                      <span class="text-base qs-type-data font-semibold tabular-nums">
                        {{ card.allocation.totals.settlementAmountCny }}
                        <span class="text-xs font-normal">CNY</span>
                      </span>
                    </div>
                    <div class="flex flex-wrap gap-x-2 items-baseline justify-between">
                      <span class="qs-type-meta text-muted-foreground">
                        {{ t('slhReconciliation.settle.allocation.partyTotalFee') }}
                      </span>
                      <span
                        class="text-sm qs-type-data tabular-nums"
                        :class="card.allocation.totals.paymentFeeAmountCny === '0.00' ? 'text-muted-foreground' : 'text-destructive'"
                      >
                        {{ card.allocation.totals.paymentFeeAmountCny }}
                        <span class="text-xs font-normal">CNY</span>
                      </span>
                    </div>
                    <span
                      v-if="card.allocation.totals.matchesParent !== null"
                      class="qs-type-meta"
                      :class="card.allocation.totals.matchesParent ? 'text-primary' : 'text-destructive'"
                    >
                      {{ t(card.allocation.totals.matchesParent
                        ? 'slhReconciliation.settle.allocation.partyTotalMatches'
                        : 'slhReconciliation.settle.allocation.partyTotalMismatch') }}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <!-- 展开过的失效记录给一个收起入口，避免长列表一直占屏。 -->
            <button
              v-if="card.collapsedByDefault"
              type="button"
              class="text-sm text-primary font-medium flex gap-1 items-center self-end hover:underline"
              @click="toggleExpanded(card)"
            >
              {{ t('slhReconciliation.records.collapseSnapshot') }}
              <FaIcon name="i-lucide:chevron-up" class="size-4" aria-hidden="true" />
            </button>
          </div>
        </template>
      </article>
    </div>
  </QsGenericModal>
</template>
