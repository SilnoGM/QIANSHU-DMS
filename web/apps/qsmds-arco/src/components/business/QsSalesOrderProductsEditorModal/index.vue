<script setup lang="ts">
import type { OrderProductLineLabels, OrderProductLineModel } from '../QsOrderProductLineEditor/types'
import type {
  SalesOrderProductEditFieldErrors,
  SalesOrderProductEditIntent,
  SalesOrderProductEditModalOrder,
  SalesOrderProductsEditorModalProps,
} from './types'

import AmountDisplay from '../../base/AmountDisplay/index.vue'
import { findCurrencyDescriptor } from '../../base/currency'
import QsGenericModal from '../QsGenericModal/index.vue'
import QsOrderProductLineEditor from '../QsOrderProductLineEditor/index.vue'
import { calculateOrderProductLineTotals } from '../QsOrderProductLineEditor/logic'
import {
  buildSalesOrderProductEditIntent,
  calculateAmountDifference,
  calculateSalesOrderProductEditPreview,
  createSalesOrderProductEditLines,
} from './logic'

defineOptions({ name: 'QsSalesOrderProductsEditorModal' })

const props = withDefaults(defineProps<SalesOrderProductsEditorModalProps>(), {
  lines: () => [],
  reason: '客户调整产品',
  loading: false,
  error: null,
  submitting: false,
})

const emit = defineEmits<{
  'cancel': []
  'confirm': [intent: SalesOrderProductEditIntent]
  'retry': []
  'review': [intent: SalesOrderProductEditIntent]
  'validationError': [message: string]
  'update:lines': [lines: readonly OrderProductLineModel[]]
  'update:modelValue': [value: boolean]
  'update:reason': [value: string]
}>()

const fieldErrors = ref<SalesOrderProductEditFieldErrors>({})
const reviewing = ref(false)
const reviewedIntent = shallowRef<SalesOrderProductEditIntent | null>(null)
const formModel = computed(() => ({ lines: props.lines, reason: props.reason }))
const currency = computed(() => props.context?.salesOrder.currencyCode ?? 'TWD')
const precision = computed(() => findCurrencyDescriptor(
  props.currencies,
  currency.value,
)?.minorUnit ?? 2)
const preview = computed(() => props.context === null
  ? null
  : calculateSalesOrderProductEditPreview({
      context: props.context,
      lines: props.lines,
      precision: precision.value,
    }))
const oldStandardTotal = computed(() => props.context === null
  ? null
  : calculateOrderProductLineTotals(
    createSalesOrderProductEditLines(props.context),
    precision.value,
  ).standardTotal)
const minimumQuantityByKey = computed(() => Object.fromEntries(
  (props.context?.existingLines ?? []).flatMap(line => (
    line.activePurchasedQuantity > 0
      ? [[line.id, line.activePurchasedQuantity] as const]
      : []
  )),
))
const removalDisabledByKey = computed(() => Object.fromEntries(
  (props.context?.existingLines ?? []).map(line => [
    line.id,
    line.activePurchasedQuantity > 0,
  ] as const),
))
const nameEditableByKey = computed(() => Object.fromEntries(
  (props.context?.existingLines ?? []).map(line => [line.id, true] as const),
))
const lineConstraintDescriptionByKey = computed(() => Object.fromEntries(
  (props.context?.existingLines ?? []).flatMap(line => (
    line.activePurchasedQuantity > 0
      ? [[
          line.id,
          `存在有效采购单：不可删除或更换产品，数量不能低于已采购数量 ${line.activePurchasedQuantity}`,
        ] as const]
      : []
  )),
))
const maximumEditorLines = computed(() => (
  (props.context?.existingLines.length ?? 0) + (props.context?.availableLineCapacity ?? 0)
))

const labels: OrderProductLineLabels = {
  referenceUnitPrice: '标准售价',
  actualUnitPrice: '本单售价',
  actualSubtotal: '本单售价小计',
  referenceTotal: '标准售价汇总',
  actualTotal: '本单售价汇总',
  catalogProduct: '数据库产品',
  temporaryProduct: '临时产品',
  temporaryProductNo: 'CUSTOM',
}

function fulfillmentStatusLabel(status: SalesOrderProductEditModalOrder['fulfillmentStatus']): string {
  return ({
    PENDING: '待采购',
    PREPARING: '备货中',
    LAND_TRANSIT: '陆运中',
    WAREHOUSE_ARRIVED: '已到仓',
    SEA_TRANSIT: '海运中',
    SIGNED: '已签收',
  } as Readonly<Record<string, string>>)[status] ?? status
}

