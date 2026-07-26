<script setup lang="ts">
import type { CurrencyCode } from '@/components/base/AmountDisplay/format'
import type {
  MoneyAmount,
  MoneyValidationResult,
} from '@/components/base/MoneyInput/logic'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import {
  MoneyValidationError,
  sumMoneyValues,
  validateMoneyString,
} from '@/components/base/MoneyInput/logic'

interface SettlementLine {
  amount: MoneyAmount
  currency: CurrencyCode
  id: string
  label: string
}

const amount = ref<MoneyAmount>('12846.37')
const lines = reactive<SettlementLine[]>([
  {
    amount: '12846.37',
    currency: 'CNY',
    id: 'transport',
    label: '运输费',
  },
  {
    amount: '428.10',
    currency: 'CNY',
    id: 'service',
    label: '服务费',
  },
  {
    amount: '0.20',
    currency: 'CNY',
    id: 'adjustment',
    label: '调整额',
  },
])

const amountValidation = computed<MoneyValidationResult>(() => validateMoneyString(
  amount.value,
  {
    max: '9999999999999999.99',
    min: '0.00',
    precision: 2,
  },
))
const normalizedAmount = computed(() => (
  amountValidation.value.valid
    ? amountValidation.value.normalizedValue
    : null
))
const summary = computed(() => {
  try {
    return {
      error: '',
      value: sumMoneyValues(
        lines.map(line => line.amount),
        { precision: 2 },
      ),
    }
  }
  catch (error) {
    return {
      error: error instanceof MoneyValidationError
        ? error.message
        : '金额汇总失败',
      value: null,
    }
  }
})
</script>

<template>
  <section aria-labelledby="money-input-title">
    <div class="p-5 border border-border rounded-xl bg-background sm-p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:hand-coins" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">基础输入组件</span>
          </div>
          <h3 id="money-input-title" class="text-xl tracking-tight font-semibold m-0 mt-3 sm-text-2xl">
            精确金额录入
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            输入值始终使用十进制字符串；失焦后补齐两位小数，并直接交给金额显示与 Decimal 列汇总。
          </p>
        </div>
        <FaTag variant="secondary">
          MoneyInput
        </FaTag>
      </div>

      <div class="mt-7 gap-8 grid lg-grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.8fr)]">
        <div class="min-w-0">
          <label for="money-input-primary" class="text-sm font-medium">
            结算金额
          </label>
          <p id="money-input-description" class="text-xs text-muted-foreground m-0 mt-1">
            仅接受无币种符号、无千分位、非科学计数法的严格金额字符串。
          </p>
          <MoneyInput
            id="money-input-primary"
            v-model="amount"
            aria-describedby="money-input-description money-input-feedback"
            class="mt-3"
            currency="CNY"
            max="9999999999999999.99"
            min="0.00"
          />
          <p
            id="money-input-feedback"
            aria-live="polite"
            class="text-xs m-0 mt-2"
            :class="amountValidation.valid ? 'text-muted-foreground' : 'text-destructive'"
          >
            {{ amountValidation.valid
              ? `持久化值：${amountValidation.normalizedValue ?? 'null'}`
              : amountValidation.message }}
          </p>
        </div>

        <aside class="p-5 border border-border rounded-xl bg-muted/20 self-start">
          <p class="text-xs text-primary tracking-[0.16em] font-semibold m-0">
            配对显示
          </p>
          <div class="mt-4 flex gap-3 items-baseline justify-between">
            <span class="text-xs text-muted-foreground">AmountDisplay</span>
            <AmountDisplay
              :value="normalizedAmount"
              currency="CNY"
              class="text-lg"
            />
          </div>
          <dl class="text-xs m-0 mt-5 space-y-3">
            <div class="pb-3 border-b border-border">
              <dt class="text-muted-foreground">
                modelValue
              </dt>
              <dd class="font-mono m-0 mt-1 break-all">
                string | null
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">
                计算内核
              </dt>
              <dd class="font-mono m-0 mt-1">
                decimal.js
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <div class="mt-8 pt-7 border-t border-border">
        <div class="flex flex-wrap gap-3 items-end justify-between">
          <div>
            <h4 class="text-base font-semibold m-0">
              输入到列汇总
            </h4>
            <p class="text-xs text-muted-foreground m-0 mt-1">
              任一行包含非法金额时，汇总明确失败，不会把该行静默当作零。
            </p>
          </div>
          <span class="text-xs text-muted-foreground">当前列 · CNY</span>
        </div>

        <div class="mt-4 border-y border-border divide-border divide-y">
          <div
            v-for="line in lines"
            :key="line.id"
            class="py-4 gap-3 grid items-center sm-grid-cols-[7rem_minmax(0,1fr)_minmax(10rem,auto)]"
          >
            <label :for="`money-line-${line.id}`" class="text-sm font-medium">
              {{ line.label }}
            </label>
            <MoneyInput
              :id="`money-line-${line.id}`"
              v-model="line.amount"
              :currency="line.currency"
            />
            <AmountDisplay
              :value="validateMoneyString(line.amount).valid ? line.amount : null"
              :currency="line.currency"
            />
          </div>
        </div>

        <div class="mt-4 p-4 border border-border rounded-xl bg-muted/20 flex flex-wrap gap-3 items-center justify-between">
          <div>
            <p class="text-xs text-muted-foreground m-0">
              Decimal 精确汇总
            </p>
            <p v-if="summary.error" class="text-xs text-destructive m-0 mt-1">
              {{ summary.error }}
            </p>
          </div>
          <AmountDisplay :value="summary.value" currency="CNY" class="text-xl" />
        </div>
      </div>
    </div>
  </section>
</template>
