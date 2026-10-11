<script setup lang="ts">
import type { SlhReconciliationRecordAmount } from './records-modal.logic'
import type { SlhReconciliationBatchMemberDto } from '@/api/generated/types.gen'
import { getApiClientErrorMessage } from '@/api/errors'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
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

const cards = ref<ReturnType<typeof buildSlhReconciliationRecordCards>>([])
const loading = ref(false)
const loadError = ref('')
let controller: AbortController | null = null

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
    cards.value = buildSlhReconciliationRecordCards(response.data.items)
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

/** 金额行的颜色：与结算弹窗同一套语义（结算金额按符号、金流服务费恒红）。 */
const AMOUNT_TONE_CLASSES: Record<'danger' | 'neutral' | 'success', string> = {
  danger: '!text-destructive',
  success: '!text-primary',
  neutral: '',
}
function amountClass(amount: SlhReconciliationRecordAmount): string {
  return AMOUNT_TONE_CLASSES[resolveRecordAmountTone(amount)]
}
</script>

<template>
  <QsGenericModal
    v-model="visible"
    :title="t('slhReconciliation.records.title')"
    :description="t('slhReconciliation.records.description')"
    size="lg"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:history" class="size-5" aria-hidden="true" />
    </template>

    <div class="flex flex-col gap-3 min-w-0">
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
        class="p-4 border border-border rounded-lg flex flex-col gap-3 min-w-0"
        :data-record-status="card.status"
      >
        <header class="flex flex-wrap gap-x-3 gap-y-2 items-center">
          <FaTag variant="outline" class="qs-type-status-tag" :class="card.statusClass">
            {{ t(card.statusKey) }}
          </FaTag>
          <span class="qs-type-meta text-muted-foreground">{{ t('slhReconciliation.records.checkedAt') }}</span>
          <DateTimeDisplay :value="card.createdAt" />
          <span class="qs-type-meta text-muted-foreground ml-auto">{{ t('slhReconciliation.records.checkedBy') }}</span>
          <QsPersonDisplay :display-name="card.createdByDisplayName" size="sm" />
        </header>

        <dl class="m-0 p-3 rounded-lg bg-muted/40 flex flex-wrap gap-x-6 gap-y-2 min-w-0">
          <div class="flex gap-2 min-w-0 items-baseline">
            <dt class="qs-type-meta text-muted-foreground shrink-0">
              {{ t('slhReconciliation.records.rateSource') }}
            </dt>
            <dd class="m-0 flex gap-2 min-w-0 items-baseline">
              <span class="text-sm">{{ t(card.rateSourceKey) }}</span>
              <span class="text-sm qs-type-data tabular-nums">{{ card.rate }}</span>
            </dd>
          </div>
          <div class="flex gap-2 min-w-0 items-baseline">
            <dt class="qs-type-meta text-muted-foreground shrink-0">
              {{ t('slhReconciliation.settle.paymentFeeRate') }}
            </dt>
            <dd class="text-sm qs-type-data m-0 tabular-nums">
              {{ card.paymentFeeRate }}
            </dd>
          </div>
        </dl>

        <!-- 六个金额：与库里「金额 + 币种」成对关系一致，走 AmountDisplay 显示币种。 -->
        <dl class="m-0 gap-x-6 gap-y-2 grid grid-cols-1 min-w-0 sm:grid-cols-2">
          <div
            v-for="amount in card.amounts"
            :key="amount.id"
            class="flex gap-2 min-w-0 items-baseline justify-between"
          >
            <dt class="qs-type-meta text-muted-foreground shrink-0">
              {{ t(amount.labelKey) }}
            </dt>
            <dd class="m-0 shrink-0">
              <AmountDisplay
                :value="amount.value"
                :currency="amount.currencyCode"
                :currencies="currencyCatalog.currencies.value"
                class="!text-sm"
                :class="amountClass(amount)"
              />
            </dd>
          </div>
        </dl>

        <p class="qs-type-meta text-muted-foreground m-0 break-all">
          {{ card.references.join(' · ') }}
        </p>
      </article>
    </div>
  </QsGenericModal>
</template>
