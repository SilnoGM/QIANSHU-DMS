<script setup lang="ts">
import type { SalesOrderDetailDto, SalesOrderListItemDto, ShipmentStorageDetailDto } from '@/api/generated/types.gen'
import salesOrdersApi from '@/api/modules/sales-orders'
import shipmentStorageApi from '@/api/modules/shipment-storage'
import { useQsToast } from '@/components/base/QsToast/useQsToast'

import { storageFailureMessage } from './logic'

defineOptions({ name: 'ShipmentStorageClaimModal' })

const props = defineProps<{
  modelValue: boolean
  storageRecord: ShipmentStorageDetailDto | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'claimed': []
}>()

const toast = useQsToast()
const orders = ref<SalesOrderListItemDto[]>([])
const ordersLoading = ref(false)
const selectedOrderId = ref('')
const selectedOrder = ref<SalesOrderDetailDto | null>(null)
const orderLoading = ref(false)
const error = ref('')
const submitting = ref(false)
let controller: AbortController | null = null

const totalQuantity = computed(() => (props.storageRecord?.originAllocations ?? []).reduce((sum, allocation) => {
  if (typeof allocation !== 'object' || allocation === null) {
    return sum
  }
  const quantity = (allocation as Record<string, unknown>).quantity
  return sum + (typeof quantity === 'number' ? quantity : 0)
}, 0))

const orderOptions = computed(() => orders.value
  .filter(order => order.id !== props.storageRecord?.originSalesOrderId)
  .map(order => ({ value: order.id, label: `${order.orderNo} · ${order.customerName}` })))

const allocation = computed(() => {
  const order = selectedOrder.value
  if (order === null) {
    return []
  }
  let remaining = totalQuantity.value
  const lines: { productName: string, quantity: number, lineId: string }[] = []
  for (const line of order.lines) {
    if (remaining <= 0) {
      break
    }
    const quantity = Math.min(line.quantity, remaining)
    if (quantity > 0) {
      lines.push({ productName: line.productName, quantity, lineId: line.id })
      remaining -= quantity
    }
  }
  return lines
})

const allocationShort = computed(() => selectedOrder.value !== null
  && allocation.value.reduce((sum, line) => sum + line.quantity, 0) !== totalQuantity.value)

function reset(): void {
  controller?.abort()
  controller = null
  orders.value = []
  selectedOrderId.value = ''
  selectedOrder.value = null
  error.value = ''
  submitting.value = false
}

async function loadOrders(signal: AbortSignal): Promise<void> {
  ordersLoading.value = true
  try {
    const response = await salesOrdersApi.list({
      view: 'all',
      statusSelection: 'CONFIRMED',
      page: 1,
      pageSize: 100,
    }, signal)
    if (!signal.aborted) {
      orders.value = response.data.items
    }
  }
  catch (failure) {
    if (!signal.aborted) {
      error.value = storageFailureMessage(failure, '销售订单加载失败')
    }
  }
  finally {
    if (!signal.aborted) {
      ordersLoading.value = false
    }
  }
}

async function changeOrder(value: string): Promise<void> {
  selectedOrderId.value = value
  selectedOrder.value = null
  error.value = ''
  if (value === '') {
    return
  }
  const request = new AbortController()
  controller?.abort()
  controller = request
  orderLoading.value = true
  try {
    const response = await salesOrdersApi.getById(value, request.signal)
    if (!request.signal.aborted) {
      selectedOrder.value = response.data
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = storageFailureMessage(failure, '销售订单详情加载失败')
    }
  }
  finally {
    if (!request.signal.aborted) {
      orderLoading.value = false
    }
  }
}

async function submit(): Promise<void> {
  const record = props.storageRecord
  if (record === null || selectedOrderId.value === '' || submitting.value) {
    return
  }
  if (allocation.value.length === 0 || allocationShort.value) {
    error.value = '目标订单行数量不足，无法整件认领'
    return
  }
  submitting.value = true
  error.value = ''
  const request = new AbortController()
  try {
    await shipmentStorageApi.claim(record.id, {
      salesOrderId: selectedOrderId.value,
      lines: allocation.value.map(line => ({
        salesOrderLineId: line.lineId,
        quantity: line.quantity,
      })),
      requestKey: crypto.randomUUID(),
    }, request.signal)
    toast.success('寄仓货件已认领')
    emit('claimed')
  }
  catch (failure) {
    error.value = storageFailureMessage(failure, '认领失败')
  }
  finally {
    submitting.value = false
  }
}

watch(() => props.modelValue, (visible) => {
  reset()
  if (visible) {
    const request = new AbortController()
    controller = request
    void loadOrders(request.signal)
  }
})

function setVisible(value: boolean): void {
  if (submitting.value) {
    return
  }
  emit('update:modelValue', value)
}
</script>

<template>
  <FaModal :model-value="modelValue" title="认领寄仓货件" size="lg" @update:model-value="setVisible">
    <div class="flex flex-col gap-4">
      <FaAlert v-if="error" :description="error" variant="destructive" />
      <div class="p-3 border border-border rounded-lg">
        <p class="qs-type-meta text-muted-foreground m-0">
          寄仓货件
        </p>
        <p class="mb-0 mt-1">
          {{ storageRecord?.shipmentNo ?? '—' }} · {{ storageRecord?.shippingMarkText ?? '无唛头' }}
        </p>
        <p class="qs-type-meta text-muted-foreground mb-0 mt-1">
          整件认领数量：{{ totalQuantity }}
        </p>
      </div>
      <label class="flex flex-col gap-1">
        <span class="text-sm">目标销售订单</span>
        <FaSelect
          :model-value="selectedOrderId"
          :options="orderOptions"
          :disabled="ordersLoading || submitting"
          :placeholder="ordersLoading ? '加载中…' : '选择已确认的销售订单'"
          @update:model-value="changeOrder(String($event))"
        />
      </label>
      <div v-if="orderLoading" class="text-sm text-muted-foreground">
        正在加载销售行…
      </div>
      <div v-else-if="selectedOrder" class="p-3 border border-border rounded-lg">
        <p class="qs-type-meta text-muted-foreground m-0">
          认领映射
        </p>
        <div v-for="line in allocation" :key="line.lineId" class="mt-2 flex gap-3 items-center justify-between">
          <span class="truncate">{{ line.productName }}</span>
          <span class="font-mono">× {{ line.quantity }}</span>
        </div>
        <p v-if="allocationShort" class="text-xs text-destructive mb-0 mt-2">
          目标订单行数量不足，无法整件认领。
        </p>
        <p v-else class="qs-type-meta text-muted-foreground mb-0 mt-2">
          首期只支持整件认领，数量按目标销售行顺序分配。
        </p>
      </div>
    </div>
    <template #footer>
      <div class="flex gap-2 justify-end">
        <FaButton variant="outline" :disabled="submitting" @click="setVisible(false)">
          取消
        </FaButton>
        <FaButton
          :loading="submitting"
          :disabled="selectedOrderId === '' || allocation.length === 0 || allocationShort"
          @click="submit"
        >
          确认认领
        </FaButton>
      </div>
    </template>
  </FaModal>
</template>
