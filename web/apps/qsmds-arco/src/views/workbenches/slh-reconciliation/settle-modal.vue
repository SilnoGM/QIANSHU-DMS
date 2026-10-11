<script setup lang="ts">
import type { StepsItem } from '@fantastic-admin/components'
import type { SlhReconciliationSettleRateCard, SlhReconciliationSettleRateSource, SlhReconciliationSettleTermWidth, SlhReconciliationSettleTone } from './settle-modal.logic'
import type { SlhReconciliationBatchDetailDto, SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import {
  buildSettleRateCards,
  buildSettleSummary,

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
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

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

/** 每次打开都重置：回到第一步、清掉上一行的选择。 */
watch(() => props.modelValue, (open) => {
  if (open) {
    step.value = 0
    selectedSource.value = null
    selectedRate.value = null
  }
})

function selectRate(card: SlhReconciliationSettleRateCard): void {
  if (card.disabled || card.rate === null) {
    return
  }
  selectedSource.value = card.source
  selectedRate.value = card.rate
}

/** 确定：只把两个金额打出来（轻提示），不落库。 */
function confirmSettlement(): void {
  const blocks = summary.value?.blocks ?? []
  const missing = t('slhBill.valueMissing')
  const resultOf = (id: 'settlement' | 'paymentFee') => (
    blocks.find(block => block.id === id)?.result ?? missing
  )
  toast.info(t('slhReconciliation.settle.doneToast', {
    settlement: resultOf('settlement'),
    fee: resultOf('paymentFee'),
  }))
}

const canNext = computed(() => selectedRate.value !== null)
</script>

<template>
  <QsGenericModal
    v-model="visible"
    :title="t('slhReconciliation.settle.title')"
    :description="t('slhReconciliation.settle.description')"
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
        @click="confirmSettlement"
      >
        {{ t('slhReconciliation.settle.confirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