function paymentStatusLabel(status: SalesOrderProductEditModalOrder['paymentStatus']): string {
  return ({ UNPAID: '未付款', PARTIALLY_PAID: '部分付款', PAID: '已付清' })[status]
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

function buildIntent(): SalesOrderProductEditIntent | null {
  if (props.context === null) {
    return null
  }
  const result = buildSalesOrderProductEditIntent({
    context: props.context,
    lines: props.lines,
    precision: precision.value,
    reason: props.reason,
    // 只有当前可见预览确认需要下调定金时，组件才生成可信确认标记。
    confirmDepositReduction: preview.value?.requiresDepositReduction ?? false,
  })
  if (!result.valid) {
    fieldErrors.value = result.fieldErrors
    emit('validationError', '请先完成并修正当前产品修改的必填资料')
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

function confirmReview(): void {
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
  }
  else {
    closeAsCancel()
  }
}

function amountChange(nextValue: string | null, previousValue: string | null): string | null {
  return calculateAmountDifference(nextValue, previousValue, precision.value)
}

function amountChangeClass(value: string | null): string {
  if (value === null || /^-?0(?:\.0+)?$/u.test(value)) {
    return 'text-muted-foreground'
  }
  return value.startsWith('-') ? 'text-destructive' : 'text-primary'
}

watch(() => props.modelValue, (open) => {
  if (open) {
    clearReview()
    fieldErrors.value = {}
  }
})

watch(() => props.context?.salesOrder.version, () => {
  clearReview()
  fieldErrors.value = {}
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="修改销售订单产品"
    description="当前订单产品统一在下方编辑；已采购行保留采购事实约束。"
    size="xl"
    class="sm:!max-w-[90rem] sm:!w-[calc(100%-3rem)]"
    :loading="loading"
    :error="error"
    :submitting="submitting"
    :dismiss-on-overlay="!submitting"
    :dismiss-on-escape="!submitting"
    @update:model-value="handleVisibility"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:list-restart" class="size-4" aria-hidden="true" />
    </template>

    <template #error-actions>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="emit('retry')">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
        重新加载
      </FaButton>
    </template>

    <div v-if="context" class="space-y-5">
      <section aria-label="销售订单信息" class="p-4 border border-border rounded-lg bg-muted/15">
        <div class="gap-4 grid md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(8rem,1fr))] md:items-center">
          <div class="min-w-0">
            <span class="qs-type-meta text-muted-foreground">销售订单 · v{{ context.salesOrder.version }}</span>
            <strong class="qs-type-data-emphasis font-mono mt-1 block break-all">
              {{ context.salesOrder.orderNo }}
            </strong>
            <span class="qs-type-body-medium mt-1 block truncate">{{ context.salesOrder.customerName }}</span>
          </div>
          <div>
            <span class="qs-type-meta text-muted-foreground block">订单状态</span>
            <FaTag class="mt-1" variant="outline">
              已确认
            </FaTag>
          </div>
          <div>
            <span class="qs-type-meta text-muted-foreground block">履约状态</span>
            <FaTag class="mt-1" variant="outline">
              {{ fulfillmentStatusLabel(context.salesOrder.fulfillmentStatus) }}
            </FaTag>
          </div>
          <div>
            <span class="qs-type-meta text-muted-foreground block">付款状态</span>
            <FaTag class="mt-1" variant="outline">
              {{ paymentStatusLabel(context.salesOrder.paymentStatus) }}
            </FaTag>
          </div>
          <div>
            <span class="qs-type-meta text-muted-foreground block">订单币种</span>
            <strong class="qs-type-data-emphasis font-mono mt-1 block">{{ currency }}</strong>
          </div>
        </div>
      </section>

      <FaForm v-if="!reviewing" :model="formModel" as="div" class="space-y-5">
        <section class="p-4 border border-border rounded-lg min-w-0">
          <div class="text-amber-700 mb-4 flex gap-2 items-start dark:text-amber-300">
            <FaIcon name="i-lucide:shield-alert" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />
            <p class="qs-type-meta leading-5 m-0">
              已采购行可以修改销售快照；不可删除或更换产品，数量不能低于有效已采购数量。未采购行可自由修改或删除。
            </p>
          </div>
          <QsOrderProductLineEditor
            :model-value="lines"
            :currency="currency"
            :currencies="currencies"
            :labels="labels"
            :load-products="loadProducts"
            :maximum-lines="maximumEditorLines"
            :field-errors="fieldErrors"
            :disabled="submitting"
            :minimum-quantity-by-key="minimumQuantityByKey"
            :removal-disabled-by-key="removalDisabledByKey"
            :name-editable-by-key="nameEditableByKey"
            :line-constraint-description-by-key="lineConstraintDescriptionByKey"
            catalog-line-initial-actual-unit-price-amount="0.00"
            temporary-line-initial-actual-unit-price-amount="0.00"
            product-selection-description="可维护当前订单产品；已采购产品的身份和删除操作受锁定。"
            @update:model-value="updateLines"
          />
        </section>

        <section aria-label="价格变化" class="p-4 border border-primary/20 rounded-lg bg-primary/[0.025]">
          <div class="mb-4 flex gap-3 items-end justify-between">
            <div>
              <h3 class="text-base font-semibold m-0">
                价格变化
              </h3>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                金额随产品编辑实时计算，已收款保持不变。
              </p>
            </div>
            <FaTag v-if="preview?.requiresDepositReduction" variant="outline" class="text-amber-700 dark:text-amber-300">
              需确认下调定金
            </FaTag>
          </div>
          <div class="border border-border rounded-lg bg-background overflow-hidden">
            <div class="text-xs text-muted-foreground px-4 py-2 border-b border-border bg-muted/30 gap-3 hidden sm:grid sm:grid-cols-[minmax(7rem,1fr)_minmax(8rem,1fr)_auto_minmax(8rem,1fr)_minmax(7rem,0.8fr)]">
              <span>项目</span><span>修改前</span><span aria-hidden="true">→</span><span>修改后</span><span>变化</span>
            </div>
            <div
              v-for="item in [
                { label: '标准总价', before: oldStandardTotal, after: preview?.standardSubtotalAmount ?? null, delta: preview?.standardAmountDelta ?? null },
                { label: '约定总价', before: context.amounts.agreedTotalAmount, after: preview?.agreedTotalAmount ?? null, delta: preview ? amountChange(preview.agreedTotalAmount, context.amounts.agreedTotalAmount) : null },
                { label: '定金', before: context.amounts.depositDueAmount, after: preview?.depositDueAmount ?? null, delta: preview ? amountChange(preview.depositDueAmount, context.amounts.depositDueAmount) : null },
                { label: '尾款', before: context.amounts.balanceDueAmount, after: preview?.balanceDueAmount ?? null, delta: preview ? amountChange(preview.balanceDueAmount, context.amounts.balanceDueAmount) : null },
                { label: '已收款', before: context.amounts.paidAmount, after: preview?.paidAmount ?? null, delta: preview ? amountChange(preview.paidAmount, context.amounts.paidAmount) : null },
                { label: '待收款', before: context.amounts.outstandingAmount, after: preview?.outstandingAmount ?? null, delta: preview ? amountChange(preview.outstandingAmount, context.amounts.outstandingAmount) : null },
              ]"
              :key="item.label"
              class="px-4 py-3 border-b border-border gap-3 grid grid-cols-2 items-center last:border-b-0 sm:grid-cols-[minmax(7rem,1fr)_minmax(8rem,1fr)_auto_minmax(8rem,1fr)_minmax(7rem,0.8fr)]"
            >
              <strong class="text-sm col-span-2 sm:col-span-1">{{ item.label }}</strong>
              <div class="min-w-0">
                <span class="qs-type-meta text-muted-foreground mb-1 block sm:hidden">修改前</span>
                <AmountDisplay :currencies="currencies" :currency="currency" :value="item.before" />
              </div>
              <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4 hidden sm:block" aria-hidden="true" />
              <div class="min-w-0">
                <span class="qs-type-meta text-muted-foreground mb-1 block sm:hidden">修改后</span>
                <AmountDisplay :currencies="currencies" :currency="currency" :value="item.after" />
              </div>
              <div class="col-span-2 min-w-0 sm:col-span-1">
                <span class="qs-type-meta text-muted-foreground mb-1 block sm:hidden">变化</span>
                <AmountDisplay :currencies="currencies" :currency="currency" :value="item.delta" :class="amountChangeClass(item.delta)" />
              </div>
            </div>
          </div>
          <div class="mt-4">
            <label for="sales-order-product-edit-reason" class="text-sm font-medium block">产品修改原因</label>
            <FaTextarea
              id="sales-order-product-edit-reason"
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
        </section>
      </FaForm>

      <section
        v-else-if="reviewedIntent && preview"
        class="p-5 border rounded-lg"
        :class="preview.requiresDepositReduction
          ? 'border-amber-500/45 bg-amber-500/[0.055]'
          : 'border-primary/25 bg-primary/[0.035]'"
      >
        <div :class="preview.requiresDepositReduction ? 'text-amber-700 dark:text-amber-300' : 'text-primary'" class="flex gap-2 items-center">
          <FaIcon :name="preview.requiresDepositReduction ? 'i-lucide:triangle-alert' : 'i-lucide:badge-check'" class="size-5" aria-hidden="true" />
          <h3 class="text-lg font-semibold m-0">
            {{ preview.requiresDepositReduction ? '确认产品与定金调整' : '二次确认' }}
          </h3>
        </div>
        <p class="text-sm text-muted-foreground leading-6 mb-5 mt-2">
          保存后将同步更新销售快照、金额、付款状态和采购进度，但不会修改产品档案或既有采购快照。
        </p>
        <div class="gap-3 grid sm:grid-cols-4">
          <div
            v-for="item in [
              ['新增产品', preview.addedLineCount],
              ['数量增加', preview.increasedLineCount],
              ['数量减少', preview.decreasedLineCount],
              ['移除产品', preview.removedLineCount],
            ]" :key="item[0]" class="p-3 border border-border/70 rounded-lg bg-background/70"
          >
            <span class="qs-type-meta text-muted-foreground block">{{ item[0] }}</span>
            <strong class="qs-type-data-emphasis mt-1 block">{{ item[1] }} 行</strong>
          </div>
        </div>
        <dl class="m-0 mt-5 gap-x-4 gap-y-3 grid grid-cols-[7rem_minmax(0,1fr)]">
          <dt class="text-sm text-muted-foreground">
            原总价
          </dt>
          <dd class="m-0">
            <AmountDisplay :currencies="currencies" :currency="currency" :value="context.amounts.agreedTotalAmount" />
          </dd>
          <dt class="text-sm text-muted-foreground">
            新总价
          </dt>
          <dd class="m-0">
            <AmountDisplay :currencies="currencies" :currency="currency" :value="preview.agreedTotalAmount" />
          </dd>
          <dt class="text-sm text-muted-foreground">
            金额变化
          </dt>
          <dd class="m-0">
            <AmountDisplay :currencies="currencies" :currency="currency" :value="preview.amountDelta" :class="amountChangeClass(preview.amountDelta)" />
          </dd>
          <template v-if="preview.requiresDepositReduction">
            <dt class="text-sm text-amber-700 font-semibold dark:text-amber-300">
              原定金
            </dt>
            <dd class="m-0">
              <AmountDisplay :currencies="currencies" :currency="currency" :value="context.amounts.depositDueAmount" />
            </dd>
            <dt class="text-sm text-amber-700 font-semibold dark:text-amber-300">
              新定金
            </dt>
            <dd class="m-0">
              <AmountDisplay :currencies="currencies" :currency="currency" :value="preview.depositDueAmount" />
            </dd>
            <dt class="text-sm text-amber-700 font-semibold dark:text-amber-300">
              定金减少
            </dt>
            <dd class="m-0">
              <AmountDisplay :currencies="currencies" :currency="currency" :value="preview.depositReductionAmount" />
            </dd>
          </template>
          <dt class="text-sm text-muted-foreground">
            履约状态
          </dt>
          <dd class="text-sm m-0">
            {{ fulfillmentStatusLabel(context.salesOrder.fulfillmentStatus) }} → {{ fulfillmentStatusLabel(preview.expectedFulfillmentStatus) }}
          </dd>
          <dt class="text-sm text-muted-foreground">
            修改原因
          </dt>
          <dd class="text-sm m-0 break-words">
            {{ reviewedIntent.reason }}
          </dd>
        </dl>
      </section>
    </div>

    <template #footer>
      <div class="flex flex-col gap-2 w-full sm:flex-row sm:items-center sm:justify-end">
        <FaButton v-if="reviewing" type="button" variant="outline" :disabled="submitting" @click="clearReview">
          返回修改
        </FaButton>
        <FaButton v-else type="button" variant="outline" class="min-h-11 sm:min-h-9" :disabled="submitting" @click="closeAsCancel">
          取消
        </FaButton>
        <FaButton
          v-if="!reviewing"
          type="button"
          class="min-h-11 sm:min-h-9"
          :disabled="submitting || loading || context === null || Boolean(error)"
          @click="requestReview"
        >
          检查并确认修改
        </FaButton>
        <FaButton v-else type="button" :loading="submitting" :disabled="submitting" @click="confirmReview">
          {{ preview?.requiresDepositReduction ? '确认调整定金并保存' : '确认保存' }}
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
