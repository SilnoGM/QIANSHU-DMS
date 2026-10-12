<script setup lang="ts">
import type { SlhReconciliationRecordAmount, SlhReconciliationRecordBlockId, SlhReconciliationRecordCard } from './records-modal.logic'
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
    cards.value = buildSlhReconciliationRecordCards(response.data.items, currencyCatalog.currencies.value)
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
          <QsPersonDisplay :display-name="card.createdByDisplayName" size="sm" class="ml-auto" />
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
