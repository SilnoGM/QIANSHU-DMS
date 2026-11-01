<script setup lang="ts">
import type { StepsItem } from '@fantastic-admin/components'
import type {
  SlhReconciliationSettleRateCard,
  SlhReconciliationSettleRateSource,
  SlhReconciliationSettleTermWidth,
  SlhReconciliationSettleTone,
  SlhSettleAllocationItemView,
  SlhSettleAllocationOverride,
  SlhSettleAllocationTarget,
} from './settle-modal.logic'
import type { SlhReconciliationBatchDetailDto, SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import {
  buildSettleAllocation,
  buildSettleRateCards,
  buildSettleSummary,
  formatBareAmount,
  resolveSettleAllocationPartyDirection,
  resolveSettleFailureKey,

} from './settle-modal.logic'

defineOptions({ name: 'SlhReconciliationSettleModal' })

const props = defineProps<{
  readonly modelValue: boolean
  readonly batch: SlhReconciliationBatchDetailDto | null
  readonly member: SlhReconciliationBatchMemberDto | null
  /** 系统当前汇率（台币口径）；取不到传 null，对应卡片禁用。 */
  readonly systemRate: string | null
  /** 账单内置汇率（账单公式自带的那一份）；取不到传 null。 */
  readonly billRate: string | null
}>()
const emit = defineEmits<{
  'settled': []
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

/** 两步：选汇率 → 结算信息。 */
const steps = computed<StepsItem[]>(() => [
  { id: 'rate', title: t('slhReconciliation.settle.stepRate') },
  { id: 'summary', title: t('slhReconciliation.settle.stepSummary') },
])
const step = ref(0)
const activeStepTitle = computed(() => steps.value[step.value]?.title ?? '')

/** 选中的汇率（第一步写入，第二步据此算两个金额）。 */
const selectedSource = ref<SlhReconciliationSettleRateSource | null>(null)
const selectedRate = ref<string | null>(null)
/** 写入进行中：由 QsGenericModal 的 submitting 托管正文与页脚交互。 */
const submitting = ref(false)
/**
 * 提交标识随每次打开生成：双击或网络重试命中同一条记录，
 * 关掉再打开才算新的一次确认。
 */
const settlementKey = ref(crypto.randomUUID())
let controller: AbortController | null = null
const rateCards = computed(() => buildSettleRateCards(props.systemRate, props.billRate))
/** 纯函数只要求最小翻译签名；带参数时显式展开，与页面里其它 logic 的既有写法一致。 */
function translate(key: string, params?: Record<string, unknown>) {
  return params === undefined ? t(key) : t(key, params)
}
const summary = computed(() => (
  props.member === null
    ? null
    : buildSettleSummary(props.member, selectedRate.value, currencyCatalog.currencies.value, translate)
))
/**
 * 逐项入账目标：财务只改目标不改金额；未改动的项不提交，服务端按默认归属入账。
 * COD 固定归乙，界面禁用选择而不是允许后拒绝。
 */
const allocationOverrides = ref<Record<string, SlhSettleAllocationOverride>>({})
const allocation = computed(() => (
  props.member === null
    ? null
    : buildSettleAllocation(
        props.member,
        summary.value?.payload.paymentFeeAmountCny ?? null,
        selectedRate.value,
        allocationOverrides.value,
      )
))
const allocationBlocked = computed(() => allocation.value !== null && (
  allocation.value.breakdownMismatch
  || allocation.value.reasonMissing
  || allocation.value.sourceMissing
))
/** 只有甲/乙时两列铺满，出现公司目标才切三列；不再固定三列留空。 */
const allocationPartyGridClass = computed(() => {
  const count = allocation.value?.parties.length ?? 0
  if (count >= 3) {
    return 'sm:grid-cols-3'
  }
  if (count === 2) {
    return 'sm:grid-cols-2'
  }
  return 'sm:grid-cols-1'
})
const allocationTargetOptions = computed(() => {
  const member = props.member
  const origin = member?.salesOrder
  const current = member?.currentSalesOrder
  if (origin === null || origin === undefined || current === null || current === undefined) {
    return []
  }
  const options = origin.id === current.id
    ? []
    : [{ label: t('slhReconciliation.settle.allocation.targetOrigin', { orderNo: origin.orderNo }), value: 'ORIGIN_ORDER' }]
  options.push({ label: t('slhReconciliation.settle.allocation.targetCurrent', { orderNo: current.orderNo }), value: 'CURRENT_ORDER' })
  options.push({ label: t('slhReconciliation.settle.allocation.targetCompany'), value: 'COMPANY' })
  return options
})

function allocationItemLabel(item: SlhSettleAllocationItemView): string {
  if (item.sourceType === 'BILL_CHARGE') {
    return t(`slhBill.chargeType.${item.chargeType ?? 'OTHER'}`)
  }
  return t(`slhReconciliation.settle.allocation.source${item.sourceType}`)
}

function allocationItemAmount(item: SlhSettleAllocationItemView): string {
  return formatBareAmount(item.amount, item.currencyCode, currencyCatalog.currencies.value)
}

function allocationPartyTitle(target: SlhSettleAllocationTarget): string {
  if (target === 'COMPANY') {
    return t('slhReconciliation.settle.allocation.partyCompany')
  }
  const key = target === 'ORIGIN_ORDER' ? 'partyOriginTitle' : 'partyCurrentTitle'
  return t(`slhReconciliation.settle.allocation.${key}`)
}

function allocationPartyDirectionKey(value: string | null): string | null {
  const direction = resolveSettleAllocationPartyDirection(value)
  if (direction === 'ZERO') {
    return null
  }
  return t(direction === 'OUTFLOW'
    ? 'slhReconciliation.settle.allocation.partyOutflow'
    : 'slhReconciliation.settle.allocation.partyInflow')
}

function allocationPartyDirectionClass(value: string | null): string {
  const direction = resolveSettleAllocationPartyDirection(value)
  if (direction === 'OUTFLOW') {
    return 'text-destructive border-destructive/30 bg-destructive/10'
  }
  if (direction === 'INFLOW') {
    return 'text-primary border-primary/30 bg-primary/10'
  }
  return ''
}

/** 目标合计按符号着色：负红、正绿，零保持前景色。 */
function allocationPartyTone(value: string | null): string {
  if (value === null || value.startsWith('0') || value === '-0.00') {
    return ''
  }
  return value.startsWith('-') ? 'text-destructive' : 'text-primary'
}

function changeAllocationTarget(key: string, rawTarget: unknown): void {
  const item = allocation.value?.items.find(entry => entry.key === key)
  const target = String(rawTarget) as SlhSettleAllocationTarget
  if (item === undefined || item.sourceType === 'COD') {
    return
  }
  if (target === item.defaultTarget) {
    const next = { ...allocationOverrides.value }
    delete next[key]
    allocationOverrides.value = next
    return
  }
  allocationOverrides.value = {
    ...allocationOverrides.value,
    [key]: { target, reason: allocationOverrides.value[key]?.reason ?? '' },
  }
}

function changeAllocationReason(key: string, rawReason: string): void {
  const existing = allocationOverrides.value[key]
  if (existing === undefined) {
    return
  }
  allocationOverrides.value = { ...allocationOverrides.value, [key]: { ...existing, reason: rawReason } }
}
/** 结果色：结算金额按符号（负红/正绿）、金流费恒红，颜色只由逻辑层给的 tone 决定。 */
const RESULT_CARD_CLASSES: Record<SlhReconciliationSettleTone, string> = {
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  success: 'border-primary/30 bg-primary/10 text-primary',
  neutral: 'border-border bg-muted/40 text-foreground',
}
/** 汇率与费率的值用琥珀黄强调（用户 2026-10-11 口径）。 */
const ACCENT_VALUE_CLASS = 'text-amber-700 dark:text-amber-300'
/** 结果数值必须显式着色：`qs-type-data` 自带 `text-foreground`，会盖掉卡片继承的语义色。 */
const RESULT_VALUE_CLASSES: Record<SlhReconciliationSettleTone, string> = {
  danger: '!text-destructive',
  success: '!text-primary',
  neutral: '',
}
/**
 * 卡片宽度档位：被减项与销售额吃剩余宽度（上限 12rem，多出的留白推到结果卡左侧），
 * 汇率/费率与合计应付固定宽度——位数不受控的项固定住，整行才不会随数据抖动。
 */
const TERM_WIDTH_CLASSES: Record<SlhReconciliationSettleTermWidth, string> = {
  flex: 'flex-1 min-w-[7rem] max-w-[12rem]',
  rate: 'w-[6.5rem] shrink-0',
  payable: 'w-[7.5rem] shrink-0',
}
/** 结果卡固定宽度并贴右；值槽按「符号位 + 6 位整数 + 2 位小数 + 1ch 余量」预留。 */
const RESULT_CARD_WIDTH_CLASS = 'w-[16.5rem] shrink-0 ml-auto'
const RESULT_VALUE_SLOT_CLASS = 'min-w-[12ch]'
/**
 * 虚线分组框；普通分组用 display:contents 保持在同一行流里。
 * 分组要自己吃剩余宽度（否则内部两张卡只能停在最小宽度），上限＝两张卡各自的上限
 * 12rem×2 + 内距 2×0.5rem + 卡间两段 gap 1rem + 运算符徽标 1.25rem = 27.5rem。
 */
const DASHED_GROUP_CLASSES = 'flex flex-wrap flex-1 gap-2 min-w-0 max-w-[27.5rem] px-2 py-2 border border-dashed border-border rounded-xl items-center'

/** 每次打开都重置：回到第一步、清掉上一行的选择与分摊覆盖，并换一个提交标识。 */
watch(() => props.modelValue, (open) => {
  if (open) {
    step.value = 0
    selectedSource.value = null
    selectedRate.value = null
    allocationOverrides.value = {}
    settlementKey.value = crypto.randomUUID()
  }
})

function selectRate(card: SlhReconciliationSettleRateCard): void {
  if (card.disabled || card.rate === null) {
    return
  }
  selectedSource.value = card.source
  selectedRate.value = card.rate
}

/**
 * 确定结算：把这一行的结算结果写进库。
 *
 * 提交界面上的汇率与六个金额，服务端按来源重取汇率、重算并逐项比对后才落库；
 * 成功即视为本行已核对（服务端同时标记成员行与账单行），关窗并让页面刷新。
 */
async function confirmSettlement(): Promise<void> {
  const current = summary.value
  const currentAllocation = allocation.value
  const member = props.member
  const batch = props.batch
  if (current === null || currentAllocation === null || member === null || batch === null
    || selectedSource.value === null || selectedRate.value === null) {
    return
  }
  if (currentAllocation.breakdownMismatch) {
    toast.error(t('slhReconciliation.settle.allocation.breakdownMismatch'))
    return
  }
  if (currentAllocation.reasonMissing) {
    toast.error(t('slhReconciliation.settle.allocation.reasonRequired'))
    return
  }
  controller?.abort()
  const pending = new AbortController()
  controller = pending
  submitting.value = true
  try {
    await slhReconciliationBatchesApi.settle(batch.id, {
      batchLineId: member.id,
      rateSource: selectedSource.value,
      rate: selectedRate.value,
      amounts: current.payload,
      ...(currentAllocation.payload.length === 0 ? {} : { allocationTargets: [...currentAllocation.payload] }),
    }, settlementKey.value, pending.signal)
    if (pending.signal.aborted) {
      return
    }
    toast.success(t('slhReconciliation.settle.savedToast'))
    visible.value = false
    emit('settled')
  }
  catch (failure) {
    if (!pending.signal.aborted) {
      toast.error(t(resolveSettleFailureKey(failure)))
    }
  }
  finally {
    if (controller === pending) {
      submitting.value = false
    }
  }
}

const canNext = computed(() => selectedRate.value !== null)
</script>

<template>
  <QsGenericModal
    v-model="visible"
    :title="t('slhReconciliation.settle.title')"
    :description="t('slhReconciliation.settle.description')"
    :submitting="submitting"
    size="2xl"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:calculator" class="size-5" aria-hidden="true" />
    </template>

    <nav class="flex flex-col gap-3">
      <p class="text-sm text-muted-foreground m-0" aria-live="polite">
        {{
          t('slhReconciliation.settle.stepIndicator', {
            current: step + 1,
            total: steps.length,
            title: activeStepTitle,
          })
        }}
      </p>
      <FaSteps v-model="step" :steps="steps" status="process" class="w-full" />
    </nav>

    <!-- 第一步：两份汇率二选一。卡片形态对齐项目既有的「选择订单币种」弹窗。 -->
    <section v-show="step === 0" class="mt-5 min-w-0">
      <fieldset class="m-0 p-0 border-0 min-w-0 w-full">
        <legend class="sr-only">
          {{ t('slhReconciliation.settle.stepRate') }}
        </legend>
        <div class="gap-5 grid grid-cols-1 lg:grid-cols-2">
          <label
            v-for="card in rateCards"
            :key="card.source"
            class="min-w-0 relative"
            :class="card.disabled ? 'cursor-not-allowed' : 'cursor-pointer'"
          >
            <input
              type="radio"
              name="slh-reconciliation-settlement-rate"
              :value="card.source"
              :checked="selectedSource === card.source"
              :disabled="card.disabled"
              class="peer sr-only"
              @change="selectRate(card)"
            >
            <span
              data-testid="slh-reconciliation-settle-rate-card"
              :data-rate-source="card.source"
              class="p-5 text-left border rounded-xl bg-background flex flex-col min-h-56 transition-[border-color,background-color,box-shadow,transform] duration-200 ease-out relative overflow-hidden sm:p-6 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background"
              :class="card.disabled
                ? 'border-border bg-muted/30 opacity-60'
                : selectedSource === card.source
                  ? 'border-primary bg-primary/[0.035] shadow-md ring-1 ring-primary/20'
                  : 'border-border shadow-sm hover:border-primary/40 hover:bg-muted/20 hover:shadow-md'"
            >
              <span class="flex gap-4 min-w-0 items-start relative">
                <span
                  class="rounded-xl flex shrink-0 size-16 ring-2 shadow-sm items-center justify-center"
                  :class="card.emblemClass"
                  aria-hidden="true"
                >
                  <FaIcon :name="card.icon" class="size-7" />
                </span>
                <span class="pt-0.5 flex-1 min-w-0">
                  <strong class="text-lg leading-7 font-semibold block truncate">
                    {{ t(card.titleKey) }}
                  </strong>
                  <span class="qs-type-meta text-muted-foreground mt-1.5 px-2 py-0.5 border border-border rounded-md inline-flex max-w-full items-center">
                    {{ t(card.sourceKey) }}
                  </span>
                </span>
                <FaIcon
                  v-if="selectedSource === card.source && !card.disabled"
                  name="i-lucide:circle-check-big"
                  class="text-primary shrink-0 size-7"
                  aria-hidden="true"
                />
                <FaIcon
                  v-else-if="card.disabled"
                  name="i-lucide:circle-slash-2"
                  class="text-muted-foreground shrink-0 size-7"
                  aria-hidden="true"
                />
              </span>

              <span class="mt-6 pt-5 border-t border-border border-dashed flex flex-1 flex-col min-w-0 relative">
                <span class="text-2xl qs-type-data-emphasis tabular-nums">
                  {{ card.rate ?? t('slhBill.valueMissing') }}
                </span>
                <span class="qs-type-meta text-muted-foreground mt-1">
                  {{ card.rate === null ? t('slhReconciliation.settle.rateMissing') : t('slhReconciliation.settle.rateHint', { rate: card.rate }) }}
                </span>
                <span
                  class="text-sm font-medium mt-auto pt-6 flex gap-2 items-center relative z-10"
                  :class="selectedSource === card.source && !card.disabled ? 'text-primary' : 'text-muted-foreground'"
                >
                  <FaIcon name="i-lucide:mouse-pointer-click" class="size-4" aria-hidden="true" />
                  {{ card.disabled
                    ? t('slhReconciliation.settle.rateUnavailable')
                    : selectedSource === card.source
                      ? t('slhReconciliation.settle.rateSelected')
                      : t('slhReconciliation.settle.rateSelect') }}
                </span>
                <FaIcon
                  name="i-lucide:percent"
                  class="size-28 absolute -bottom-8 -right-5"
                  :class="card.motifClass"
                  aria-hidden="true"
                />
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      <FaAlert
        v-if="rateCards.every(card => card.disabled)"
        variant="destructive"
        :title="t('slhReconciliation.settle.rateMissingNote')"
        class="mt-4"
      />
    </section>

    <!-- 第二步：基准汇率条 + 两块算式表与结果。 -->
    <section v-show="step === 1" class="mt-5 flex flex-col gap-4 min-w-0">
      <div class="px-4 py-3 border border-border rounded-xl flex flex-wrap gap-x-3 gap-y-2 min-w-0 items-center">
        <span class="text-sm text-primary font-medium px-2.5 py-1 rounded-md bg-primary/10 shrink-0">
          {{ t('slhReconciliation.settle.baseRate') }}
        </span>
        <span class="qs-type-meta text-muted-foreground shrink-0">
          {{ t('slhReconciliation.settle.baseRateLabel') }}
        </span>
        <span class="text-base qs-type-data tabular-nums">
          {{ summary?.rateBaseText }}
        </span>
        <button
          type="button"
          class="text-sm text-primary font-medium ml-auto shrink-0 hover:underline"
          @click="step = 0"
        >
          {{ t('slhReconciliation.settle.changeRate') }}
        </button>
      </div>

      <article
        v-for="block in summary?.blocks ?? []"
        :key="block.id"
        class="p-4 border border-border rounded-lg min-w-0"
      >
        <header class="flex flex-wrap gap-x-3 items-baseline justify-between">
          <h3 class="qs-type-section-title m-0 flex gap-2 items-center">
            <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
            {{ t(block.titleKey) }}
          </h3>
          <p class="qs-type-meta text-muted-foreground m-0">
            {{ block.formula }}
          </p>
        </header>

        <!-- 横排算式：操作数卡片 + 运算符徽标；账单侧被减的两项圈在虚线框里。 -->
        <div class="mt-3 flex flex-wrap gap-2 min-w-0 items-center">
          <div
            v-for="group in block.groups"
            :key="group.id"
            :class="group.dashed ? DASHED_GROUP_CLASSES : 'contents'"
          >
            <template v-for="term in group.terms" :key="term.id">
              <span
                v-if="term.operator !== null"
                class="text-xs text-muted-foreground rounded-full bg-muted flex shrink-0 size-5 items-center justify-center"
                aria-hidden="true"
              >
                {{ term.operator }}
              </span>
              <div
                class="px-3 py-2 border border-border rounded-lg bg-card flex flex-col gap-0.5"
                :class="TERM_WIDTH_CLASSES[term.width]"
              >
                <span class="qs-type-meta text-muted-foreground truncate" :title="term.label">
                  {{ term.label }}<template v-if="term.unit !== null"> ({{ term.unit }})</template>
                </span>
                <span
                  class="text-base qs-type-data text-right truncate tabular-nums"
                  :class="term.accent ? ACCENT_VALUE_CLASS : ''"
                  :data-currency="term.currencyCode ?? undefined"
                  :title="term.value"
                >
                  {{ term.value }}
                </span>
              </div>
            </template>
          </div>

          <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground shrink-0 size-4" aria-hidden="true" />

          <!-- 结果卡：标签 + 裸数字 + 币种 chip，颜色跟着逻辑层的 tone 走；固定宽度并贴右。 -->
          <div
            class="px-3 py-2 border rounded-lg flex gap-4 items-center overflow-hidden"
            :class="[RESULT_CARD_CLASSES[block.resultTone], RESULT_CARD_WIDTH_CLASS]"
            :data-tone="block.resultTone"
          >
            <span class="flex flex-col gap-0.5 min-w-0">
              <span class="text-xs font-medium truncate" :title="t(block.resultLabelKey)">
                {{ t(block.resultLabelKey) }}
              </span>
              <span
                class="text-2xl qs-type-data font-semibold text-right truncate tabular-nums"
                :class="[RESULT_VALUE_CLASSES[block.resultTone], RESULT_VALUE_SLOT_CLASS]"
                :data-currency="block.resultCurrencyCode"
                :title="block.result"
              >
                {{ block.result }}
              </span>
            </span>
            <span class="text-xs font-medium px-2 py-0.5 rounded-md bg-background/70 shrink-0 self-start">
              {{ block.resultCurrencyCode }}
            </span>
          </div>
        </div>

        <!-- 「本行不涉及」的金额被按 0 代入过才给说明，避免把代入值误读成账面数据。 -->
        <p v-if="block.noteKey" class="qs-type-meta text-muted-foreground m-0 mt-2">
          {{ t(block.noteKey) }}
        </p>
      </article>

      <!-- 入账分摊：财务逐项确认目标；甲/乙按销售订单出单人比例入账，公司目标全额由公司承担。 -->
      <article v-if="allocation !== null" class="p-4 border border-border rounded-lg flex flex-col gap-3 min-w-0">
        <header class="flex flex-wrap gap-x-3 gap-y-1 items-baseline justify-between">
          <h3 class="qs-type-section-title m-0 flex gap-2 items-center">
            <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
            {{ t('slhReconciliation.settle.allocation.title') }}
          </h3>
          <p class="qs-type-meta text-muted-foreground m-0">
            {{ t('slhReconciliation.settle.allocation.note') }}
          </p>
        </header>

        <FaAlert
          v-if="allocation.breakdownMismatch"
          variant="destructive"
          :title="t('slhReconciliation.settle.allocation.breakdownMismatch')"
        />

        <template v-else>
          <div class="flex flex-col gap-2 min-w-0">
            <div
              v-for="item in allocation.items"
              :key="item.key"
              class="p-3 border border-border rounded-lg bg-muted/20 flex flex-col gap-2 min-w-0"
            >
              <div class="flex flex-wrap gap-x-3 gap-y-2 min-w-0 items-center">
                <span class="text-sm font-medium min-w-0 truncate">{{ allocationItemLabel(item) }}</span>
                <span class="text-sm qs-type-data text-muted-foreground tabular-nums">
                  {{ allocationItemAmount(item) }} {{ item.currencyCode }}
                </span>
                <span
                  v-if="item.sourceType === 'COD'"
                  class="qs-type-meta text-muted-foreground ml-auto px-2 py-0.5 border border-border rounded-md"
                >
                  {{ t('slhReconciliation.settle.allocation.codFixed') }}
                </span>
                <FaSelect
                  v-else
                  :model-value="item.target"
                  :options="allocationTargetOptions"
                  class="ml-auto max-w-full w-64"
                  @update:model-value="changeAllocationTarget(item.key, $event)"
                />
              </div>
              <div v-if="item.overridden" class="flex flex-col gap-1">
                <FaInput
                  :model-value="item.reason"
                  maxlength="500"
                  :placeholder="t('slhReconciliation.settle.allocation.reasonPlaceholder')"
                  @update:model-value="changeAllocationReason(item.key, String($event))"
                />
                <span v-if="item.reason === ''" class="text-xs text-destructive">
                  {{ t('slhReconciliation.settle.allocation.reasonRequired') }}
                </span>
              </div>
            </div>
          </div>

          <div class="gap-2 grid" :class="allocationPartyGridClass">
            <div
              v-for="party in allocation.parties"
              :key="party.target"
              class="p-3 border border-border rounded-lg bg-card flex flex-col gap-2 min-w-0"
            >
              <div class="min-w-0">
                <span class="qs-type-meta text-muted-foreground block truncate">
                  {{ allocationPartyTitle(party.target) }}
                </span>
                <span
                  v-if="party.salesOrderNo !== null"
                  class="text-xs qs-type-data text-muted-foreground mt-0.5 block break-all"
                  :title="party.salesOrderNo"
                >
                  {{ party.salesOrderNo }}
                </span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="qs-type-meta text-muted-foreground">
                  {{ t('slhReconciliation.settle.allocation.partySettlementLabel') }}
                </span>
                <div class="flex flex-wrap gap-x-2 gap-y-1 items-center">
                  <span class="text-lg qs-type-data tabular-nums" :class="allocationPartyTone(party.settlementAmountCny)">
                    {{ party.settlementAmountCny ?? '—' }}
                    <span class="text-xs font-normal">CNY</span>
                  </span>
                  <span
                    v-if="allocationPartyDirectionKey(party.settlementAmountCny) !== null"
                    class="qs-type-meta px-2 py-0.5 border rounded-md"
                    :class="allocationPartyDirectionClass(party.settlementAmountCny)"
                  >
                    {{ allocationPartyDirectionKey(party.settlementAmountCny) }}
                  </span>
                </div>
              </div>
              <div class="pt-2 border-t border-border flex flex-wrap gap-x-2 items-baseline justify-between">
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

          <div class="pt-2 border-t border-border flex flex-wrap gap-x-4 gap-y-1 items-baseline justify-between">
            <div class="flex flex-wrap gap-x-4 gap-y-1 items-baseline">
              <div class="flex flex-wrap gap-x-2 items-baseline">
                <span class="qs-type-meta text-muted-foreground">
                  {{ t('slhReconciliation.settle.allocation.partyTotalSettlement') }}
                </span>
                <span class="text-lg qs-type-data font-semibold tabular-nums">
                  {{ allocation.totals.settlementAmountCny }}
                  <span class="text-xs font-normal">CNY</span>
                </span>
              </div>
              <div class="flex flex-wrap gap-x-2 items-baseline">
                <span class="qs-type-meta text-muted-foreground">
                  {{ t('slhReconciliation.settle.allocation.partyTotalFee') }}
                </span>
                <span
                  class="text-sm qs-type-data tabular-nums"
                  :class="allocation.totals.paymentFeeAmountCny === '0.00' ? 'text-muted-foreground' : 'text-destructive'"
                >
                  {{ allocation.totals.paymentFeeAmountCny }}
                  <span class="text-xs font-normal">CNY</span>
                </span>
              </div>
            </div>
            <span
              v-if="allocation.totals.matchesParent !== null"
              class="qs-type-meta"
              :class="allocation.totals.matchesParent ? 'text-primary' : 'text-destructive'"
            >
              {{ t(allocation.totals.matchesParent
                ? 'slhReconciliation.settle.allocation.partyTotalMatches'
                : 'slhReconciliation.settle.allocation.partyTotalMismatch') }}
            </span>
          </div>

          <p v-if="allocation.reasonMissing" class="text-sm text-destructive m-0">
            {{ t('slhReconciliation.settle.allocation.reasonRequired') }}
          </p>
          <p class="qs-type-meta text-muted-foreground m-0">
            {{ t('slhReconciliation.settle.allocation.partyNote') }}
          </p>
        </template>
      </article>
    </section>

    <template #footer>
      <FaButton type="button" variant="outline" class="px-7 min-h-11" @click="visible = false">
        {{ t('slhReconciliation.settle.cancel') }}
      </FaButton>
      <FaButton
        v-if="step === 1"
        type="button"
        variant="outline"
        class="px-7 min-h-11"
        @click="step = 0"
      >
        {{ t('slhReconciliation.settle.previous') }}
      </FaButton>
      <FaButton
        v-if="step === 0"
        type="button"
        class="px-7 min-h-11"
        :disabled="!canNext"
        @click="step = 1"
      >
        {{ t('slhReconciliation.settle.next') }}
      </FaButton>
      <FaButton
        v-else
        type="button"
        class="px-7 min-h-11"
        :disabled="allocationBlocked"
        @click="confirmSettlement"
      >
        {{ t('slhReconciliation.settle.confirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
