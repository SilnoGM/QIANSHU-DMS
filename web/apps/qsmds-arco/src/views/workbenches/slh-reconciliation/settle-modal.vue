<script setup lang="ts">
import type { StepsItem } from '@fantastic-admin/components'
import type { SlhReconciliationSettleRateCard, SlhReconciliationSettleRateSource } from './settle-modal.logic'
import type { SlhReconciliationBatchDetailDto, SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
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
const summary = computed(() => (
  props.member === null
    ? null
    : buildSettleSummary(props.member, selectedRate.value, currencyCatalog.currencies.value)
))

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
  const current = summary.value
  toast.info(t('slhReconciliation.settle.doneToast', {
    settlement: current === null || current.settlementAmount.value === null
      ? t('slhBill.valueMissing')
      : current.settlementAmount.value,
    fee: current === null || current.paymentFeeAmount.value === null
      ? t('slhBill.valueMissing')
      : current.paymentFeeAmount.value,
  }))
}

const canNext = computed(() => selectedRate.value !== null)
</script>

<template>
  <QsGenericModal
    v-model="visible"
    :title="t('slhReconciliation.settle.title')"
    :description="t('slhReconciliation.settle.description')"
    size="xl"
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

    <!-- 第二步：当前已选汇率 + 两个计算式与结果。 -->
    <section v-show="step === 1" class="mt-5 flex flex-col gap-4 min-w-0">
      <article class="p-4 border border-border rounded-lg min-w-0">
        <h3 class="qs-type-section-title m-0 flex gap-2 items-center">
          <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
          {{ t('slhReconciliation.settle.selectedRate') }}
        </h3>
        <p class="text-2xl qs-type-data-emphasis m-0 mt-3 tabular-nums">
          {{ summary?.rate ?? t('slhBill.valueMissing') }}
        </p>
      </article>

      <article class="p-4 border border-border rounded-lg min-w-0">
        <h3 class="qs-type-section-title m-0 flex gap-2 items-center">
          <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
          {{ t('slhReconciliation.settle.settlementTitle') }}
        </h3>
        <p class="text-sm qs-type-data m-0 mt-3 break-all">
          {{ summary?.settlementFormula }}
        </p>
        <!-- 「本行不涉及」的金额按 0 代入时给一行说明，避免把代入值误读成账面数据。 -->
        <p v-if="summary?.settlementAssumesZero" class="qs-type-meta text-muted-foreground m-0 mt-1">
          {{ t('slhReconciliation.settle.missingAmountAsZero') }}
        </p>
        <div class="mt-2 flex justify-end">
          <AmountDisplay
            :value="summary?.settlementAmount.value ?? null"
            :currency="summary?.settlementAmount.currencyCode ?? 'CNY'"
            :currencies="currencyCatalog.currencies.value"
            class="!text-2xl !font-semibold"
          />
        </div>
      </article>

      <article class="p-4 border border-border rounded-lg min-w-0">
        <h3 class="qs-type-section-title m-0 flex gap-2 items-center">
          <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
          {{ t('slhReconciliation.settle.paymentFeeTitle') }}
        </h3>
        <p class="text-sm qs-type-data m-0 mt-3 break-all">
          {{ summary?.paymentFeeFormula }}
        </p>
        <div class="mt-2 flex justify-end">
          <AmountDisplay
            :value="summary?.paymentFeeAmount.value ?? null"
            :currency="summary?.paymentFeeAmount.currencyCode ?? 'CNY'"
            :currencies="currencyCatalog.currencies.value"
            class="!text-2xl !font-semibold"
          />
        </div>
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
