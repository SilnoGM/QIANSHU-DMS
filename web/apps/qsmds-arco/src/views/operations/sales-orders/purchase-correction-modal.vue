<script setup lang="ts">
import type {
  PurchaseCorrectionContextDto,
  SalesOrderListItemDto,
} from '@/api/generated/types.gen'

import salesOrdersApi from '@/api/modules/sales-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'

defineOptions({ name: 'PurchaseCorrectionModal' })

const props = defineProps<{
  modelValue: boolean
  order: SalesOrderListItemDto | null
}>()

const emit = defineEmits<{
  'corrected': []
  'update:modelValue': [value: boolean]
}>()

const toast = useQsToast()
const account = useAppAccountStore()
const context = ref<PurchaseCorrectionContextDto | null>(null)
const contextLoading = ref(false)
const contextError = ref('')
const actionError = ref('')
const fieldError = ref('')
const reason = ref('')
const confirmOrderNo = ref('')
const submitting = ref(false)
const idempotencyKey = ref('')
let controller: AbortController | null = null

const canSubmit = computed(() => (
  context.value !== null
  && context.value.canApply
  && !submitting.value
  && !contextLoading.value
  && reason.value.trim() !== ''
  && confirmOrderNo.value.trim() === context.value.salesOrderNo
))

function generateKey(): string {
  return globalThis.crypto.randomUUID()
}

function reset(): void {
  controller?.abort()
  controller = null
  context.value = null
  contextLoading.value = false
  contextError.value = ''
  actionError.value = ''
  fieldError.value = ''
  reason.value = ''
  confirmOrderNo.value = ''
  submitting.value = false
  idempotencyKey.value = ''
}

async function loadContext(signal: AbortSignal): Promise<void> {
  const order = props.order
  if (order === null) {
    return
  }
  contextLoading.value = true
  contextError.value = ''
  try {
    const response = await salesOrdersApi.purchaseCorrectionContext(order.id, signal)
    if (signal.aborted) {
      return
    }
    context.value = response.data
  }
  catch (failure) {
    if (signal.aborted || isSalesOrderAbortError(failure)) {
      return
    }
    contextError.value = getSalesOrderApiFailure(failure).message
  }
  finally {
    if (!signal.aborted) {
      contextLoading.value = false
    }
  }
}

function setVisible(value: boolean): void {
  if (submitting.value) {
    return
  }
  if (!value) {
    reset()
  }
  emit('update:modelValue', value)
}

async function submit(): Promise<void> {
  const current = context.value
  if (current === null || submitting.value) {
    return
  }
  const trimmedReason = reason.value.trim()
  if (trimmedReason === '') {
    fieldError.value = '请填写纠正原因'
    return
  }
  if (confirmOrderNo.value.trim() !== current.salesOrderNo) {
    fieldError.value = '销售单号输入不一致'
    return
  }
  if (!current.canApply) {
    fieldError.value = '当前存在阻断项，不能执行纠正'
    return
  }
  fieldError.value = ''
  actionError.value = ''
  const request = new AbortController()
  controller = request
  submitting.value = true
  try {
    const response = await salesOrdersApi.applyPurchaseCorrection({
      salesOrderId: current.salesOrderId,
      expectedSalesOrderVersion: current.version,
      purchaseOrders: current.purchaseOrders.map(purchase => ({
        purchaseOrderId: purchase.id,
        expectedVersion: purchase.version,
      })),
      reason: trimmedReason,
      confirmOrderNo: confirmOrderNo.value.trim(),
    }, idempotencyKey.value, request.signal)
    if (request.signal.aborted) {
      return
    }
    const result = response.data
    toast.success(result.signed
      ? `已撤销签收并退回待采购，反冲付款 ${result.totalReversedAmount} CNY；请到寄仓认领正确货件`
      : `已退回待采购，反冲付款 ${result.totalReversedAmount} CNY；请到寄仓认领正确货件`)
    emit('corrected')
    emit('update:modelValue', false)
    reset()
  }
  catch (failure) {
    if (request.signal.aborted || isSalesOrderAbortError(failure)) {
      return
    }
    const parsed = getSalesOrderApiFailure(failure)
    const suffix = parsed.unknownResult
      ? ' 结果未知，请刷新销售订单确认状态后再操作。'
      : ''
    actionError.value = parsed.requestId === undefined
      ? `${parsed.message}${suffix}`
      : `${parsed.message}${suffix}（requestId: ${parsed.requestId}）`
  }
  finally {
    if (controller === request) {
      controller = null
      submitting.value = false
    }
  }
}

