<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { revisionAmounts } from '@/components/business/QsPurchaseOrderDrawer/logic'
import { fulfillmentStatusTagClass, orderStatusTagClass, paymentStatusTagClass } from './purchase-order-list.logic'

const props = defineProps<{ detail: PurchaseOrderDetailDto, currencies: readonly CurrencyDescriptor[] }>()
const { t, te } = useI18n()
const activeChangeTab = ref('status')
// 变更前后按状态本身着色，与采购列表保持相同语义，不能将变更后统一视为成功。
const statusClasses: Record<string, string> = {
  PENDING_REVIEW: orderStatusTagClass('PENDING_REVIEW'),
  CONFIRMED: orderStatusTagClass('CONFIRMED'),
  COMPLETED: orderStatusTagClass('COMPLETED'),
  CANCELLED: orderStatusTagClass('CANCELLED'),
  ORDERED: fulfillmentStatusTagClass('ORDERED'),
  PREPARING: fulfillmentStatusTagClass('PREPARING'),
  SHIPPED: fulfillmentStatusTagClass('SHIPPED'),
  SIGNED: fulfillmentStatusTagClass('SIGNED'),
  UNPAID: paymentStatusTagClass('UNPAID'),
  PARTIALLY_PAID: paymentStatusTagClass('PARTIALLY_PAID'),
  PAID: paymentStatusTagClass('PAID'),
}
const tabs = computed(() => [
  { value: 'status', label: t('purchaseOrderList.records.statusTab', { count: props.detail.statusHistory.length }) },
  { value: 'amount', label: t('purchaseOrderList.records.amountTab', { count: props.detail.amountRevisions.length }) },
])
function statusLabel(value: string) {
  const key = `purchaseOrderDrawer.statuses.${value}`
  return te(key) ? t(key) : value
}
</script>

<template>
  <section :aria-label="t('purchaseOrderList.records.changes')">
    <FaTabs v-model="activeChangeTab" :list="tabs" list-class="h-auto min-h-11 w-full" content-class="mt-4 min-w-0">
      <template #status>
        <FaEmpty v-if="!detail.statusHistory.length" icon="i-lucide:history" :title="t('purchaseOrderList.records.noStatusChanges')" class="py-10" />
        <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
          <li v-for="history in detail.statusHistory" :key="history.id" class="py-4">
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <h3 class="qs-type-section-title m-0">
                {{ t(`purchaseOrderDrawer.dimensions.${history.dimension}`) }}
              </h3>
              <DateTimeDisplay :value="history.changedAt" class="qs-type-meta" />
            </div>
            <p class="m-0 mt-2 flex flex-wrap gap-2 items-center">
              <FaTag variant="outline" class="qs-type-status-tag" :class="statusClasses[history.fromStatus]">
                {{ statusLabel(history.fromStatus) }}
              </FaTag>
              <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4" aria-hidden="true" />
              <FaTag variant="outline" class="qs-type-status-tag" :class="statusClasses[history.toStatus]">
                {{ statusLabel(history.toStatus) }}
              </FaTag>
            </p>
            <p class="text-sm m-0 mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {{ t('purchaseOrderDrawer.reason') }}：{{ history.reason?.trim() || t('purchaseOrderDrawer.reasonNotRecorded') }}
            </p>
            <div class="qs-type-meta mt-2 inline-flex gap-2 items-center">
              {{ t('purchaseOrderDrawer.changedBy') }}：<QsPersonDisplay :display-name="history.changedBy.displayName" size="sm" />
            </div>
          </li>
        </ul>
      </template>
      <template #amount>
        <FaEmpty v-if="!detail.amountRevisions.length" icon="i-lucide:badge-dollar-sign" :title="t('purchaseOrderList.records.noAmountChanges')" class="py-10" />
        <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
          <li v-for="revision in detail.amountRevisions" :key="revision.id" class="py-4">
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <h3 class="qs-type-section-title m-0">
                {{ t('purchaseOrderDrawer.amountChange') }}
              </h3>
              <DateTimeDisplay :value="revision.changedAt" class="qs-type-meta" />
            </div>
            <div class="mt-3 gap-3 grid md:grid-cols-2">
              <div v-for="amount in revisionAmounts(revision)" :key="amount.label" class="p-3 border border-border rounded-lg bg-muted/15 min-w-0">
                <p class="qs-type-compact-label m-0">
                  {{ t(`purchaseOrderDrawer.amountFields.${amount.label}`) }}
                </p>
                <div class="mt-2 flex flex-wrap gap-2 items-center">
                  <AmountDisplay :value="amount.before" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto" />
                  <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4" aria-hidden="true" />
                  <AmountDisplay :value="amount.after" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto" />
                </div>
              </div>
            </div>
            <p class="text-sm m-0 mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {{ t('purchaseOrderDrawer.reason') }}：{{ revision.reason }}
            </p>
            <div class="qs-type-meta mt-2 inline-flex gap-2 items-center">
              {{ t('purchaseOrderDrawer.changedBy') }}：<QsPersonDisplay :display-name="revision.changedBy.displayName" size="sm" />
            </div>
          </li>
        </ul>
      </template>
    </FaTabs>
  </section>
</template>
