<script setup lang="ts">
import type {
  SalesOrderListItemDto,
  SalesOrderTerminationContextDto,
  SalesOrderTerminationShipmentDto,
} from '@/api/generated/types.gen'

import salesOrdersApi from '@/api/modules/sales-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
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
const { auth } = useAppAuth()
const account = useAppAccountStore()
const overseasCatalog = useDictionaryCatalog('overseas.warehouse')
const canReleaseStorage = computed(() => auth('shipment-storage:release'))
const reason = ref('')
const fieldError = ref('')
const actionError = ref('')
const submitting = ref(false)
const context = ref<SalesOrderTerminationContextDto | null>(null)
const contextLoading = ref(false)
const contextError = ref('')
const selectedIds = ref<string[]>([])
const overseasWarehouseValue = ref('')
let controller: AbortController | null = null

const pendingShipments = computed(() => context.value?.shipments.filter(shipment => shipment.pending) ?? [])
const selectedShipments = computed(() => pendingShipments.value.filter(shipment => selectedIds.value.includes(shipment.id)))
const selectedLoaded = computed(() => selectedShipments.value.some(shipment => shipment.loaded))
const allPendingSelected = computed(() => pendingShipments.value.length === 0
  || pendingShipments.value.every(shipment => selectedIds.value.includes(shipment.id)))
const hasUnreleasable = computed(() => pendingShipments.value.some(shipment => !shipment.releasable))
const overseasOptions = computed(() => overseasCatalog.selectableItems.value.map(item => ({
  value: item.value,
  label: item.label,
})))
const canSubmit = computed(() => {
  if (context.value === null || submitting.value || reason.value.trim() === '') {
    return false
  }
  if (context.value.canTerminate === false) {
    return false
  }
  if (pendingShipments.value.length === 0) {
    return true
  }
  if (!canReleaseStorage.value || hasUnreleasable.value || !allPendingSelected.value) {
    return false
  }
  return !selectedLoaded.value || overseasWarehouseValue.value !== ''
})

function reset(): void {
  controller?.abort()
  controller = null
  reason.value = ''
  fieldError.value = ''
  actionError.value = ''
  submitting.value = false
  context.value = null
  contextLoading.value = false
  contextError.value = ''
  selectedIds.value = []
  overseasWarehouseValue.value = ''
}

async function loadContext(signal: AbortSignal): Promise<void> {
  const order = props.order
  if (order === null) {
    return
  }
  contextLoading.value = true
  contextError.value = ''
  try {
    const response = await salesOrdersApi.terminationContext(order.id, signal)
    if (signal.aborted) {
      return
    }
    context.value = response.data
    selectedIds.value = response.data.shipments
      .filter(shipment => shipment.pending && shipment.releasable)
      .map(shipment => shipment.id)
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

function toggleShipment(shipment: SalesOrderTerminationShipmentDto, checked: boolean): void {
  if (!shipment.pending || !shipment.releasable) {
    return
  }
  const next = new Set(selectedIds.value)
  if (checked) {
    next.add(shipment.id)
  }
  else {
    next.delete(shipment.id)
  }
  selectedIds.value = [...next]
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
  const current = context.value
  if (order === null || current === null || submitting.value) {
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
    if (pendingShipments.value.length === 0) {
      await salesOrdersApi.updateOrderStatus(order.id, {
        toStatus: 'TERMINATED',
        reason: trimmed,
      }, request.signal)
    }
    else {
      await salesOrdersApi.terminate(order.id, {
        reason: trimmed,
        shipmentIds: selectedIds.value,
        ...(selectedLoaded.value ? { overseasWarehouseValue: overseasWarehouseValue.value } : {}),
      }, request.signal)
    }
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
  reset()
  if (visible) {
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
    title="终止订单"
    description="终止表示订单不再履约、货件可转入寄仓；它不会取消采购单，也不会冲正已收款。"
    size="lg"
    :submitting="submitting"
    @update:model-value="setVisible"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:circle-slash" class="text-amber-600 size-4" aria-hidden="true" />
    </template>
    <div class="space-y-4">
      <FaAlert v-if="actionError" :description="actionError" variant="destructive" />
      <FaAlert v-if="contextError" :description="contextError" variant="destructive" />
      <FaAlert
        variant="default"
        icon="i-lucide:info"
        title="终止不是取消"
        description="采购单保持原状态，仍需继续付款与完成；客户已付款项保留原样。未处理的货件必须先释放进寄仓。"
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
        正在检查货件状态…
      </div>
      <template v-else-if="context">
        <FaAlert
          v-if="context.allShipmentsProcessed"
          variant="default"
          icon="i-lucide:circle-check"
          title="全部货件已处理"
          description="有效货件均已寄仓、已调货或已签收，可以直接终止订单。"
        />
        <FaAlert
          v-else-if="context.canTerminate === false && context.blockedReason"
          variant="destructive"
          :description="context.blockedReason"
        />

        <section v-if="context.shipments.length > 0">
          <h3 class="text-sm font-medium mb-2">
            受影响货件
          </h3>
          <div class="flex flex-col gap-2">
            <div
              v-for="shipment in context.shipments"
              :key="shipment.id"
              class="p-3 border border-border rounded-lg flex gap-3 items-start"
            >
              <FaCheckbox
                v-if="shipment.pending"
                :model-value="selectedIds.includes(shipment.id)"
                :disabled="!shipment.releasable || submitting"
                class="mt-0.5"
                @update:model-value="toggleShipment(shipment, Boolean($event))"
              />
              <div class="flex-1 min-w-0">
                <p class="font-medium m-0">
                  {{ shipment.shipmentNo ?? `货件-${shipment.partNumber}` }} · {{ shipment.shippingMarkText ?? '无唛头' }}
                </p>
                <p v-if="shipment.pending && !shipment.releasable" class="text-xs text-destructive mb-0 mt-1">
                  {{ shipment.blockedReason }}
                </p>
                <p v-else-if="!shipment.pending" class="text-xs text-muted-foreground mb-0 mt-1">
                  {{ shipment.deliveredAt ? '已签收' : shipment.storageStatus === 'IN_STORAGE' ? '已寄仓' : shipment.storageStatus === 'CLAIMED' ? '已调货' : '已处理' }}
                </p>
                <p v-else class="text-xs text-muted-foreground mb-0 mt-1">
                  {{ shipment.loaded ? '已装柜，释放到海外仓' : '未装柜，释放到内地仓' }}
                </p>
              </div>
            </div>
          </div>
        </section>

        <label v-if="selectedLoaded" class="flex flex-col gap-1">
          <span class="text-sm">海外仓库 <span class="text-destructive" aria-hidden="true">*</span></span>
          <FaSelect
            v-model="overseasWarehouseValue"
            :options="overseasOptions"
            :disabled="submitting"
            placeholder="选择瑞锋台中仓或林口仓"
          />
        </label>

        <p v-if="pendingShipments.length > 0 && !canReleaseStorage" class="text-xs text-destructive m-0">
          当前身份缺少寄仓释放权限，无法终止仍有未处理货件的订单。
        </p>
      </template>

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
      <FaButton type="button" variant="destructive" :loading="submitting" :disabled="!canSubmit" @click="submit">
        确认终止
      </FaButton>
    </template>
  </QsGenericModal>
</template>
