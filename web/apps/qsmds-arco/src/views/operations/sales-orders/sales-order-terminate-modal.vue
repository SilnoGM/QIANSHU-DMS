<script setup lang="ts">
import type { SalesOrderListItemDto } from '@/api/generated/types.gen'

import salesOrdersApi from '@/api/modules/sales-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'

defineOptions({ name: 'SalesOrderTerminateModal' })

const props = defineProps<{
  modelValue: boolean
  order: SalesOrderListItemDto | null
}>()

const emit = defineEmits<{
  'terminated': []
  'update:modelValue': [value: boolean]
}>()

const toast = useQsToast()
const account = useAppAccountStore()
const reason = ref('')
const fieldError = ref('')
const actionError = ref('')
const submitting = ref(false)
let controller: AbortController | null = null

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
  const trimmed = reason.value.trim()
  if (trimmed === '') {
    fieldError.value = '请填写终止原因'
    return
  }
  fieldError.value = ''
  actionError.value = ''
  const request = new AbortController()
  controller = request
  submitting.value = true
  try {
    await salesOrdersApi.updateOrderStatus(order.id, {
      toStatus: 'TERMINATED',
      reason: trimmed,
    }, request.signal)
    if (request.signal.aborted) {
      return
    }
    toast.success('订单已终止')
    emit('terminated')
    emit('update:modelValue', false)
    reset()
  }
  catch (failure) {
    if (request.signal.aborted || isSalesOrderAbortError(failure)) {
      return
    }
    const parsed = getSalesOrderApiFailure(failure)
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

onDeactivated(() => {
  reset()
  emit('update:modelValue', false)
})
onBeforeUnmount(reset)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="终止订单"
    description="终止表示订单不再履约、货件可转入寄仓；它不会取消采购单，也不会冲正已收款。"
    size="md"
    :submitting="submitting"
    @update:model-value="setVisible"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:circle-slash" class="text-amber-600 size-4" aria-hidden="true" />
    </template>
    <div class="space-y-4">
      <FaAlert v-if="actionError" :description="actionError" variant="destructive" />
      <FaAlert
        variant="default"
        icon="i-lucide:info"
        title="终止不是取消"
        description="采购单保持原状态，仍需继续付款与完成；客户已付款项保留原样。终止后请到货件详情把货件释放进寄仓。"
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
      <div>
        <label for="sales-order-terminate-reason" class="text-sm font-medium">
          终止原因 <span class="text-destructive" aria-hidden="true">*</span>
        </label>
        <FaTextarea
          id="sales-order-terminate-reason"
          v-model="reason"
          class="mt-2"
          :rows="3"
          :maxlength="500"
          placeholder="例如：客户取消，货件待调给新订单"
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
      <FaButton type="button" variant="destructive" :loading="submitting" @click="submit">
        确认终止
      </FaButton>
    </template>
  </QsGenericModal>
</template>
