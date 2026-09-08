<script setup lang="ts">
import type {
  SalesOrderDetailDto,
  SalesOrderListItemDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import salesOrdersApi from '@/api/modules/sales-orders'
import QsSalesOrderDrawer from '@/components/business/QsSalesOrderDrawer/index.vue'

import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'

defineOptions({ name: 'SalesOrderDetailDrawer' })

const props = defineProps<{
  currencies: readonly CurrencyDescriptor[]
  modelValue: boolean
  order: SalesOrderListItemDto | null
}>()

const emit = defineEmits<{
  'closed': []
  'update:modelValue': [value: boolean]
}>()

const appAccountStore = useAppAccountStore()
const detail = shallowRef<SalesOrderDetailDto | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
let requestVersion = 0
let detailAbortController: AbortController | null = null

const drawerVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

function cancelDetailRequest(): void {
  requestVersion += 1
  detailAbortController?.abort()
  detailAbortController = null
}

/**
 * 每次打开均读取服务端详情；仅产品主图复用列表返回的同订单授权预览地址，因为详情
 * 契约不包含产品媒体。其余订单字段不依赖列表摘要，避免展示过期业务数据。
 */
async function loadDetail(): Promise<void> {
  const orderId = props.order?.id
  if (!props.modelValue || orderId === undefined) {
    return
  }

  cancelDetailRequest()
  const version = requestVersion
  const controller = new AbortController()
  detailAbortController = controller
  const authEpoch = appAccountStore.authEpoch
  loading.value = true
  loadError.value = null
  detail.value = null

  try {
    const response = await salesOrdersApi.getById(orderId, controller.signal)
    if (
      controller.signal.aborted
      || version !== requestVersion
      || authEpoch !== appAccountStore.authEpoch
      || props.order?.id !== orderId
      || !props.modelValue
    ) {
      return
    }
    detail.value = response.data
  }
  catch (error) {
    if (controller.signal.aborted || isSalesOrderAbortError(error)) {
      return
    }
    loadError.value = getSalesOrderApiFailure(error).message
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
      if (detailAbortController === controller) {
        detailAbortController = null
      }
    }
  }
}

watch(
  () => [props.modelValue, props.order?.id] as const,
  ([visible, orderId]) => {
    if (!visible || orderId === undefined) {
      cancelDetailRequest()
      detail.value = null
      loadError.value = null
      loading.value = false
      return
    }
    void loadDetail()
  },
  { immediate: true },
)

watch(() => appAccountStore.authEpoch, () => {
  cancelDetailRequest()
  drawerVisible.value = false
})

onBeforeUnmount(cancelDetailRequest)
</script>

<template>
  <QsSalesOrderDrawer
    v-model="drawerVisible"
    :order="order"
    :detail="detail"
    :currencies="currencies"
    :loading="loading"
    :error="loadError"
    @reload="loadDetail"
    @closed="emit('closed')"
  />
</template>
