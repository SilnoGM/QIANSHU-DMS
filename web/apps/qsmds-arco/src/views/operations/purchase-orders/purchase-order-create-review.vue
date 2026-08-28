<script setup lang="ts">
import type { PurchaseOrderSourceSalesOrderListItemDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { OrderProductLineModel } from '@/components/business/QsOrderProductLineEditor/types'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'

defineOptions({ name: 'PurchaseOrderCreateReview' })

defineProps<{
  balanceDueAmount: string | null
  currencies: readonly CurrencyDescriptor[]
  depositDueAmount: string | null
  lines: readonly OrderProductLineModel[]
  orderDate: string
  purchaseTotalAmount: string | null
  remark: string
  salesOrder: PurchaseOrderSourceSalesOrderListItemDto | null
  shippingMarkText: string
  supplierLabel: string
}>()

function optionalText(value: string): string {
  return value.trim() || '—'
}

function lineTotal(line: OrderProductLineModel): string | null {
  if (line.actualUnitPriceAmount === null || line.actualUnitPriceAmount.trim() === '') {
    return null
  }
  const price = Number(line.actualUnitPriceAmount)
  const quantity = Number(line.quantity)
  return Number.isFinite(price) && Number.isSafeInteger(quantity) && quantity > 0
    ? (price * quantity).toFixed(2)
    : null
}
</script>

<template>
  <article class="purchase-order-review-card p-4 border border-border rounded-xl bg-background min-w-0 sm:p-6">
    <section aria-labelledby="purchase-create-review-summary" class="p-4 border border-border rounded-xl bg-muted/15">
      <h3 id="purchase-create-review-summary" class="qs-type-section-title m-0">
        订单概览
      </h3>
      <dl class="text-sm m-0 mt-4 gap-x-5 gap-y-3 grid grid-cols-1 sm:grid-cols-2">
        <div>
          <dt class="text-muted-foreground">
            采购订单号
          </dt>
          <dd class="font-mono m-0 mt-1">
            PURCHASE_ORDER · AUTO
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            采购日期
          </dt>
          <dd class="font-mono m-0 mt-1">
            {{ orderDate }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            供应商
          </dt>
          <dd class="font-medium m-0 mt-1 break-words">
            {{ supplierLabel }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            销售订单 / 客户
          </dt>
          <dd class="m-0 mt-1 break-words">
            {{ salesOrder ? `${salesOrder.orderNo} · ${salesOrder.customerName}` : '尚未关联' }}
          </dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="purchase-create-review-amount" class="mt-6">
      <h3 id="purchase-create-review-amount" class="qs-type-section-title m-0 mb-3">
        采购金额
      </h3>
      <dl class="m-0 gap-3 grid grid-cols-1 sm:grid-cols-3">
        <div
          v-for="item in [
            { label: '采购总价', value: purchaseTotalAmount },
            { label: '定金', value: depositDueAmount },
            { label: '尾款', value: balanceDueAmount },
          ]"
          :key="item.label"
          class="p-3 border border-border rounded-lg min-w-0"
        >
          <dt class="qs-type-compact-label">
            {{ item.label }}
          </dt>
          <dd class="font-semibold m-0 mt-2 overflow-x-auto">
            <AmountDisplay :value="item.value" currency="CNY" :currencies="currencies" />
          </dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="purchase-create-review-lines" class="mt-6 min-w-0">
      <div class="mb-3 flex gap-3 items-center justify-between">
        <h3 id="purchase-create-review-lines" class="qs-type-section-title m-0">
          采购产品明细
        </h3>
        <span class="qs-type-meta">{{ lines.length }} 项</span>
      </div>
      <FaEmpty
        v-if="lines.length === 0"
        title="尚未同步采购产品"
        description="完成销售订单关联后，在第二步同步产品明细。"
        class="py-8"
      />
      <div v-else class="border border-border rounded-xl overflow-x-auto">
        <table class="text-sm min-w-[58rem] w-full border-collapse">
          <thead class="bg-muted/45">
            <tr class="text-left border-b border-border">
              <th class="p-3">
                #
              </th>
              <th class="p-3">
                产品编号
              </th>
              <th class="p-3">
                产品名称
              </th>
              <th class="p-3 text-right">
                采购定价
              </th>
              <th class="p-3 text-right">
                本单采购价
              </th>
              <th class="p-3 text-right">
                数量
              </th>
              <th class="p-3 text-right">
                小计
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, index) in lines" :key="line.key" class="border-b border-border last:border-0">
              <td class="p-3 tabular-nums">
                {{ index + 1 }}
              </td>
              <td class="font-mono p-3">
                {{ line.productNo ?? 'CUSTOM' }}
              </td>
              <td class="p-3 max-w-64 break-words">
                {{ optionalText(line.name) }}
              </td>
              <td class="p-3 text-right">
                <AmountDisplay :value="line.standardUnitPriceAmount" currency="CNY" :currencies="currencies" />
              </td>
              <td class="p-3 text-right">
                <AmountDisplay :value="line.actualUnitPriceAmount" currency="CNY" :currencies="currencies" />
              </td>
              <td class="p-3 text-right tabular-nums">
                {{ line.quantity || '—' }}
              </td>
              <td class="p-3 text-right">
                <AmountDisplay :value="lineTotal(line)" currency="CNY" :currencies="currencies" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby="purchase-create-review-mark" class="mt-6 gap-3 grid sm:grid-cols-2">
      <div class="p-4 border border-border rounded-xl">
        <h3 id="purchase-create-review-mark" class="qs-type-section-title m-0">
          采购唛头
        </h3>
        <p class="text-sm leading-6 m-0 mt-3 whitespace-pre-wrap break-words">
          {{ optionalText(shippingMarkText) }}
        </p>
      </div>
      <div class="p-4 border border-border rounded-xl">
        <h3 class="qs-type-section-title m-0">
          采购备注
        </h3>
        <p class="text-sm leading-6 m-0 mt-3 whitespace-pre-wrap break-words">
          {{ optionalText(remark) }}
        </p>
      </div>
    </section>
  </article>
</template>

<style scoped>
.purchase-order-review-card {
  box-shadow: 0 20px 45px -32px color-mix(in srgb, var(--border) 78%, transparent);
}
</style>
