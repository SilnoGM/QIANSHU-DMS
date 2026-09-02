<script setup lang="ts">
import type { OrderProductLineLabels, OrderProductLineModel } from '../QsOrderProductLineEditor/types'
import type {
  SalesOrderAddOnFieldErrors,
  SalesOrderAddOnIntent,
  SalesOrderAddOnModalOrder,
  SalesOrderAddOnProductsModalProps,
} from './types'

import AmountDisplay from '../../base/AmountDisplay/index.vue'
import { findCurrencyDescriptor } from '../../base/currency'
import QsGenericModal from '../QsGenericModal/index.vue'
import QsOrderProductLineEditor from '../QsOrderProductLineEditor/index.vue'
import {
  buildSalesOrderAddOnIntent,
  calculateSalesOrderAddOnPreview,
} from './logic'

defineOptions({ name: 'QsSalesOrderAddOnProductsModal' })

const props = withDefaults(defineProps<SalesOrderAddOnProductsModalProps>(), {
  lines: () => [],
  reason: '客户加购产品',
  loading: false,
  error: null,
  submitting: false,
})

const emit = defineEmits<{
  'cancel': []
  'confirm': [intent: SalesOrderAddOnIntent]
  'retry': []
  'review': [intent: SalesOrderAddOnIntent]
  'update:lines': [lines: readonly OrderProductLineModel[]]
  'update:modelValue': [value: boolean]
  'update:reason': [value: string]
}>()

const fieldErrors = ref<SalesOrderAddOnFieldErrors>({})
const reviewing = ref(false)
const reviewedIntent = shallowRef<SalesOrderAddOnIntent | null>(null)
const formModel = computed(() => ({ lines: props.lines }))
const currency = computed(() => props.context?.salesOrder.currencyCode ?? 'TWD')
const precision = computed(() => findCurrencyDescriptor(
  props.currencies,
  currency.value,
)?.minorUnit ?? 2)
const preview = computed(() => props.context === null
  ? null
  : calculateSalesOrderAddOnPreview(props.context, props.lines, precision.value))

const labels: OrderProductLineLabels = {
  referenceUnitPrice: '标准售价',
  actualUnitPrice: '本单售价',
  actualSubtotal: '本单售价小计',
  referenceTotal: '标准售价汇总',
  actualTotal: '新增产品小计',
  catalogProduct: '数据库产品',
  temporaryProduct: '临时产品',
  temporaryProductNo: 'CUSTOM',
}

function fulfillmentStatusLabel(status: SalesOrderAddOnModalOrder['fulfillmentStatus']): string {
  return ({
    PENDING: '待采购',
    PREPARING: '备货中',
    LAND_TRANSIT: '陆运中',
    WAREHOUSE_ARRIVED: '已到仓',
    SEA_TRANSIT: '海运中',
    SIGNED: '已签收',
  } as Readonly<Record<string, string>>)[status] ?? status
}

function paymentStatusLabel(status: string): string {
  return ({
    UNPAID: '未付款',
    PARTIALLY_PAID: '部分付款',
    PAID: '已付清',
  } as Readonly<Record<string, string>>)[status] ?? status
}

function clearReview(): void {
  reviewing.value = false
  reviewedIntent.value = null
}

function updateLines(lines: readonly OrderProductLineModel[]): void {
  clearReview()
  fieldErrors.value = {}
  emit('update:lines', lines.map(line => ({ ...line })))
}

function updateReason(value: string | undefined): void {
  clearReview()
  fieldErrors.value = {}
  emit('update:reason', value ?? '')
}

function buildIntent(): SalesOrderAddOnIntent | null {
  if (props.context === null) {
    return null
  }
  const result = buildSalesOrderAddOnIntent({
    context: props.context,
    lines: props.lines,
    precision: precision.value,
    reason: props.reason,
  })
  if (!result.valid) {
    fieldErrors.value = result.fieldErrors
    return null
  }
  fieldErrors.value = {}
  return result.intent
}

function requestReview(): void {
  if (props.submitting) {
    return
  }
  const intent = buildIntent()
  if (intent === null) {
    return
  }
  reviewedIntent.value = intent
  reviewing.value = true
  emit('review', intent)
}

function confirmAddOn(): void {
  if (props.submitting) {
    return
  }
  const intent = buildIntent()
  if (intent === null) {
    clearReview()
    return
  }
  reviewedIntent.value = intent
  emit('confirm', intent)
}

