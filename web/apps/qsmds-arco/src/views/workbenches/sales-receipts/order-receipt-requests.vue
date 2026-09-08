<script setup lang="ts">
import type { SalesReceiptRequestDetailDto } from '@/api/generated/types.gen'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'

defineProps<{ items: SalesReceiptRequestDetailDto[], canSubmit: boolean, total: number, pendingAmount: string, currency: string }>()
const emit = defineEmits<{ resubmit: [request: SalesReceiptRequestDetailDto], pageChange: [] }>()
const page = defineModel<number>('page', { required: true })
const { t } = useI18n()
function changePage(delta: number): void {
  page.value += delta
  emit('pageChange')
}
</script>

<template>
  <section class="mb-6 p-4 border border-border rounded-lg bg-muted/15">
    <h3 class="font-semibold m-0">
      {{ t('salesReceipt.requests') }}
    </h3>
    <p class="text-sm text-muted-foreground">
      {{ t('salesReceipt.pendingAmount') }}: <span class="text-foreground font-mono">{{ pendingAmount }} {{ currency }}</span> · {{ t('salesReceipt.pendingHint') }}
    </p>
    <p v-if="items.length === 0" class="text-muted-foreground">
      {{ t('salesReceipt.empty') }}
    </p>
    <ul v-else class="m-0 p-0 list-none divide-border divide-y">
      <li v-for="item in items" :key="item.id" class="py-3 flex flex-wrap gap-3 items-start justify-between">
        <div class="min-w-0">
          <div class="flex flex-wrap gap-2 items-center">
            <FaTag variant="outline">
              {{ t(`salesReceipt.status.${item.status}`) }}{{ item.approvedPayment?.voidedAt ? ` · ${t('salesReceipt.voided')}` : '' }}
            </FaTag><span class="font-mono">{{ item.amount }} {{ item.currencyCode }}</span>
          </div>
          <p class="text-sm text-muted-foreground my-2">
            <DateTimeDisplay :value="item.submittedAt" /> · {{ item.submittedBy.name }}
          </p>
          <p v-if="item.reviewRemark" class="text-sm break-words">
            {{ t('salesReceipt.reviewRemark') }}: {{ item.reviewRemark }}
          </p>
          <a :href="`/api/sales-orders/${encodeURIComponent(item.salesOrderId)}/receipt-requests/${encodeURIComponent(item.id)}/voucher`" target="_blank" rel="noopener noreferrer" class="text-primary underline">{{ t('salesReceipt.voucher') }}</a>
        </div>
        <FaButton v-if="item.status === 'REJECTED' && canSubmit" variant="outline" class="min-h-11" @click="emit('resubmit', item)">
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
