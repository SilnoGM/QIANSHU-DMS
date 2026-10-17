<script setup lang="ts">
import type { FundSelfTransactionDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import {
  LEDGER_BATCH_KIND_META,
  LEDGER_CATEGORY_META,
  LEDGER_DIRECTION_META,
  LEDGER_REVERSAL_META,
  ledgerSignedAmount,
} from './ledger.logic'

defineOptions({ name: 'FundTransactionDetailModal' })

/**
 * 个人流水只读详情：直接使用列表行数据，不额外请求；金额正负与颜色复用表格口径。
 */
const props = defineProps<{
  modelValue: boolean
  transaction: FundSelfTransactionDto | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()

const item = computed(() => props.transaction)
const batchKind = computed(() => item.value === null
  ? null
  : LEDGER_BATCH_KIND_META[item.value.batchKind])
const reversal = computed(() => item.value === null
  ? null
  : LEDGER_REVERSAL_META[item.value.reversalStatus])
const direction = computed(() => item.value === null
  ? null
  : LEDGER_DIRECTION_META[item.value.direction])
const categoryLabelKey = computed(() => item.value === null
  ? ''
  : LEDGER_CATEGORY_META[item.value.businessCategory].labelKey)
const signedAmount = computed(() => item.value === null
  ? ''
  : ledgerSignedAmount(item.value.direction, item.value.amount))
const description = computed(() => item.value === null
  ? undefined
  : `#${item.value.accountSequence} · ${item.value.batchNo}`)

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('personalFinanceLedger.detail.title')"
    :description="description"
    size="lg"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="item !== null" class="gap-5 grid">
      <section class="p-4 border border-border rounded-xl bg-muted/25 sm:p-5">
        <div class="flex flex-wrap gap-2 items-center">
          <span class="qs-type-component-title">{{ item.postingTypeName }}</span>
          <span
            v-if="batchKind"
            class="qs-type-tag px-2 py-0.5 border rounded-md"
            :class="batchKind.pillClass"
          >
            {{ t(batchKind.labelKey) }}
          </span>
          <span
            v-if="reversal"
            class="qs-type-tag px-2 py-0.5 border rounded-md"
            :class="reversal.pillClass"
          >
            {{ t(reversal.labelKey) }}
          </span>
        </div>
        <p class="qs-type-meta text-muted-foreground m-0 mt-1">
          {{ item.businessSourceName }} · {{ t(categoryLabelKey) }}
        </p>

        <div class="mt-4 gap-4 grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div class="min-w-0">
            <p class="qs-type-compact-label m-0 mb-1">
              {{ t('personalFinanceLedger.column.amount') }}
            </p>
            <div class="flex flex-wrap gap-2 items-center">
              <span class="qs-type-tag px-2 py-0.5 rounded-md" :class="direction?.badgeClass">
                {{ t(direction?.labelKey ?? '') }}
              </span>
              <span class="inline-flex items-baseline" :class="direction?.amountClass">
                <span
                  v-if="item.direction === 'CREDIT'"
                  class="qs-type-data-emphasis !text-base !font-semibold"
                  :class="direction?.amountClass"
                >+</span>
                <AmountDisplay
                  :value="signedAmount"
                  currency="CNY"
                  :currencies="currencyCatalog.currencies.value"
                  class="!text-2xl !font-semibold"
                  :class="direction?.amountClass"
                />
              </span>
            </div>
          </div>

          <dl class="m-0 gap-x-6 gap-y-2 grid grid-cols-2">
            <div class="text-right">
              <dt class="qs-type-compact-label">
                {{ t('personalFinanceLedger.column.balanceAfter') }}
              </dt>
              <dd class="m-0 mt-1">
                <AmountDisplay
                  :value="item.balanceAfter"
                  currency="CNY"
                  :currencies="currencyCatalog.currencies.value"
                  class="!text-base !font-semibold"
                />
              </dd>
            </div>
            <div class="text-right">
              <dt class="qs-type-compact-label">
                {{ t('personalFinanceLedger.column.balanceBefore') }}
              </dt>
              <dd class="m-0 mt-1">
                <AmountDisplay
                  :value="item.balanceBefore"
                  currency="CNY"
                  :currencies="currencyCatalog.currencies.value"
                  class="!text-base !font-semibold"
                />
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <dl class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
        <div>
          <dt class="qs-type-compact-label">
            {{ t('personalFinanceLedger.column.postedAt') }}
          </dt>
          <dd class="m-0">
            <DateTimeDisplay :value="item.postedAt" format="datetime" />
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label">
            {{ t('personalFinanceLedger.detail.businessOccurredAt') }}
          </dt>
          <dd class="m-0">
            <DateTimeDisplay :value="item.businessOccurredAt" format="datetime" />
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label">
            {{ t('personalFinanceLedger.column.businessBasis') }}
          </dt>
          <dd class="m-0">
            <AmountDisplay
              :value="item.businessAmount"
              currency="CNY"
              :currencies="currencyCatalog.currencies.value"
              class="!text-base !font-semibold"
            />
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label">
            {{ t('personalFinanceLedger.detail.summary') }}
          </dt>
          <dd class="qs-type-body m-0 break-words">
            {{ item.summary }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label">
            {{ t('personalFinanceLedger.businessNo') }}
          </dt>
          <dd class="qs-type-data-mono m-0 break-all">
            {{ item.businessNo ?? t('personalFinanceLedger.noBusinessNo') }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label">
            {{ t('personalFinanceLedger.batchNo') }}
          </dt>
          <dd class="qs-type-data-mono m-0 break-all">
            {{ item.batchNo }}
          </dd>
        </div>
        <div v-if="reversal !== null">
          <dt class="qs-type-compact-label">
            {{ t('personalFinanceLedger.detail.reversalStatus') }}
          </dt>
          <dd class="m-0">
            <span class="qs-type-tag px-2 py-0.5 border rounded-md" :class="reversal.pillClass">
              {{ t(reversal.labelKey) }}
            </span>
          </dd>
        </div>
      </dl>
    </div>

    <template #footer>
      <FaButton type="button" variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" @click="close">
        {{ t('personalFinanceLedger.detail.close') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
