<script setup lang="ts">
import type { PurchaseOrderListItemDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'

const props = defineProps<{
  kind: 'payments' | 'documents' | 'changes'
  order: Pick<PurchaseOrderListItemDto, 'currencyCode' | 'paymentRecordSummary' | 'documentSummary' | 'changeSummary'>
  currencies: readonly CurrencyDescriptor[]
}>()
const { t } = useI18n()
// 已付金额与分类金额均由服务端同一快照返回；单元格仅筛除零笔数项，不再累计或请求详情。
const paymentRows = computed(() => props.order.paymentRecordSummary.byType.filter(item => item.count > 0))
const documentRows = computed(() => props.order.documentSummary.byType.filter(item => item.count > 0))
const changeCount = computed(() => props.order.changeSummary.statusCount + props.order.changeSummary.amountCount)
const latest = computed(() => props.order.changeSummary.latest)
</script>

<template>
  <template v-if="kind === 'payments'">
    <QsTableStackedCell v-if="paymentRows.length">
      <QsTableStackedLine v-for="item in paymentRows" :key="item.paymentType" :label="t(`purchaseOrderDrawer.paymentTypes.${item.paymentType}`)" content-class="ml-auto flex justify-end text-right" nowrap>
        <FaTooltip :text="t('purchaseOrderList.records.paymentCount', { count: item.count })">
          <span tabindex="0"><AmountDisplay :value="item.amount" :currency="order.currencyCode" :currencies="currencies" /></span>
        </FaTooltip>
      </QsTableStackedLine>
    </QsTableStackedCell>
    <span v-else class="text-muted-foreground">—</span>
  </template>
  <template v-else-if="kind === 'documents'">
    <QsTableStackedCell v-if="documentRows.length">
      <QsTableStackedLine v-for="item in documentRows" :key="item.documentType" :label="t(`purchaseOrderDrawer.documentTypes.${item.documentType}`)" content-class="ml-auto tabular-nums" nowrap>
        {{ t('purchaseOrderList.records.documentCount', { count: item.count }) }}
      </QsTableStackedLine>
    </QsTableStackedCell>
    <span v-else class="text-muted-foreground">—</span>
  </template>
  <QsTableStackedCell v-else-if="changeCount > 0">
    <QsTableStackedLine nowrap>
      <FaTooltip :text="t('purchaseOrderList.records.changeBreakdown', { status: order.changeSummary.statusCount, amount: order.changeSummary.amountCount })">
        <span tabindex="0" class="tabular-nums">{{ t('purchaseOrderList.records.changeCount', { count: changeCount }) }}</span>
      </FaTooltip>
    </QsTableStackedLine>
    <template v-if="latest">
      <QsTableStackedLine tone="muted" nowrap>
        <FaTooltip :text="latest.reason?.trim() || t('purchaseOrderDrawer.reasonNotRecorded')">
          <span tabindex="0" class="qs-type-meta">{{ t(`purchaseOrderList.records.changeKinds.${latest.kind}`) }}</span>
        </FaTooltip>
      </QsTableStackedLine>
      <QsTableStackedLine tone="muted" content-class="qs-type-meta" nowrap>
        <DateTimeDisplay :value="latest.changedAt" />
      </QsTableStackedLine>
    </template>
  </QsTableStackedCell>
  <span v-else class="text-muted-foreground">—</span>
</template>
