<script setup lang="ts">
import type { SalesOrderEditTab } from './sales-order-edit.logic'
import type {
  SalesOrderEditContextDto,
  SalesOrderListItemDto,
} from '@/api/generated/types.gen'
import type { RegionSelectorChange, RegionSelectorValue } from '@/components/business/QsRegionSelector/types'

import salesOrdersApi from '@/api/modules/sales-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDateTimeField from '@/components/business/QsDateTimeField/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsRegionSelector from '@/components/business/QsRegionSelector/index.vue'
import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'
import {
  buildSalesOrderCustomerUpdatePayload,
  buildSalesOrderSalesInfoUpdatePayload,
  createSalesOrderCustomerDraft,
  createSalesOrderSalesInfoDraft,
  salesOrderCustomerDraftChanged,
  salesOrderProductEditUnavailableReason,
  salesOrderSalesInfoDraftChanged,
} from './sales-order-edit.logic'

defineOptions({ name: 'SalesOrderEditModal' })

const props = defineProps<{
  modelValue: boolean
  order: SalesOrderListItemDto | null
}>()

const emit = defineEmits<{
  'openProducts': []
  'saved': [kind: 'customer' | 'salesInfo']
  'update:modelValue': [value: boolean]
}>()

interface CustomerFormState {
  name: string
  phone: string
  fbName: string
  lineName: string
  region: RegionSelectorValue
  addressDetail: string
  reason: string
}

interface SalesInfoFormState {
  orderDate: string
  remark: string
  reason: string
}

const toast = useQsToast()
const context = shallowRef<SalesOrderEditContextDto | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const activeTab = ref<SalesOrderEditTab>('customer')
const customerForm = ref<CustomerFormState>(emptyCustomerForm())
const customerErrors = ref<Record<string, string>>({})
const customerActionError = ref<string | null>(null)
const customerSubmitting = ref(false)
const customerConflict = ref(false)
const salesForm = ref<SalesInfoFormState>(emptySalesForm())
const salesErrors = ref<Record<string, string>>({})
const salesActionError = ref<string | null>(null)
const salesSubmitting = ref(false)
const salesConflict = ref(false)
let loadController: AbortController | null = null
let customerController: AbortController | null = null
let salesController: AbortController | null = null
let requestVersion = 0

const tabs = [
  { value: 'customer', label: '客户信息', icon: 'i-lucide:user-round' },
  { value: 'salesInfo', label: '销售信息', icon: 'i-lucide:clipboard-list' },
  { value: 'products', label: '产品', icon: 'i-lucide:package' },
]

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const title = computed(() => props.order === null
  ? '编辑销售订单'
  : `编辑销售订单 · ${props.order.orderNo}`)
const customerChanged = computed(() => context.value !== null
  && salesOrderCustomerDraftChanged(context.value, customerForm.value))
const salesInfoChanged = computed(() => context.value !== null
  && salesOrderSalesInfoDraftChanged(context.value, salesForm.value))
const productBlockedReason = computed(() => context.value === null
  ? null
  : salesOrderProductEditUnavailableReason({
      orderStatus: context.value.orderStatus,
      fulfillmentStatus: context.value.fulfillmentStatus,
    }))
const historyRiskHint = computed(() => {
  const current = context.value
  if (current === null) {
    return null
  }
  if (current.orderStatus === 'CANCELLED') {
    return '该订单已终止：修改客户或出单信息只改变系统内的展示与检索，不会改变已生成的凭证、对账与通知。'
  }
  if (current.orderStatus === 'COMPLETED' || current.fulfillmentStatus === 'SIGNED') {
    return '该订单已完成或已签收：修改客户或出单信息不会改变已发生的物流、装柜与对账事实。'
  }
  return null
})

function emptyCustomerForm(): CustomerFormState {
  return {
    name: '',
    phone: '',
    fbName: '',
    lineName: '',
    region: { countryRegionId: null, provinceStateId: null, cityId: null },
    addressDetail: '',
    reason: '',
  }
}

