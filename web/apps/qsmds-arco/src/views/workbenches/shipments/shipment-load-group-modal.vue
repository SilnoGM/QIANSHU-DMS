<script setup lang="ts">
import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import purchaseShipmentsApi from '@/api/modules/purchase-shipments'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { getPurchaseOrderApiFailure } from '@/views/operations/purchase-orders/purchase-order-list.logic'

defineOptions({ name: 'ShipmentLoadGroupModal' })

const props = defineProps<{
  modelValue: boolean
  shipment: PurchaseShipmentListItemDto | null
}>()

const emit = defineEmits<{
  'saved': []
  'update:modelValue': [value: boolean]
}>()

const toast = useQsToast()
const candidates = ref<PurchaseShipmentListItemDto[]>([])
const selectedIds = ref<string[]>([])
const primaryId = ref('')
const loading = ref(false)
const submitting = ref(false)
const error = ref<string | null>(null)
let controller: AbortController | null = null
let requestKey = ''

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const primaryLabel = computed(() => {
  const primary = candidates.value.find(candidate => candidate.id === primaryId.value)
  return primary?.shipmentNo || (primary === undefined ? '—' : `货件-${String(primary.partNumber).padStart(2, '0')}`)
})
const canSubmit = computed(() => selectedIds.value.length >= 2 && selectedIds.value.includes(primaryId.value))

function formatPart(partNumber: number): string {
  return `货件-${String(partNumber).padStart(2, '0')}`
}

watch(() => props.modelValue, (value) => {
  if (value) {
    void initialize()
  }
})

onBeforeUnmount(() => {
  controller?.abort()
})

async function initialize(): Promise<void> {
  if (props.shipment === null) {
    return
  }
  selectedIds.value = [props.shipment.id]
  primaryId.value = props.shipment.id
  requestKey = globalThis.crypto.randomUUID()
  error.value = null
  await loadCandidates()
}

async function loadCandidates(): Promise<void> {
  if (props.shipment === null) {
    return
  }
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  try {
    const response = await purchaseShipmentsApi.list({
      keyword: props.shipment.purchaseOrder.orderNo,
      view: 'ALL',
      pageSize: 100,
      sort: 'CREATED_DESC',
    }, request.signal)
    if (request.signal.aborted) {
      return
    }
    const rows = response.data.items.filter(row => row.purchaseOrder.id === props.shipment!.purchaseOrder.id
      && row.viewStatus === 'WAREHOUSE_RECEIVED'
      && row.loadGroup === null)
    candidates.value = rows.some(row => row.id === props.shipment!.id)
      ? rows
      : [props.shipment, ...rows]
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = getPurchaseOrderApiFailure(failure).message
    }
  }
  finally {
    if (controller === request) {
      controller = null
    }
    loading.value = false
  }
}

function toggle(shipmentId: string, checked: boolean): void {
  if (shipmentId === props.shipment?.id) {
    return
  }
  const next = checked
    ? [...new Set([...selectedIds.value, shipmentId])]
    : selectedIds.value.filter(id => id !== shipmentId)
  selectedIds.value = next
  if (!next.includes(primaryId.value)) {
    primaryId.value = next[0] ?? ''
  }
}

function close(): void {
  controller?.abort()
  emit('update:modelValue', false)
}

async function submit(): Promise<void> {
  if (!canSubmit.value || submitting.value) {
    return
  }
  const request = new AbortController()
  controller = request
  submitting.value = true
  error.value = null
  let completed = false
  try {
    await purchaseShipmentsApi.createLoadGroup({
      shipmentIds: selectedIds.value,
      primaryShipmentId: primaryId.value,
      requestKey,
    }, request.signal)
    if (request.signal.aborted) {
      return
    }
    toast.success(`已合并 ${selectedIds.value.length} 个货件，装柜时请选择主货件 ${primaryLabel.value}`)
    emit('saved')
    completed = true
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = getPurchaseOrderApiFailure(failure).message
    }
  }
  finally {
    if (controller === request) {
      controller = null
    }
    submitting.value = false
  }
  if (completed) {
    emit('update:modelValue', false)
  }
}
</script>

<template>
  <QsGenericModal
    v-model="open" title="合并装柜"
    description="同采购单、同销售单、同基础唛头的货件合并为一票；装柜行只关联主货件，成员随主货件一起装柜与签收。"
    :error="error" :submitting="submitting" size="lg"
  >
    <div class="flex flex-col gap-4">
      <FaAlert
        icon="i-lucide:info"
        title="合并前请确认"
        description="已装柜、已签收、寄仓中或有包装费的货件不能合并。合并后主货件不可更换；未装柜前可以撤销合并。"
        class="border-primary/30 bg-primary/5"
      />
      <p v-if="loading" class="text-sm text-muted-foreground m-0" role="status">
        加载同单货件…
      </p>
      <div v-else class="flex flex-col gap-2">
        <div
          v-for="candidate in candidates"
          :key="candidate.id"
          class="p-3 border border-border rounded-lg flex gap-3 min-w-0 items-start"
          :class="selectedIds.includes(candidate.id) ? 'bg-primary/5' : ''"
        >
          <FaCheckbox
            :model-value="selectedIds.includes(candidate.id)"
            :disabled="candidate.id === shipment?.id"
            class="mt-1 shrink-0"
            :aria-label="`选择 ${candidate.shipmentNo || formatPart(candidate.partNumber)}`"
            @update:model-value="toggle(candidate.id, $event === true)"
          />
          <div class="flex flex-1 flex-col gap-1 min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <span class="qs-type-data-emphasis [overflow-wrap:anywhere]">{{ candidate.shipmentNo || '未编号' }}</span>
              <FaTag v-if="candidate.id === primaryId" variant="outline" size="sm">
                主货件
              </FaTag>
            </div>
            <span class="qs-type-meta [overflow-wrap:anywhere]">
              {{ candidate.shippingMarkText || '无唛头' }} · {{ formatPart(candidate.partNumber) }} · {{ candidate.destinationWarehouse?.label || candidate.destinationWarehouseValue || '无仓库' }}
            </span>
          </div>
          <FaButton
            v-if="selectedIds.includes(candidate.id) && candidate.id !== primaryId"
            type="button" variant="ghost" size="sm" :disabled="submitting"
            @click="primaryId = candidate.id"
          >
            设为主货件
          </FaButton>
        </div>
        <p v-if="candidates.length < 2" class="text-sm text-muted-foreground m-0">
          同采购单下没有其他可合并的已到仓货件。
        </p>
      </div>
      <p class="qs-type-meta m-0">
        已选 {{ selectedIds.length }} 件；主货件：{{ primaryLabel }}
      </p>
    </div>
    <template #footer>
      <FaButton variant="outline" :disabled="submitting" @click="close">
        取消
      </FaButton>
      <FaButton :loading="submitting" :disabled="!canSubmit" @click="submit">
        确认合并
      </FaButton>
    </template>
  </QsGenericModal>
</template>
