<script setup lang="ts">
import type { SalesReceiptRequestDetailDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import ReceiptVoucher from './receipt-voucher.vue'

const props = defineProps<{ items: SalesReceiptRequestDetailDto[], currencies: readonly CurrencyDescriptor[], canSubmit: boolean, total: number, focusedId: string | null }>()
const emit = defineEmits<{ resubmit: [request: SalesReceiptRequestDetailDto], pageChange: [], showPayment: [paymentId: string] }>()
const page = defineModel<number>('page', { required: true })
const { t } = useI18n()
const recordsRef = ref<HTMLElement | null>(null)
watch(() => [props.focusedId, props.items] as const, async () => {
  await nextTick()
  const element = [...(recordsRef.value?.querySelectorAll<HTMLElement>('[data-request-id]') ?? [])].find(item => item.dataset.requestId === props.focusedId)
  element?.scrollIntoView({ block: 'nearest' })
  element?.focus({ preventScroll: true })
}, { immediate: true })
function statusClass(item: SalesReceiptRequestDetailDto): string {
  if (item.status === 'REJECTED' || item.approvedPayment?.voidedAt) {
    return 'border-destructive/30 bg-destructive/10 text-destructive'
  }
  return item.status === 'APPROVED'
    ? 'border-primary/30 bg-primary/10 text-primary'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
}
function changePage(delta: number): void {
  page.value += delta
  emit('pageChange')
}
</script>

<template>
  <section ref="recordsRef" aria-label="收款申请记录">
    <FaEmpty v-if="items.length === 0" icon="i-lucide:clipboard-list" :title="t('salesReceipt.empty')" description="当前筛选下暂无收款申请。" class="py-10" />
    <ul v-else class="m-0 p-0 list-none divide-border divide-y">
      <li v-for="item in items" :key="item.id" :data-request-id="item.id" tabindex="-1" :class="focusedId === item.id ? 'ring-2 ring-primary/30' : ''" class="px-3 py-4 rounded-lg flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0 space-y-3">
          <p class="qs-type-data-emphasis m-0 break-all">
            {{ item.collectionNo || t('salesReceipt.unnumbered') }}
          </p>
          <div class="flex flex-wrap gap-2 items-center">
            <FaTag variant="outline" :class="statusClass(item)">
              {{ t(`salesReceipt.status.${item.status}`) }}{{ item.approvedPayment?.voidedAt ? ` · ${t('salesReceipt.voided')}` : '' }}
            </FaTag>
            <AmountDisplay :value="item.amount" :currency="item.currencyCode" :currencies="currencies" class="font-semibold" />
          </div>
          <div class="qs-type-meta flex flex-col gap-1 items-start">
            <QsPersonDisplay :display-name="item.submittedBy.name" size="sm" :avatar-url="item.submittedBy.avatarUrl" />
            <span class="text-muted-foreground"><DateTimeDisplay :value="item.submittedAt" /></span>
          </div>
          <p v-if="item.reviewRemark" class="text-sm m-0 break-words">
            {{ t('salesReceipt.reviewRemark') }}: {{ item.reviewRemark }}
          </p>
          <ReceiptVoucher :voucher="item.voucher" :url="`/api/sales-orders/${encodeURIComponent(item.salesOrderId)}/receipt-requests/${encodeURIComponent(item.id)}/voucher`" />
        </div>
        <FaButton v-if="item.approvedPayment" variant="outline" size="sm" @click="emit('showPayment', item.approvedPayment.id)">
          查看对应收款
        </FaButton>
        <FaButton v-if="item.status === 'REJECTED' && canSubmit" variant="outline" size="sm" @click="emit('resubmit', item)">
          {{ t('salesReceipt.resubmit') }}
        </FaButton>
      </li>
    </ul>
    <div v-if="total > 20" class="mt-3 flex flex-wrap gap-3 items-center">
      <FaButton variant="outline" :disabled="page <= 1" @click="changePage(-1)">
        {{ t('salesReceipt.previous') }}
      </FaButton>
      <span>{{ page }} / {{ Math.ceil(total / 20) }}</span>
      <FaButton variant="outline" :disabled="page * 20 >= total" @click="changePage(1)">
        {{ t('salesReceipt.next') }}
      </FaButton>
    </div>
  </section>
</template>
