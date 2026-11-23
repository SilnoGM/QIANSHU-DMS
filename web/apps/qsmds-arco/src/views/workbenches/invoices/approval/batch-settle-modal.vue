<script setup lang="ts">
import type { InvoiceBatchSettleRow } from '../invoice-batch-settle.logic'
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { formatExchangeRate } from '@/utils/exchange-rate'
import { buildBatchSettlePreview, resolveBatchSettleInvalidItems } from '../invoice-batch-settle.logic'
import { resolveInvoiceFailureKey } from '../invoice-failure.logic'

/**
 * 批量结算确认弹窗：整批共用一份汇率、单事务全有或全无。
 *
 * 服务端在写入前逐张预检，任何一张不合格都会整批拒绝并在 fieldErrors.invalidItems
 * 里给出逐张原因；弹窗必须把这些原因原样列出，财务才能直接剔除后重试。
 */
const props = defineProps<{
  readonly modelValue: boolean
  readonly rate: { readonly foreignUnitsPerCny: string, readonly id: string, readonly version: number } | null
  readonly rows: readonly InvoiceBatchSettleRow[]
}>()
const emit = defineEmits<{
  'completed': []
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const submitting = ref(false)
const submitError = ref<string | null>(null)
const invalidItems = shallowRef<readonly string[]>([])

const preview = computed(() => props.rate === null
  ? null
  : buildBatchSettlePreview(props.rows, props.rate.foreignUnitsPerCny))

const canSubmit = computed(() => props.rate !== null && preview.value !== null && props.rows.length > 0 && !submitting.value)

watch(() => props.modelValue, (open) => {
  if (open) {
    submitError.value = null
    invalidItems.value = []
  }
})

async function submit(): Promise<void> {
  const rate = props.rate
  if (rate === null || props.rows.length === 0 || submitting.value) {
    return
  }
  submitting.value = true
  submitError.value = null
  invalidItems.value = []
  let settled: { count: number, total: string } | null = null
  try {
    const { data } = await invoiceRequestsApi.batchSettle({
      items: props.rows.map(row => ({ id: row.id, expectedVersion: row.version })),
      exchangeRateId: rate.id,
      exchangeRateVersion: rate.version,
    }, new AbortController().signal)
    settled = { count: data.items.length, total: data.totalAmountCny }
  }
  catch (error) {
    submitError.value = t(resolveInvoiceFailureKey(error))
    invalidItems.value = resolveBatchSettleInvalidItems(error)
  }
  finally {
    submitting.value = false
  }
  // 关闭必须晚于释放 submitting：QsGenericModal 在提交期拒绝受控关闭并回写 true。
  if (settled !== null) {
    toast.success(t('invoiceRequest.batch.done', settled))
    emit('completed')
    emit('update:modelValue', false)
  }
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('invoiceRequest.batch.title')"
    :description="t('invoiceRequest.batch.description', { count: rows.length })"
    size="xl"
    :submitting="submitting"
    :dismiss-on-escape="!submitting"
    :dismiss-on-overlay="!submitting"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="space-y-5">
      <section class="p-4 border border-border rounded-xl bg-muted/15 min-w-0 sm:p-5">
        <dl class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.batch.rate') }}
            </dt>
            <dd class="qs-type-data m-0">
              {{ rate === null ? '—' : formatExchangeRate(rate.foreignUnitsPerCny) }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.batch.total') }}
            </dt>
            <dd class="m-0">
              <AmountDisplay
                v-if="preview !== null"
                :value="preview.totalAmountCny"
                currency="CNY"
                :currencies="currencyCatalog.currencies.value"
              />
              <span v-else class="qs-type-data">—</span>
            </dd>
          </div>
          <p class="qs-type-meta m-0 sm:col-span-2">
            {{ t('invoiceRequest.batch.formulaHint') }}
          </p>
        </dl>
      </section>

      <p v-if="rate === null" class="qs-type-meta text-destructive m-0">
        {{ t('invoiceRequest.batch.rateUnavailable') }}
      </p>

      <div v-if="preview !== null" class="border border-border rounded-xl max-h-80 overflow-y-auto">
        <div
          v-for="item in preview.items"
          :key="item.id"
          class="px-4 py-3 border-b border-border gap-x-4 gap-y-1 grid grid-cols-[minmax(0,1fr)_auto] items-center last:border-b-0"
        >
          <div class="min-w-0">
            <p class="qs-type-data-emphasis m-0 break-all">
              {{ item.invoiceNo }}
            </p>
            <p class="qs-type-meta text-muted-foreground m-0 break-words">
              {{ item.buyerName }}
            </p>
          </div>
          <div class="text-right space-y-1">
            <AmountDisplay :value="item.settleAmountCny" currency="CNY" :currencies="currencyCatalog.currencies.value" />
            <p class="qs-type-meta text-muted-foreground m-0">
              <AmountDisplay :value="item.totalAmount" currency="TWD" :currencies="currencyCatalog.currencies.value" :minor-unit="0" />
            </p>
          </div>
        </div>
      </div>

      <FaAlert v-if="submitError !== null" variant="destructive" icon="i-lucide:circle-alert" :title="submitError" role="alert">
        <template v-if="invalidItems.length > 0" #description>
          <ul class="m-0 mt-2 pl-4 space-y-1">
            <li v-for="item in invalidItems" :key="item">
              {{ item }}
            </li>
          </ul>
        </template>
      </FaAlert>
    </div>

    <template #footer>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="close">
        {{ t('invoiceRequest.common.cancel') }}
      </FaButton>
      <FaButton type="button" :loading="submitting" :disabled="!canSubmit" @click="submit">
        {{ t('invoiceRequest.batch.confirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
