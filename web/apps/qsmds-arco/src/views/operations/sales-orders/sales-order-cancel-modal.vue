<script setup lang="ts">
import type { SalesOrderListItemDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import salesOrdersApi from '@/api/modules/sales-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { buildSalesOrderCancelRequest } from './sales-order-cancel.logic'
import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'

defineOptions({ name: 'SalesOrderCancelModal' })

const props = defineProps<{
  currencies: readonly CurrencyDescriptor[]
  modelValue: boolean
  order: SalesOrderListItemDto | null
}>()

const emit = defineEmits<{
  'cancelled': []
  'update:modelValue': [value: boolean]
}>()

const toast = useQsToast()
const account = useAppAccountStore()
const reason = ref('')
const fieldError = ref('')
const actionError = ref('')
const submitting = ref(false)
let controller: AbortController | null = null

const canSubmit = computed(() => props.order !== null && !submitting.value)

function reset(): void {
  controller?.abort()
  controller = null
  reason.value = ''
  fieldError.value = ''
  actionError.value = ''
  submitting.value = false
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
  const order = props.order
  if (order === null || submitting.value) {
    return
  }
  const result = buildSalesOrderCancelRequest(reason.value)
  if (!result.valid) {
    fieldError.value = result.fieldError
    return
  }
  fieldError.value = ''
  actionError.value = ''
  const request = new AbortController()
  controller = request
  submitting.value = true
  try {
    await salesOrdersApi.updateOrderStatus(order.id, result.request, request.signal)
    if (request.signal.aborted) {
      return
    }
    toast.success('订单已取消')
    emit('cancelled')
    emit('update:modelValue', false)
    reset()
  }
  catch (failure) {
    if (request.signal.aborted || isSalesOrderAbortError(failure)) {
      return
    }
    const parsed = getSalesOrderApiFailure(failure)
    // 取消没有幂等键；网络失败时结果未知，不能直接重试。
    const suffix = parsed.unknownResult
      ? ' 结果未知，请刷新列表确认订单状态后再操作。'
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
  if (visible) {
    reset()
  }
})

watch(() => account.authEpoch, () => {
  if (props.modelValue) {
    reset()
    emit('update:modelValue', false)
  }
})

// 页面被 KeepAlive 缓存时同步关闭宿主弹窗，避免返回后以空原因重新出现。
onDeactivated(() => {
  reset()
  emit('update:modelValue', false)
})
onBeforeUnmount(reset)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="取消订单"
    description="取消后订单进入终态且不能恢复；订单、明细和凭证不会被删除。"
    size="md"
    :submitting="submitting"
    @update:model-value="setVisible"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:circle-x" class="text-destructive size-4" aria-hidden="true" />
    </template>
    <div class="space-y-4">
      <FaAlert v-if="actionError" :description="actionError" variant="destructive" />
      <div v-if="order" class="p-4 border border-border rounded-lg bg-muted/20 space-y-2">
        <div class="flex gap-3 items-center justify-between">
          <span class="text-sm text-muted-foreground">订单编号</span>
          <span class="font-mono font-semibold">{{ order.orderNo }}</span>
        </div>
        <div class="flex gap-3 items-center justify-between">
          <span class="text-sm text-muted-foreground">客户</span>
          <span class="font-medium truncate">{{ order.customerName }}</span>
        </div>
        <div class="flex gap-3 items-center justify-between">
          <span class="text-sm text-muted-foreground">实际售价</span>
          <AmountDisplay :value="order.agreedTotalAmount" :currency="order.currencyCode" :currencies="currencies" />
        </div>
      </div>
      <div>
        <label for="sales-order-cancel-reason" class="text-sm font-medium">
          取消原因 <span class="text-destructive" aria-hidden="true">*</span>
        </label>
        <FaTextarea
          id="sales-order-cancel-reason"
          v-model="reason"
          class="mt-2"
          :rows="3"
          :maxlength="500"
          placeholder="请填写取消原因（最多 500 字）"
          :disabled="submitting"
        />
        <p v-if="fieldError" class="text-xs text-destructive m-0 mt-1">
          {{ fieldError }}
        </p>
      </div>
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="setVisible(false)">
        返回
      </FaButton>
      <FaButton type="button" variant="destructive" :loading="submitting" :disabled="!canSubmit" @click="submit">
        确认取消
      </FaButton>
    </template>
  </QsGenericModal>
</template>
