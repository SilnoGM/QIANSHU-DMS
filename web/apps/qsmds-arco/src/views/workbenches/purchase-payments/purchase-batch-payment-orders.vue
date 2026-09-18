<script setup lang="ts">
import type { PurchasePayableDto, PurchasePayableOrderDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { sumMoneyValues } from '@/components/base/MoneyInput/logic'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { canPayPurchasePayable } from './purchase-payments.logic'

const props = defineProps<{ orders: PurchasePayableOrderDto[], selected: string[], disabled: boolean }>()
const emit = defineEmits<{ select: [ids: string[]] }>()
const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()
const expanded = ref<string[]>([])
const availableIds = computed(() => props.orders.filter(order => order.items.some(canPayPurchasePayable)).map(order => order.id))
const selectAll = computed(() => {
  const count = availableIds.value.filter(id => props.selected.includes(id)).length
  return count === 0 ? false : count === availableIds.value.length ? true : 'indeterminate'
})
const statusClasses: Record<PurchasePayableDto['status'], string> = {
  PENDING_PAYMENT: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  PAID: 'border-primary/35 bg-primary/10 text-primary dark:text-emerald-300',
  NO_PAYMENT: 'border-border bg-muted text-muted-foreground',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
}
const rows = computed(() => props.orders.map(order => ({
  order,
  remaining: sumMoneyValues(order.items.filter(canPayPurchasePayable).map(item => item.remainingAmount), { precision: 2 }),
  items: [...order.items].sort((left, right) => Number(left.paymentType === 'BALANCE') - Number(right.paymentType === 'BALANCE')),
})))

function select(id: string, checked: boolean | 'indeterminate' | null | undefined) {
  if (props.disabled || !availableIds.value.includes(id)) {
    return
  }
  emit('select', checked === true ? [...new Set([...props.selected, id])] : props.selected.filter(value => value !== id))
}
function toggleAll(checked: boolean | 'indeterminate' | null | undefined) {
  if (!props.disabled) {
    emit('select', checked === true ? [...availableIds.value] : [])
  }
}
function toggleExpanded(id: string) {
  if (!props.disabled) {
    expanded.value = expanded.value.includes(id) ? expanded.value.filter(value => value !== id) : [...expanded.value, id]
  }
}
watch(() => props.orders, () => {
  expanded.value = []
})
</script>

<template>
  <div class="min-w-0 space-y-3">
    <div class="flex flex-wrap gap-3 items-center justify-between">
      <FaCheckbox :model-value="selectAll" :disabled="disabled || !availableIds.length" @update:model-value="toggleAll">
        {{ t('purchasePayment.batch.selectAll') }}
      </FaCheckbox>
      <span class="qs-type-meta text-muted-foreground" aria-live="polite">{{ t('purchasePayment.batch.orderCount', { selected: selected.length, total: orders.length }) }}</span>
    </div>
    <ul class="m-0 p-0 list-none space-y-3">
      <li v-for="row in rows" :key="row.order.id" class="border rounded-lg min-w-0 overflow-hidden" :class="selected.includes(row.order.id) ? 'border-primary/40 bg-primary/5' : 'border-border bg-background'">
        <div class="pl-3 flex min-w-0 items-center">
          <FaCheckbox :model-value="selected.includes(row.order.id)" :disabled="disabled || !availableIds.includes(row.order.id)" @update:model-value="select(row.order.id, $event)">
            <span class="sr-only">{{ t('purchasePayment.batch.selectOrder', { orderNo: row.order.orderNo }) }}</span>
          </FaCheckbox>
          <FaButton type="button" variant="ghost" class="p-3 text-left rounded-none flex flex-1 flex-wrap gap-3 h-auto min-h-18 min-w-0 whitespace-normal justify-between" :disabled="disabled" :aria-expanded="expanded.includes(row.order.id)" :aria-label="t('purchasePayment.batch.toggleOrder', { orderNo: row.order.orderNo })" @click="toggleExpanded(row.order.id)">
            <span class="flex flex-1 flex-basis-40 flex-col gap-1 min-w-0">
              <span class="qs-type-data-emphasis break-all">{{ row.order.orderNo }}</span>
              <span class="qs-type-meta text-muted-foreground font-normal">{{ row.order.orderDate }}</span>
            </span>
            <span class="ml-auto flex gap-3 max-w-full min-w-0 items-center">
              <span class="text-right flex flex-col gap-1 min-w-0">
                <span class="qs-type-meta text-muted-foreground font-normal">{{ t('purchasePayment.batch.unpaidAmount') }}</span>
                <AmountDisplay :value="row.remaining" currency="CNY" :currencies="currencyCatalog.currencies.value" class="max-w-full overflow-x-auto" />
              </span>
              <FaIcon name="i-lucide:chevron-down" class="text-muted-foreground shrink-0 size-4 transition-transform motion-reduce:transition-none" :class="{ 'rotate-180': expanded.includes(row.order.id) }" aria-hidden="true" />
            </span>
          </FaButton>
        </div>
        <FaCollapsible :model-value="expanded.includes(row.order.id)">
          <dl class="m-0 px-4 py-3 border-t border-border/70 bg-background/60 gap-3 grid sm:grid-cols-2">
            <div v-for="item in row.items" :key="item.id" class="min-w-0 space-y-2">
              <dt class="flex flex-wrap gap-2 items-center">
                <span class="qs-type-body-medium">{{ t(`purchasePayment.types.${item.paymentType}`) }}</span>
                <FaTag variant="outline" class="qs-type-status-tag" :class="statusClasses[item.status]">
                  {{ t(`purchasePayment.status.${item.status}`) }}
                </FaTag>
              </dt>
              <dd class="m-0 space-y-1">
                <AmountDisplay :value="item.dueAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" class="max-w-full overflow-x-auto" />
                <span v-if="canPayPurchasePayable(item) && item.paidAmount !== '0.00'" class="qs-type-meta text-muted-foreground flex flex-wrap gap-x-1">
                  {{ t('purchasePayment.batch.unpaidAmount') }}
                  <AmountDisplay :value="item.remainingAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
                </span>
              </dd>
            </div>
          </dl>
        </FaCollapsible>
      </li>
    </ul>
  </div>
</template>
