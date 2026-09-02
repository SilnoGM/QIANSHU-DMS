<script setup lang="ts">
import type { OrderProductLineLabels, OrderProductLineModel } from '../QsOrderProductLineEditor/types'
import type {
  ExistingSalesOrderLineDraft,
  SalesOrderProductEditFieldErrors,
  SalesOrderProductEditIntent,
  SalesOrderProductEditModalOrder,
  SalesOrderProductsEditorModalProps,
} from './types'

import AmountDisplay from '../../base/AmountDisplay/index.vue'
import { findCurrencyDescriptor } from '../../base/currency'
import QsGenericModal from '../QsGenericModal/index.vue'
import QsOrderProductLineEditor from '../QsOrderProductLineEditor/index.vue'
import {
  buildSalesOrderProductEditIntent,
  calculateSalesOrderProductEditPreview,
} from './logic'

defineOptions({ name: 'QsSalesOrderProductsEditorModal' })

const props = withDefaults(defineProps<SalesOrderProductsEditorModalProps>(), {
  existingLineDrafts: () => [],
  newLines: () => [],
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
  'update:existingLineDrafts': [drafts: readonly ExistingSalesOrderLineDraft[]]
  'update:modelValue': [value: boolean]
  'update:newLines': [lines: readonly OrderProductLineModel[]]
  'update:reason': [value: string]
}>()

const fieldErrors = ref<SalesOrderProductEditFieldErrors>({})
const reviewing = ref(false)
const reviewedIntent = shallowRef<SalesOrderProductEditIntent | null>(null)
const formModel = computed(() => ({
  existingLines: props.existingLineDrafts,
  newLines: props.newLines,
}))
const currency = computed(() => props.context?.salesOrder.currencyCode ?? 'TWD')
const precision = computed(() => findCurrencyDescriptor(
  props.currencies,
  currency.value,
)?.minorUnit ?? 2)
const preview = computed(() => props.context === null
  ? null
  : calculateSalesOrderProductEditPreview({
      context: props.context,
      existingLineDrafts: props.existingLineDrafts,
      newLines: props.newLines,
      precision: precision.value,
    }))
const removedExistingLineCount = computed(() => props.existingLineDrafts.filter(
  draft => draft.desiredQuantity === '0',
).length)
const maximumNewLines = computed(() => (
  (props.context?.availableLineCapacity ?? 0) + removedExistingLineCount.value
))

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

function draftFor(lineId: string): ExistingSalesOrderLineDraft | undefined {
  return props.existingLineDrafts.find(draft => draft.lineId === lineId)
}

function updateExistingQuantity(lineId: string, value: string | number | undefined): void {
  clearReview()
  fieldErrors.value = {}
  emit('update:existingLineDrafts', props.existingLineDrafts.map(draft => (
    draft.lineId === lineId
      ? { ...draft, desiredQuantity: String(value ?? '') }
      : { ...draft }
  )))
}

function removeExistingLine(lineId: string): void {
  updateExistingQuantity(lineId, '0')
}

function updateNewLines(lines: readonly OrderProductLineModel[]): void {
  clearReview()
  fieldErrors.value = {}
  emit('update:newLines', lines.map(line => ({ ...line })))
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
    existingLineDrafts: props.existingLineDrafts,
    newLines: props.newLines,
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
    description="可新增或增加产品；没有有效采购单的产品可以减少或移除。"
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

    <div
      v-if="context"
      class="gap-5 grid lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:items-start"
    >
      <aside class="min-w-0 space-y-4">
        <section class="p-4 border border-border rounded-lg bg-muted/15">
          <div class="flex gap-3 items-start justify-between">
            <div class="min-w-0">
              <span class="qs-type-meta text-muted-foreground">销售订单 · v{{ context.salesOrder.version }}</span>
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

        <section class="p-4 border border-border rounded-lg">
          <h3 class="text-sm font-semibold m-0 mb-3">
            当前金额
          </h3>
          <dl class="m-0 gap-x-3 gap-y-2 grid grid-cols-[1fr_auto]">
            <dt class="qs-type-meta text-muted-foreground">
              约定总价
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
            <dt class="qs-type-meta text-muted-foreground">
              已收款
            </dt>
            <dd class="m-0">
              <AmountDisplay :currencies="currencies" :currency="currency" :value="context.amounts.paidAmount" />
            </dd>
          </dl>
        </section>

        <section class="p-4 border border-amber-500/25 rounded-lg bg-amber-500/[0.035]">
          <div class="text-amber-700 flex gap-2 items-start dark:text-amber-300">
            <FaIcon name="i-lucide:shield-alert" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />
            <div>
              <h3 class="text-sm font-semibold m-0">
                采购约束
              </h3>
              <p class="qs-type-meta leading-5 m-0 mt-1">
                已采购产品只能增加数量；未采购产品可减少到 0，0 表示从当前订单移除。
              </p>
            </div>
          </div>
        </section>
      </aside>

      <section class="min-w-0">
        <div
          v-if="reviewing && reviewedIntent && preview"
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
            保存后将同步更新销售金额、付款状态和采购进度，请核对本次变化。
          </p>
          <div class="gap-3 grid sm:grid-cols-4">
            <div class="p-3 border border-border/70 rounded-lg bg-background/70">
              <span class="qs-type-meta text-muted-foreground block">新增产品</span>
              <strong class="qs-type-data-emphasis mt-1 block">{{ preview.addedLineCount }} 行</strong>
            </div>
            <div class="p-3 border border-border/70 rounded-lg bg-background/70">
              <span class="qs-type-meta text-muted-foreground block">数量增加</span>
              <strong class="qs-type-data-emphasis mt-1 block">{{ preview.increasedLineCount }} 行</strong>
            </div>
            <div class="p-3 border border-border/70 rounded-lg bg-background/70">
              <span class="qs-type-meta text-muted-foreground block">数量减少</span>
              <strong class="qs-type-data-emphasis mt-1 block">{{ preview.decreasedLineCount }} 行</strong>
            </div>
            <div class="p-3 border border-border/70 rounded-lg bg-background/70">
              <span class="qs-type-meta text-muted-foreground block">移除产品</span>
              <strong class="qs-type-data-emphasis mt-1 block">{{ preview.removedLineCount }} 行</strong>
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
              <AmountDisplay :currencies="currencies" :currency="currency" :value="preview.amountDelta" />
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
              {{ fulfillmentStatusLabel(context.salesOrder.fulfillmentStatus) }} →
              {{ fulfillmentStatusLabel(preview.expectedFulfillmentStatus) }}
            </dd>
            <dt class="text-sm text-muted-foreground">
              修改原因
            </dt>
            <dd class="text-sm m-0 break-words">
              {{ reviewedIntent.reason }}
            </dd>
          </dl>
          <div class="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <FaButton type="button" variant="outline" :disabled="submitting" @click="clearReview">
              返回修改
            </FaButton>
            <FaButton type="button" :loading="submitting" :disabled="submitting" @click="confirmReview">
              {{ preview.requiresDepositReduction ? '确认调整定金并保存' : '确认保存' }}
            </FaButton>
          </div>
        </div>

        <FaForm v-else :model="formModel" as="div">
          <section>
            <div class="mb-3 flex gap-3 items-end justify-between">
              <div>
                <h3 class="text-base font-semibold m-0">
                  现有销售产品
                </h3>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  只调整数量；产品、快照和本单售价保持不变。
                </p>
              </div>
              <span class="qs-type-meta text-muted-foreground">{{ context.existingLines.length }} 项</span>
            </div>
            <div class="pr-1 max-h-72 overflow-y-auto space-y-2">
              <article
                v-for="(line, index) in context.existingLines"
                :key="line.id"
                class="p-3 border rounded-lg"
                :class="line.activePurchasedQuantity > 0 ? 'border-border bg-muted/35' : 'border-border bg-background'"
              >
                <div class="gap-3 grid sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-center">
                  <div class="min-w-0">
                    <div class="flex gap-2 min-w-0 items-baseline">
                      <span class="qs-type-meta text-muted-foreground shrink-0">{{ line.productNo ?? 'CUSTOM' }}</span>
                      <strong class="qs-type-body-medium truncate">{{ line.productName }}</strong>
                    </div>
                    <p class="qs-type-meta text-muted-foreground m-0 mt-1 truncate">
                      备注：{{ line.description || '-' }}
                    </p>
                    <div class="qs-type-meta text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1">
                      <span>本单售价 <AmountDisplay :currencies="currencies" :currency="currency" :value="line.actualUnitPriceAmount" /></span>
                      <span>原数量 {{ line.quantity }}</span>
                      <span v-if="line.activePurchasedQuantity > 0">已采购 {{ line.activePurchasedQuantity }}</span>
                    </div>
                    <p v-if="line.activePurchasedQuantity > 0" class="qs-type-meta text-amber-700 m-0 mt-1 dark:text-amber-300">
                      <FaIcon name="i-lucide:lock-keyhole" class="mr-1 align-text-bottom size-3.5" aria-hidden="true" />
                      存在有效采购单，只能增加数量
                    </p>
                  </div>
                  <div>
                    <label :for="`sales-order-product-quantity-${line.id}`" class="qs-type-meta text-muted-foreground block">目标数量</label>
                    <FaInput
                      :id="`sales-order-product-quantity-${line.id}`"
                      :model-value="draftFor(line.id)?.desiredQuantity ?? ''"
                      type="number"
                      inputmode="numeric"
                      :min="draftFor(line.id)?.minimumQuantity ?? line.quantity"
                      :disabled="submitting"
                      class="mt-1 w-full"
                      @update:model-value="updateExistingQuantity(line.id, $event)"
                    />
                    <p v-if="fieldErrors[`existingLines.${index}.desiredQuantity`]" class="text-xs text-destructive m-0 mt-1" role="alert">
                      {{ fieldErrors[`existingLines.${index}.desiredQuantity`] }}
                    </p>
                  </div>
                  <FaButton
                    v-if="line.canDecrease && draftFor(line.id)?.desiredQuantity !== '0'"
                    type="button"
                    variant="outline"
                    size="sm"
                    :disabled="submitting"
                    @click="removeExistingLine(line.id)"
                  >
                    移除
                  </FaButton>
                  <FaTag v-else-if="draftFor(line.id)?.desiredQuantity === '0'" variant="outline">
                    待移除
                  </FaTag>
                </div>
              </article>
            </div>
            <p v-if="fieldErrors.existingLines || fieldErrors.lines" class="text-sm text-destructive m-0 mt-2" role="alert">
              {{ fieldErrors.existingLines || fieldErrors.lines }}
            </p>
          </section>

          <div class="my-5 border-t border-border" />

          <QsOrderProductLineEditor
            :model-value="newLines"
            :currency="currency"
            :currencies="currencies"
            :labels="labels"
            :load-products="loadProducts"
            :maximum-lines="maximumNewLines"
            :field-errors="fieldErrors"
            :disabled="submitting"
            catalog-line-initial-actual-unit-price-amount="0.00"
            temporary-line-initial-actual-unit-price-amount="0.00"
            product-selection-description="可新增任意有效目录产品，也可新增本单临时产品。"
            @update:model-value="updateNewLines"
          />

          <div class="mt-5">
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

          <section v-if="preview" class="mt-5 p-4 border border-primary/20 rounded-lg bg-primary/[0.025]">
            <div class="gap-3 grid sm:grid-cols-3">
              <div><span class="qs-type-meta text-muted-foreground block">金额变化</span><AmountDisplay class="mt-1" :currencies="currencies" :currency="currency" :value="preview.amountDelta" /></div>
              <div><span class="qs-type-meta text-muted-foreground block">新约定总价</span><AmountDisplay class="mt-1" :currencies="currencies" :currency="currency" :value="preview.agreedTotalAmount" /></div>
              <div><span class="qs-type-meta text-muted-foreground block">新尾款</span><AmountDisplay class="mt-1" :currencies="currencies" :currency="currency" :value="preview.balanceDueAmount" /></div>
            </div>
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
          检查并确认修改
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