function closeAsCancel(): void {
  if (props.submitting) {
    return
  }
  clearReview()
  fieldErrors.value = {}
  emit('cancel')
  emit('update:modelValue', false)
}

function handleVisibility(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
    return
  }
  closeAsCancel()
}

watch(() => props.modelValue, (open) => {
  if (open) {
    clearReview()
    fieldErrors.value = {}
  }
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="销售订单加购产品"
    description="只追加新的销售产品；原销售产品和既有收款不会被修改。"
    size="xl"
    class="sm:!max-w-[112rem] sm:!w-[calc(100%-3rem)]"
    :loading="loading"
    :error="error"
    :submitting="submitting"
    :dismiss-on-overlay="!submitting"
    :dismiss-on-escape="!submitting"
    @update:model-value="handleVisibility"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:package-plus" class="size-4" aria-hidden="true" />
    </template>

    <template #error-actions>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="emit('retry')">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
        重新加载
      </FaButton>
    </template>

    <div
      v-if="context"
      class="gap-5 grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start"
    >
      <aside class="min-w-0 space-y-4">
        <section class="p-4 border border-border rounded-xl bg-muted/15">
          <div class="flex gap-3 items-start justify-between">
            <div class="min-w-0">
              <span class="qs-type-meta text-muted-foreground">销售订单</span>
              <strong class="qs-type-data-emphasis font-mono mt-1 block break-all">
                {{ context.salesOrder.orderNo }}
              </strong>
              <span class="qs-type-body-medium mt-2 block truncate">{{ context.salesOrder.customerName }}</span>
            </div>
            <div class="flex flex-col gap-1.5 items-end">
              <FaTag variant="outline">
                {{ fulfillmentStatusLabel(context.salesOrder.fulfillmentStatus) }}
              </FaTag>
              <FaTag variant="outline">
                {{ paymentStatusLabel(context.salesOrder.paymentStatus) }}
              </FaTag>
            </div>
          </div>
        </section>

        <section class="p-4 border border-border rounded-xl">
          <div class="mb-3 flex gap-3 items-center justify-between">
            <h3 class="text-sm font-semibold m-0">
              原销售产品
            </h3>
            <span class="qs-type-meta text-muted-foreground">{{ context.existingLines.length }} 项</span>
          </div>
          <div class="max-h-56 overflow-y-auto space-y-2">
            <article
              v-for="line in context.existingLines"
              :key="line.id"
              class="p-3 border border-border/70 rounded-lg bg-muted/20"
            >
              <div class="flex gap-2 min-w-0 items-baseline">
                <span class="qs-type-meta text-muted-foreground shrink-0">
                  {{ line.productNo ?? 'CUSTOM' }}
                </span>
                <strong class="qs-type-body-medium truncate">{{ line.productName }}</strong>
              </div>
              <div class="qs-type-meta text-muted-foreground mt-2 flex gap-2 justify-between">
                <span>× {{ line.quantity }}</span>
                <AmountDisplay :currencies="currencies" :currency="currency" :value="line.lineTotalAmount" />
              </div>
            </article>
          </div>
        </section>

        <section class="p-4 border border-border rounded-xl">
          <h3 class="text-sm font-semibold m-0 mb-3">
            原金额摘要
          </h3>
          <dl class="m-0 gap-x-3 gap-y-2 grid grid-cols-[1fr_auto]">
            <dt class="qs-type-meta text-muted-foreground">
              原约定总价
            </dt>
            <dd class="m-0">
              <AmountDisplay :currencies="currencies" :currency="currency" :value="context.amounts.agreedTotalAmount" />
            </dd>
            <dt class="qs-type-meta text-muted-foreground">
              定金
            </dt>
            <dd class="m-0">
              <AmountDisplay :currencies="currencies" :currency="currency" :value="context.amounts.depositDueAmount" />
            </dd>
            <dt class="qs-type-meta text-muted-foreground">
              尾款
            </dt>
            <dd class="m-0">
              <AmountDisplay :currencies="currencies" :currency="currency" :value="context.amounts.balanceDueAmount" />
            </dd>
          </dl>
        </section>
      </aside>

      <section class="min-w-0">
        <div v-if="reviewing && reviewedIntent && preview" class="p-5 border border-primary/25 rounded-xl bg-primary/[0.035]">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:badge-check" class="size-5" aria-hidden="true" />
            <h3 class="text-lg font-semibold m-0">
              二次确认
            </h3>
          </div>
          <p class="text-sm text-muted-foreground leading-6 mb-5 mt-2">
            请再次核对新增产品和金额变化。确认后将修改销售订单，再同步新增产品到采购单。
          </p>
          <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-[7rem_minmax(0,1fr)]">
            <dt class="text-sm text-muted-foreground">
              销售订单号
            </dt>
            <dd class="text-sm font-mono font-semibold m-0 break-all">
              {{ context.salesOrder.orderNo }}
            </dd>
            <dt class="text-sm text-muted-foreground">
              新增产品数
            </dt>
            <dd class="text-sm font-semibold m-0">
              {{ reviewedIntent.lines.length }} 项
            </dd>
            <dt class="text-sm text-muted-foreground">
              金额增量
            </dt>
            <dd class="m-0">
              <AmountDisplay :currencies="currencies" :currency="currency" :value="preview.amountDelta" />
            </dd>
            <dt class="text-sm text-muted-foreground">
              新约定总价
            </dt>
            <dd class="m-0">
              <AmountDisplay :currencies="currencies" :currency="currency" :value="preview.agreedTotalAmount" />
            </dd>
            <dt class="text-sm text-muted-foreground">
              加购原因
            </dt>
            <dd class="text-sm m-0 break-words">
              {{ reviewedIntent.reason }}
            </dd>
          </dl>
          <div class="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <FaButton type="button" variant="outline" :disabled="submitting" @click="clearReview">
              返回修改
            </FaButton>
            <FaButton type="button" :loading="submitting" :disabled="submitting" @click="confirmAddOn">
              确认加购
            </FaButton>
          </div>
        </div>

        <FaForm v-else :model="formModel" as="div">
          <QsOrderProductLineEditor
            :model-value="lines"
            :currency="currency"
            :currencies="currencies"
            :labels="labels"
            :load-products="loadProducts"
            :maximum-lines="context.availableLineCapacity"
            :fixed-product-supplier-value="supplierValue"
            :field-errors="fieldErrors"
            :disabled="submitting"
            catalog-line-initial-actual-unit-price-amount="0.00"
            temporary-line-initial-actual-unit-price-amount="0.00"
            product-selection-description="可再次选择历史同款产品；本次会新增独立销售明细。"
            @update:model-value="updateLines"
          />

          <div class="mt-5">
            <label for="sales-order-add-on-reason" class="text-sm font-medium block">加购原因</label>
            <FaTextarea
              id="sales-order-add-on-reason"
              :model-value="reason"
              maxlength="500"
              input-class="min-h-20"
              class="mt-2 w-full"
              :disabled="submitting"
              @update:model-value="updateReason"
            />
            <p v-if="fieldErrors.reason" class="text-sm text-destructive m-0 mt-1.5" role="alert">
              {{ fieldErrors.reason }}
            </p>
          </div>

          <section v-if="preview" class="mt-5 p-4 border border-primary/20 rounded-xl bg-primary/[0.025]">
            <div class="gap-3 grid sm:grid-cols-3">
              <div>
                <span class="qs-type-meta text-muted-foreground block">新增产品小计</span>
                <AmountDisplay class="mt-1" :currencies="currencies" :currency="currency" :value="preview.amountDelta" />
              </div>
              <div>
                <span class="qs-type-meta text-muted-foreground block">新约定总价</span>
                <AmountDisplay class="mt-1" :currencies="currencies" :currency="currency" :value="preview.agreedTotalAmount" />
              </div>
              <div>
                <span class="qs-type-meta text-muted-foreground block">新尾款</span>
                <AmountDisplay class="mt-1" :currencies="currencies" :currency="currency" :value="preview.balanceDueAmount" />
              </div>
            </div>
            <p class="qs-type-meta text-muted-foreground m-0 mt-3">
              定金保持不变。
            </p>
          </section>
        </FaForm>
      </section>
    </div>

    <template #footer>
      <div class="flex flex-col gap-2 w-full sm:flex-row sm:items-center sm:justify-end">
        <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" :disabled="submitting" @click="closeAsCancel">
          取消
        </FaButton>
        <FaButton
          v-if="!reviewing"
          type="button"
          class="min-h-11 sm:min-h-9"
          :disabled="submitting || loading || context === null || Boolean(error)"
          @click="requestReview"
        >
          检查并确认加购
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