watch(() => props.modelValue, (visible) => {
  reset()
  if (visible) {
    idempotencyKey.value = generateKey()
    const request = new AbortController()
    controller = request
    void loadContext(request.signal)
  }
})

watch(() => account.authEpoch, () => {
  if (props.modelValue) {
    reset()
    emit('update:modelValue', false)
  }
})

onDeactivated(() => {
  reset()
  emit('update:modelValue', false)
})
onBeforeUnmount(reset)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="退回待采购（误建采购）"
    description="仅用于整单误走采购、实际应从寄仓调货的未签收订单。"
    size="lg"
    :submitting="submitting"
    @update:model-value="setVisible"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:undo-2" class="text-destructive size-4" aria-hidden="true" />
    </template>
    <div class="space-y-4">
      <FaAlert v-if="actionError" :description="actionError" variant="destructive" />
      <FaAlert v-if="contextError" :description="contextError" variant="destructive" />
      <FaAlert
        variant="destructive"
        title="此操作不可撤销"
        description="将作废采购付款并生成资金反冲、取消待付款包装费、处理装柜行、清空发货/到仓/签收事实，并把销售订单退回待采购。采购单、货件、编号和审计历史保留；签收单只解除关联。"
      />

      <div v-if="order" class="p-4 border border-border rounded-lg bg-muted/20 space-y-2">
        <div class="flex gap-3 items-center justify-between">
          <span class="text-sm text-muted-foreground">订单编号</span>
          <span class="font-mono font-semibold">{{ order.orderNo }}</span>
        </div>
        <div class="flex gap-3 items-center justify-between">
          <span class="text-sm text-muted-foreground">客户</span>
          <span class="font-medium truncate">{{ order.customerName }}</span>
        </div>
      </div>

      <div v-if="contextLoading" class="text-sm text-muted-foreground">
        正在检查采购付款、包装费、装柜与对账状态…
      </div>
      <template v-else-if="context">
        <FaAlert
          v-for="blocker in context.blockers"
          :key="`${blocker.code}-${blocker.targetId}`"
          variant="destructive"
          :description="blocker.message"
        />

        <FaAlert
          v-if="context.signed"
          variant="destructive"
          title="订单已签收"
          description="纠正会撤销签收事实，并解除全部有效签收单；订单退回待采购后需要重新确认签收。"
        />
        <section v-if="context.deliveryReceipts.length > 0" class="p-4 border border-border rounded-lg space-y-2">
          <h3 class="text-sm font-medium m-0">
            将解除关联的签收单
          </h3>
          <p
            v-for="receipt in context.deliveryReceipts"
            :key="receipt.id"
            class="text-sm m-0"
          >
            {{ receipt.createdAt }}
          </p>
        </section>
        <FaAlert
          v-if="context.salesPaymentCount > 0"
          variant="default"
          icon="i-lucide:info"
          title="客户收款保留"
          :description="`该订单已有 ${context.salesPaymentCount} 笔有效收款，合计 ${context.salesPaidAmount}；纠正不会退回客户收款。`"
        />

        <section class="p-4 border border-border rounded-lg space-y-3">
          <div class="flex gap-3 items-baseline justify-between">
            <h3 class="text-sm font-medium m-0">
              采购付款反冲（CNY）
            </h3>
            <span class="text-lg font-mono font-semibold">{{ context.totalPaymentAmount }}</span>
          </div>
          <p v-if="context.payments.length === 0" class="text-sm text-muted-foreground m-0">
            无采购付款需要反冲。
          </p>
          <div v-else class="divide-border divide-y">
            <div
              v-for="payment in context.payments"
              :key="payment.id"
              class="py-2 flex gap-3 items-center justify-between first:pt-0 last:pb-0"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium m-0">
                  {{ payment.purchaseOrderNo }} · {{ payment.paymentType }}
                </p>
                <p class="text-xs text-muted-foreground m-0">
                  {{ payment.paidAt }} · {{ payment.paymentMethod ?? '未记录付款方式' }}
                </p>
              </div>
              <span class="text-sm font-mono shrink-0">{{ payment.amount }}</span>
            </div>
          </div>
        </section>

        <section v-if="context.packagingCosts.length > 0" class="p-4 border border-border rounded-lg space-y-2">
          <h3 class="text-sm font-medium m-0">
            将取消的待付款包装费
          </h3>
          <div
            v-for="cost in context.packagingCosts"
            :key="cost.id"
            class="text-sm flex gap-3 items-center justify-between"
          >
            <span>{{ cost.shipmentNo }}</span>
            <span class="font-mono">{{ cost.amount }} CNY</span>
          </div>
        </section>

        <section v-if="context.containerItems.length > 0" class="p-4 border border-border rounded-lg space-y-2">
          <h3 class="text-sm font-medium m-0">
            将处理的装柜行
          </h3>
          <div
            v-for="item in context.containerItems"
            :key="item.id"
            class="text-sm"
          >
            <p class="m-0">
              {{ item.containerBatchNo }} · 货件 {{ item.shipmentId }} ·
              {{ item.action === 'DELETE' ? '删除' : '解绑' }}
            </p>
            <p class="text-xs text-muted-foreground m-0">
              <template v-if="item.action === 'DELETE'">
                该行无变更记录且未被对账引用，纠正会从柜次删除。
              </template>
              <template v-else>
                该行有变更记录或对账引用，纠正只解绑，保留历史。
              </template>
            </p>
          </div>
        </section>

        <FaAlert
          v-if="context.preservedReconciliations.length > 0"
          variant="default"
          icon="i-lucide:info"
          title="已完成的对账批次将保留"
          :description="`${context.preservedReconciliations.map(row => row.batchNo).join('、')} 的结算与资金记录不撤销；纠正只处理货件事实。`"
        />

        <div>
          <label for="purchase-correction-reason" class="text-sm font-medium">
            纠正原因 <span class="text-destructive" aria-hidden="true">*</span>
          </label>
          <FaTextarea
            id="purchase-correction-reason"
            v-model="reason"
            class="mt-2"
            :rows="3"
            :maxlength="500"
            placeholder="例如：实际应从寄仓调货，误建了采购并发货装柜"
            :disabled="submitting"
          />
        </div>

        <div>
          <label for="purchase-correction-confirm" class="text-sm font-medium">
            输入销售单号确认 <span class="text-destructive" aria-hidden="true">*</span>
          </label>
          <FaInput
            id="purchase-correction-confirm"
            v-model="confirmOrderNo"
            class="font-mono mt-2"
            :placeholder="context.salesOrderNo"
            :disabled="submitting"
          />
          <p class="text-xs text-muted-foreground m-0 mt-1">
            必须与 {{ context.salesOrderNo }} 完全一致才能提交。
          </p>
        </div>

        <p v-if="fieldError" class="text-xs text-destructive m-0">
          {{ fieldError }}
        </p>
      </template>
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="setVisible(false)">
        返回
      </FaButton>
      <FaButton type="button" variant="destructive" :loading="submitting" :disabled="!canSubmit" @click="submit">
        确认退回待采购
      </FaButton>
    </template>
  </QsGenericModal>
</template>