function emptySalesForm(): SalesInfoFormState {
  return { orderDate: '', remark: '', reason: '' }
}

function applyContext(next: SalesOrderEditContextDto): void {
  context.value = next
  customerForm.value = {
    ...createSalesOrderCustomerDraft(next),
    reason: '',
  }
  salesForm.value = {
    ...createSalesOrderSalesInfoDraft(next),
    reason: '',
  }
  customerErrors.value = {}
  salesErrors.value = {}
  customerActionError.value = null
  salesActionError.value = null
  customerConflict.value = false
  salesConflict.value = false
}

function cancelRequests(): void {
  requestVersion += 1
  loadController?.abort()
  customerController?.abort()
  salesController?.abort()
  loadController = null
  customerController = null
  salesController = null
}

async function loadContext(): Promise<void> {
  const orderId = props.order?.id
  if (!props.modelValue || orderId === undefined) {
    return
  }

  cancelRequests()
  const version = requestVersion
  const controller = new AbortController()
  loadController = controller
  loading.value = true
  loadError.value = null
  try {
    const response = await salesOrdersApi.editContext(orderId, controller.signal)
    if (controller.signal.aborted || version !== requestVersion || props.order?.id !== orderId) {
      return
    }
    applyContext(response.data)
  }
  catch (error) {
    if (controller.signal.aborted || isSalesOrderApiAbort(error)) {
      return
    }
    loadError.value = getSalesOrderApiFailure(error).message
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
      if (loadController === controller) {
        loadController = null
      }
    }
  }
}

function isSalesOrderApiAbort(error: unknown): boolean {
  return isSalesOrderAbortError(error)
}

function applyServerFieldErrors(
  target: Record<string, string>,
  fieldErrors: Readonly<Record<string, string>>,
): void {
  Object.assign(target, fieldErrors)
}

function setVisible(value: boolean): void {
  if (!value) {
    cancelRequests()
    loading.value = false
    loadError.value = null
    context.value = null
    customerSubmitting.value = false
    salesSubmitting.value = false
  }
  visible.value = value
}

function handleRegionChange(change: RegionSelectorChange): void {
  customerForm.value.region = { ...change.value }
  delete customerErrors.value['customer.cityId']
}

async function submitCustomer(): Promise<void> {
  const current = context.value
  const order = props.order
  if (current === null || order === null || customerSubmitting.value) {
    return
  }
  const built = buildSalesOrderCustomerUpdatePayload(current, customerForm.value)
  if (!built.valid) {
    customerErrors.value = { ...built.fieldErrors }
    return
  }
  customerErrors.value = {}
  customerActionError.value = null
  customerConflict.value = false
  const controller = new AbortController()
  customerController = controller
  customerSubmitting.value = true
  const authEpochBefore = useAppAccountStore().authEpoch
  try {
    const response = await salesOrdersApi.updateCustomer(order.id, built.request, controller.signal)
    if (controller.signal.aborted || props.order?.id !== order.id) {
      return
    }
    if (useAppAccountStore().authEpoch !== authEpochBefore) {
      return
    }
    applyContext(response.data)
    toast.success('客户信息已保存')
    emit('saved', 'customer')
  }
  catch (error) {
    if (controller.signal.aborted || isSalesOrderApiAbort(error)) {
      return
    }
    const failure = getSalesOrderApiFailure(error)
    customerActionError.value = failure.message
    customerConflict.value = failure.code === 'SALES_ORDER_EDIT_VERSION_CONFLICT'
    applyServerFieldErrors(customerErrors.value, failure.fieldErrors)
  }
  finally {
    if (customerController === controller) {
      customerController = null
    }
    customerSubmitting.value = false
  }
}

