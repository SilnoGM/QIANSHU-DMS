<script setup lang="ts">
import type { SalesOrderDetailDto, SalesOrderListItemDto, ShipmentStorageClaimRequestDto, ShipmentStorageDetailDto } from '@/api/generated/types.gen'
import salesOrdersApi from '@/api/modules/sales-orders'
import shipmentStorageApi from '@/api/modules/shipment-storage'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { storageFailureMessage } from '@/views/workbenches/shipment-storage/logic'

defineOptions({ name: 'ShipmentStorageClaimModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  storageRecord: ShipmentStorageDetailDto | null
  mode?: 'apply' | 'direct' | 'review'
  claimRequest?: ShipmentStorageClaimRequestDto | null
}>(), {
  mode: 'direct',
  claimRequest: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'requested': []
  'claimed': []
  'rejected': []
  'refresh': []
}>()

const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const orders = ref<SalesOrderListItemDto[]>([])
const ordersLoading = ref(false)
const selectedOrderId = ref('')
const selectedOrder = ref<SalesOrderDetailDto | null>(null)
const orderLoading = ref(false)
const error = ref('')
const submitting = ref(false)
const rejectMode = ref(false)
const rejectReason = ref('')
let controller: AbortController | null = null

const isReview = computed(() => props.mode === 'review')
const modalTitle = computed(() => {
  if (isReview.value) {
    return '审核调货申请'
  }
  return props.mode === 'apply' ? '申请调货' : '认领寄仓货件'
})
const reviewRequest = computed(() => props.mode === 'review' ? props.claimRequest : null)
const reviewAllocations = computed(() => reviewRequest.value?.allocations ?? [])
const displayCostTotal = computed(() => reviewRequest.value?.costTotalCny
  ?? props.storageRecord?.cost.totalCostCny
  ?? '0.00')
const displayOrderNo = computed(() => {
  if (isReview.value) {
    return reviewRequest.value?.targetSalesOrderNo ?? '—'
  }
  return selectedOrder.value?.orderNo ?? '—'
})
const totalQuantity = computed(() => (props.storageRecord?.originAllocations ?? []).reduce((sum, allocation) => {
  if (typeof allocation !== 'object' || allocation === null) {
    return sum
  }
  const quantity = (allocation as Record<string, unknown>).quantity
  return sum + (typeof quantity === 'number' ? quantity : 0)
}, 0))
const reviewQuantity = computed(() => reviewAllocations.value.reduce((sum, line) => sum + line.quantity, 0))

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
  rejectMode.value = false
  rejectReason.value = ''
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

async function submitApply(): Promise<void> {
  const record = props.storageRecord
  if (record === null || selectedOrderId.value === '' || submitting.value) {
    return
  }
  if (allocation.value.length === 0 || allocationShort.value) {
    error.value = '目标订单行数量不足，无法整件走货'
    return
  }
  submitting.value = true
  error.value = ''
  const request = new AbortController()
  try {
    await shipmentStorageApi.createClaimRequest(record.id, {
      salesOrderId: selectedOrderId.value,
      lines: allocation.value.map(line => ({
        salesOrderLineId: line.lineId,
        quantity: line.quantity,
      })),
      requestKey: crypto.randomUUID(),
    }, request.signal)
    toast.success('调货申请已提交')
    emit('requested')
  }
  catch (failure) {
    error.value = storageFailureMessage(failure, '调货申请提交失败')
  }
  finally {
    submitting.value = false
  }
}

async function submitDirect(): Promise<void> {
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

async function approveRequest(): Promise<void> {
  const record = props.storageRecord
  const request = reviewRequest.value
  if (record === null || request === null || submitting.value) {
    return
  }
  submitting.value = true
  error.value = ''
  const controller = new AbortController()
  try {
    await shipmentStorageApi.approveClaimRequest(record.id, request.id, controller.signal)
    toast.success('调货申请已通过')
    emit('claimed')
  }
  catch (failure) {
    error.value = storageFailureMessage(failure, '调货申请审核失败')
    // 复检失败时服务端会把申请转为拒绝；通知页面刷新锁定态。
    emit('refresh')
  }
  finally {
    submitting.value = false
  }
}

async function rejectRequest(): Promise<void> {
  const record = props.storageRecord
  const request = reviewRequest.value
  if (record === null || request === null || submitting.value) {
    return
  }
  if (rejectReason.value.trim() === '') {
    error.value = '请填写拒绝原因'
    return
  }
  submitting.value = true
  error.value = ''
  const controller = new AbortController()
  try {
    await shipmentStorageApi.rejectClaimRequest(record.id, request.id, {
      reason: rejectReason.value.trim(),
    }, controller.signal)
    toast.success('调货申请已拒绝')
    emit('rejected')
  }
  catch (failure) {
    error.value = storageFailureMessage(failure, '调货申请拒绝失败')
  }
  finally {
    submitting.value = false
  }
}

async function submit(): Promise<void> {
  if (isReview.value) {
    await approveRequest()
    return
  }
  if (props.mode === 'apply') {
    await submitApply()
    return
  }
  await submitDirect()
}

watch(() => props.modelValue, (visible) => {
  reset()
  if (visible && !isReview.value) {
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
  <FaModal :model-value="modelValue" :title="modalTitle" size="lg" @update:model-value="setVisible">
    <div class="flex flex-col gap-4">
      <FaAlert v-if="error" :description="error" variant="destructive" />
      <div class="gap-3 grid sm:grid-cols-2">
        <div class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            寄仓货件
          </p>
          <p class="mb-0 mt-1">
            {{ storageRecord?.shipmentNo ?? '—' }} · {{ storageRecord?.shippingMarkText ?? '无唛头' }}
          </p>
        </div>
        <div class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            成本合计
          </p>
          <AmountDisplay
            :value="displayCostTotal"
            currency="CNY"
            :currencies="currencyCatalog.currencies.value"
            class="text-lg text-primary font-semibold mt-1"
          />
        </div>
      </div>

      <div v-if="isReview" class="flex flex-col gap-3">
        <div class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            申请人
          </p>
          <QsPersonDisplay
            v-if="reviewRequest"
            :display-name="reviewRequest.applicant.displayName"
            :avatar-url="reviewRequest.applicant.avatarUrl"
            size="sm"
            class="mt-1"
          />
        </div>
        <div class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            目标销售订单
          </p>
          <p class="mb-0 mt-1">
            {{ displayOrderNo }}
          </p>
        </div>
        <div class="p-3 border border-border rounded-lg">
          <p class="qs-type-meta text-muted-foreground m-0">
            认领映射
          </p>
          <div v-for="line in reviewAllocations" :key="line.salesOrderLineId" class="mt-2 flex gap-3 items-center justify-between">
            <span class="truncate">{{ line.productName }}</span>
            <span class="font-mono">× {{ line.quantity }}</span>
          </div>
          <p class="qs-type-meta text-muted-foreground mb-0 mt-2">
            整件认领数量：{{ reviewQuantity }}
          </p>
        </div>
        <div v-if="rejectMode" class="p-3 border border-border rounded-lg flex flex-col gap-2">
          <span class="text-sm">拒绝原因 <span class="text-destructive">*</span></span>
          <FaTextarea
            v-model="rejectReason"
            :rows="3"
            maxlength="500"
            placeholder="请说明拒绝原因"
            :disabled="submitting"
          />
        </div>
      </div>

      <template v-else>
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
            目标订单行数量不足，无法整件走货。
          </p>
          <p v-else class="qs-type-meta text-muted-foreground mb-0 mt-2">
            首期只支持整件认领，数量按目标销售行顺序分配。
          </p>
        </div>
      </template>
    </div>

    <template #footer>
      <div class="flex gap-2 justify-end">
        <template v-if="isReview">
          <template v-if="rejectMode">
            <FaButton variant="outline" :disabled="submitting" @click="rejectMode = false">
              取消
            </FaButton>
            <FaButton variant="destructive" :loading="submitting" @click="rejectRequest">
              确认拒绝
            </FaButton>
          </template>
          <template v-else>
            <FaButton variant="outline" :disabled="submitting || !reviewRequest" @click="rejectMode = true">
              拒绝
            </FaButton>
            <FaButton :loading="submitting" :disabled="!reviewRequest" @click="submit">
              同意调货
            </FaButton>
          </template>
        </template>
        <template v-else>
          <FaButton variant="outline" :disabled="submitting" @click="setVisible(false)">
            取消
          </FaButton>
          <FaButton
            :loading="submitting"
            :disabled="selectedOrderId === '' || allocation.length === 0 || allocationShort"
            @click="submit"
          >
            {{ mode === 'apply' ? '提交申请' : '确认认领' }}
          </FaButton>
        </template>
      </div>
    </template>
  </FaModal>
</template>
