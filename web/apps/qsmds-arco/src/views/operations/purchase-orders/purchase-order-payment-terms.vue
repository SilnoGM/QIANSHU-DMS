<script setup lang="ts">
import type { CurrencyDescriptor } from '@/components/base/currency'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'

defineOptions({ name: 'PurchaseOrderPaymentTerms' })

defineProps<{
  balanceDueAmount: string | null
  currencies: readonly CurrencyDescriptor[]
  depositDueAmount: string | null
  disabled: boolean
  fieldErrors: Readonly<Record<string, string>>
  purchaseTotalAmount: string | null
}>()

const emit = defineEmits<{
  'update:balanceDueAmount': [value: string | null]
  'update:depositDueAmount': [value: string | null]
}>()
</script>

<template>
  <FaCard
    title="付款约定"
    description="采购总价由明细计算，并且必须等于定金与尾款之和。"
  >
    <dl class="m-0 gap-4 grid">
      <div class="p-4 border border-border rounded-xl bg-primary/5 flex items-center justify-between">
        <dt class="text-sm text-muted-foreground">
          采购总价
        </dt>
        <dd class="font-bold m-0 overflow-x-auto">
          <AmountDisplay :value="purchaseTotalAmount" currency="CNY" :currencies="currencies" />
        </dd>
      </div>
      <div>
        <dt class="text-sm font-medium mb-2">
          定金
        </dt>
        <dd class="m-0">
          <MoneyInput
            :model-value="depositDueAmount"
            aria-label="定金"
            currency="CNY"
            :currencies="currencies"
            :currency-selectable="false"
            min="0"
            :disabled="disabled"
            @update:model-value="emit('update:depositDueAmount', $event)"
          />
          <p v-if="fieldErrors.depositDueAmount" class="text-xs text-destructive m-0 mt-1" role="alert">
            {{ fieldErrors.depositDueAmount }}
          </p>
        </dd>
      </div>
      <div>
        <dt class="text-sm font-medium mb-2">
          尾款
        </dt>
        <dd class="m-0">
          <MoneyInput
            :model-value="balanceDueAmount"
            aria-label="尾款"
            currency="CNY"
            :currencies="currencies"
            :currency-selectable="false"
            min="0"
            :disabled="disabled"
            @update:model-value="emit('update:balanceDueAmount', $event)"
          />
          <p v-if="fieldErrors.balanceDueAmount" class="text-xs text-destructive m-0 mt-1" role="alert">
            {{ fieldErrors.balanceDueAmount }}
          </p>
        </dd>
      </div>
    </dl>
  </FaCard>
</template>