async function submitSalesInfo(): Promise<void> {
  const current = context.value
  const order = props.order
  if (current === null || order === null || salesSubmitting.value) {
    return
  }
  const built = buildSalesOrderSalesInfoUpdatePayload(current, salesForm.value)
  if (!built.valid) {
    salesErrors.value = { ...built.fieldErrors }
    return
  }
  salesErrors.value = {}
  salesActionError.value = null
  salesConflict.value = false
  const controller = new AbortController()
  salesController = controller
  salesSubmitting.value = true
  const authEpochBefore = useAppAccountStore().authEpoch
  try {
    const response = await salesOrdersApi.updateSalesInfo(order.id, built.request, controller.signal)
    if (controller.signal.aborted || props.order?.id !== order.id) {
      return
    }
    if (useAppAccountStore().authEpoch !== authEpochBefore) {
      return
    }
    applyContext(response.data)
    toast.success('出单信息已保存')
    emit('saved', 'salesInfo')
  }
  catch (error) {
    if (controller.signal.aborted || isSalesOrderApiAbort(error)) {
      return
    }
    const failure = getSalesOrderApiFailure(error)
    salesActionError.value = failure.message
    salesConflict.value = failure.code === 'SALES_ORDER_EDIT_VERSION_CONFLICT'
    applyServerFieldErrors(salesErrors.value, failure.fieldErrors)
  }
  finally {
    if (salesController === controller) {
      salesController = null
    }
    salesSubmitting.value = false
  }
}

function openProducts(): void {
  if (productBlockedReason.value !== null) {
    toast.info(productBlockedReason.value)
    return
  }
  emit('openProducts')
}

watch(
  () => [props.modelValue, props.order?.id] as const,
  ([open]) => {
    if (!open) {
      cancelRequests()
      context.value = null
      return
    }
    activeTab.value = 'customer'
    void loadContext()
  },
  { immediate: true },
)
</script>

<template>
  <QsGenericModal
    :model-value="visible"
    :title="title"
    description="客户信息、出单信息与产品修改集中在此维护；三个页签各自独立保存。"
    size="xl"
    :loading="loading"
    :error="loadError"
    :submitting="customerSubmitting || salesSubmitting"
    :dismiss-on-overlay="!customerSubmitting && !salesSubmitting"
    :dismiss-on-escape="!customerSubmitting && !salesSubmitting"
    @update:model-value="setVisible"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:file-pen-line" class="size-4" aria-hidden="true" />
    </template>

    <template #error-actions>
      <FaButton type="button" variant="outline" @click="loadContext">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
        重新加载
      </FaButton>
    </template>

    <div v-if="context" class="space-y-4">
      <FaAlert
        v-if="historyRiskHint"
        variant="default"
        icon="i-lucide:info"
        :description="historyRiskHint"
      />
      <p class="qs-type-meta text-muted-foreground m-0">
        订单 {{ context.orderNo }} · 版本 v{{ context.version }}（每次保存递增，其他页面需刷新后再改）
      </p>

      <FaTabs v-model="activeTab" :list="tabs" list-class="h-auto min-h-11 w-full" content-class="mt-4 min-w-0">
        <template #customer>
          <div class="space-y-4">
            <section class="p-4 border border-border rounded-lg gap-4 grid md:grid-cols-2">
              <div class="min-w-0">
                <label for="sales-order-edit-customer-name" class="text-sm font-medium block">客户姓名（最多 24 字）</label>
                <FaInput
                  id="sales-order-edit-customer-name"
                  v-model="customerForm.name"
                  maxlength="24"
                  class="mt-1.5 w-full"
                  :disabled="customerSubmitting"
                  @update:model-value="delete customerErrors['customer.name']"
                />
                <p v-if="customerErrors['customer.name']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ customerErrors['customer.name'] }}
                </p>
              </div>
              <div class="min-w-0">
                <label for="sales-order-edit-customer-phone" class="text-sm font-medium block">客户电话</label>
                <FaInput
                  id="sales-order-edit-customer-phone"
                  v-model="customerForm.phone"
                  maxlength="64"
                  class="mt-1.5 w-full"
                  :disabled="customerSubmitting"
                  @update:model-value="delete customerErrors['customer.phone']"
                />
                <p v-if="customerErrors['customer.phone']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ customerErrors['customer.phone'] }}
                </p>
              </div>
              <div class="min-w-0">
                <label for="sales-order-edit-customer-fb" class="text-sm font-medium block">客户FB名称（选填）</label>
                <FaInput
                  id="sales-order-edit-customer-fb"
                  v-model="customerForm.fbName"
                  maxlength="128"
                  class="mt-1.5 w-full"
                  :disabled="customerSubmitting"
                  @update:model-value="delete customerErrors['customer.fbName']"
                />
                <p v-if="customerErrors['customer.fbName']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ customerErrors['customer.fbName'] }}
                </p>
              </div>
              <div class="min-w-0">
                <label for="sales-order-edit-customer-line" class="text-sm font-medium block">客户LINE名称（选填）</label>
                <FaInput
                  id="sales-order-edit-customer-line"
                  v-model="customerForm.lineName"
                  maxlength="128"
                  class="mt-1.5 w-full"
                  :disabled="customerSubmitting"
                  @update:model-value="delete customerErrors['customer.lineName']"
                />
                <p v-if="customerErrors['customer.lineName']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ customerErrors['customer.lineName'] }}
                </p>
              </div>
              <div class="min-w-0 md:col-span-2">
                <span class="text-sm font-medium block">三级地区</span>
                <QsRegionSelector
                  v-model="customerForm.region"
                  class="mt-1.5"
                  name="customerCityId"
                  required
                  :disabled="customerSubmitting"
                  @change="handleRegionChange"
                />
                <p v-if="customerErrors['customer.cityId']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ customerErrors['customer.cityId'] }}
                </p>
              </div>
              <div class="min-w-0 md:col-span-2">
                <label for="sales-order-edit-customer-address" class="text-sm font-medium block">详细地址</label>
                <FaTextarea
                  id="sales-order-edit-customer-address"
                  v-model="customerForm.addressDetail"
                  maxlength="1000"
                  class="mt-1.5 w-full"
                  :disabled="customerSubmitting"
                  @update:model-value="delete customerErrors['customer.addressDetail']"
                />
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  保存时会移除全部空白，并按三级地区重新拼接完整地址；请勿重复填写已选地区。
                </p>
                <p v-if="customerErrors['customer.addressDetail']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ customerErrors['customer.addressDetail'] }}
                </p>
              </div>
              <div class="min-w-0 md:col-span-2">
                <label for="sales-order-edit-customer-reason" class="text-sm font-medium block">修改原因（必填，进入变更记录与审计）</label>
                <FaTextarea
                  id="sales-order-edit-customer-reason"
                  v-model="customerForm.reason"
                  maxlength="500"
                  input-class="min-h-16"
                  class="mt-1.5 w-full"
                  :disabled="customerSubmitting"
                  @update:model-value="delete customerErrors.reason"
                />
                <p v-if="customerErrors.reason" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ customerErrors.reason }}
                </p>
              </div>
              <p class="qs-type-meta text-amber-700 m-0 dark:text-amber-300 md:col-span-2">
                客户姓名会同步出现在采购唛头、对账单与后续通知；已打印标签与已生成的凭证标题不会改变。
              </p>
            </section>
            <FaAlert
              v-if="customerActionError"
              variant="destructive"
              :title="customerActionError"
            >
              <template v-if="customerConflict" #description>
                <FaButton variant="outline" @click="loadContext">
                  重新加载最新数据
                </FaButton>
              </template>
            </FaAlert>
          </div>
        </template>

        <template #salesInfo>
          <div class="space-y-4">
            <section class="p-4 border border-border rounded-lg gap-4 grid md:grid-cols-2">
              <div class="min-w-0">
                <span class="text-sm font-medium block">出单日期</span>
                <QsDateTimeField
                  v-model="salesForm.orderDate"
                  class="mt-1.5 w-full"
                  precision="date"
                  disable-future
                  :disabled="salesSubmitting"
                  aria-label="出单日期"
                  @change="delete salesErrors.orderDate"
                />
                <p v-if="salesErrors.orderDate" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ salesErrors.orderDate }}
                </p>
              </div>
              <div class="min-w-0">
                <span class="text-sm font-medium block">当前订单</span>
                <p class="qs-type-body-medium m-0 mt-1.5">
                  {{ context.orderNo }} · v{{ context.version }}
                </p>
              </div>
              <div class="min-w-0 md:col-span-2">
                <label for="sales-order-edit-sales-remark" class="text-sm font-medium block">订单备注（留空即清空）</label>
                <FaTextarea
                  id="sales-order-edit-sales-remark"
                  v-model="salesForm.remark"
                  maxlength="1000"
                  input-class="min-h-20"
                  class="mt-1.5 w-full"
                  :disabled="salesSubmitting"
                  @update:model-value="delete salesErrors.remark"
                />
                <p v-if="salesErrors.remark" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ salesErrors.remark }}
                </p>
              </div>
              <div class="min-w-0 md:col-span-2">
                <label for="sales-order-edit-sales-reason" class="text-sm font-medium block">修改原因（必填，进入变更记录与审计）</label>
                <FaTextarea
                  id="sales-order-edit-sales-reason"
                  v-model="salesForm.reason"
                  maxlength="500"
                  input-class="min-h-16"
                  class="mt-1.5 w-full"
                  :disabled="salesSubmitting"
                  @update:model-value="delete salesErrors.reason"
                />
                <p v-if="salesErrors.reason" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ salesErrors.reason }}
                </p>
              </div>
              <p class="qs-type-meta text-muted-foreground m-0 md:col-span-2">
                修改出单日期只影响列表的日期筛选与展示，不会改变已生成的凭证、对账与通知；定金与尾款拆分仍通过收款记录维护。
              </p>
            </section>
            <FaAlert
              v-if="salesActionError"
              variant="destructive"
              :title="salesActionError"
            >
              <template v-if="salesConflict" #description>
                <FaButton variant="outline" @click="loadContext">
                  重新加载最新数据
                </FaButton>
              </template>
            </FaAlert>
          </div>
        </template>

        <template #products>
          <section class="p-4 border border-border rounded-lg space-y-3">
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <div class="min-w-0">
                <p class="qs-type-component-title m-0">
                  产品与金额修改
                </p>
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  产品修改会同时重算金额、付款状态与采购覆盖，并通过独立的复核弹窗确认。
                </p>
              </div>
              <FaButton
                type="button"
                :disabled="productBlockedReason !== null || customerSubmitting || salesSubmitting"
                @click="openProducts"
              >
                <FaIcon name="i-lucide:list-restart" class="size-4" aria-hidden="true" />
                打开产品编辑器
              </FaButton>
            </div>
            <p v-if="productBlockedReason" class="qs-type-meta text-muted-foreground m-0" role="status">
              {{ productBlockedReason }}
            </p>
          </section>
        </template>
      </FaTabs>
    </div>

    <template #footer>
      <div class="flex flex-col gap-2 w-full sm:flex-row sm:items-center sm:justify-end">
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 sm:min-h-9"
          :disabled="customerSubmitting || salesSubmitting"
          @click="setVisible(false)"
        >
          关闭
        </FaButton>
        <FaButton
          v-if="activeTab === 'customer'"
          type="button"
          class="min-h-11 sm:min-h-9"
          :loading="customerSubmitting"
          :disabled="customerSubmitting || loading || context === null || !customerChanged"
          @click="submitCustomer"
        >
          保存客户信息
        </FaButton>
        <FaButton
          v-else-if="activeTab === 'salesInfo'"
          type="button"
          class="min-h-11 sm:min-h-9"
          :loading="salesSubmitting"
          :disabled="salesSubmitting || loading || context === null || !salesInfoChanged"
          @click="submitSalesInfo"
        >
          保存出单信息
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
