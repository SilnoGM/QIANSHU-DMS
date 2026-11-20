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
  buildSalesOrderInfoUpdatePayload,
  createSalesOrderInfoDraft,
  salesOrderInfoDraftChanged,
  salesOrderProductEditUnavailableReason,
} from './sales-order-edit.logic'

defineOptions({ name: 'SalesOrderEditModal' })

const props = defineProps<{
  modelValue: boolean
  order: SalesOrderListItemDto | null
}>()

const emit = defineEmits<{
  'openProducts': []
  'saved': []
  'update:modelValue': [value: boolean]
}>()

interface InfoFormState {
  name: string
  phone: string
  fbName: string
  lineName: string
  region: RegionSelectorValue
  addressDetail: string
  orderDate: string
  remark: string
  reason: string
}

const toast = useQsToast()
const context = shallowRef<SalesOrderEditContextDto | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)
const activeTab = ref<SalesOrderEditTab>('info')
const infoForm = ref<InfoFormState>(emptyInfoForm())
const infoErrors = ref<Record<string, string>>({})
const infoActionError = ref<string | null>(null)
const infoSubmitting = ref(false)
const infoConflict = ref(false)
let loadController: AbortController | null = null
let infoController: AbortController | null = null
let requestVersion = 0

const tabs = [
  { value: 'info', label: '订单信息', icon: 'i-lucide:file-pen-line' },
  { value: 'products', label: '产品', icon: 'i-lucide:package' },
]

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const title = computed(() => props.order === null
  ? '编辑销售订单'
  : `编辑销售订单 · ${props.order.orderNo}`)
const infoChanged = computed(() => context.value !== null
  && salesOrderInfoDraftChanged(context.value, infoForm.value))
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

function emptyInfoForm(): InfoFormState {
  return {
    name: '',
    phone: '',
    fbName: '',
    lineName: '',
    region: { countryRegionId: null, provinceStateId: null, cityId: null },
    addressDetail: '',
    orderDate: '',
    remark: '',
    reason: '',
  }
}

function applyContext(next: SalesOrderEditContextDto): void {
  context.value = next
  infoForm.value = {
    ...createSalesOrderInfoDraft(next),
    reason: '',
  }
  infoErrors.value = {}
  infoActionError.value = null
  infoConflict.value = false
}

function cancelRequests(): void {
  requestVersion += 1
  loadController?.abort()
  infoController?.abort()
  loadController = null
  infoController = null
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
    if (controller.signal.aborted || isSalesOrderAbortError(error)) {
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

function setVisible(value: boolean): void {
  if (!value) {
    cancelRequests()
    loading.value = false
    loadError.value = null
    context.value = null
    infoSubmitting.value = false
  }
  visible.value = value
}

function handleRegionChange(change: RegionSelectorChange): void {
  infoForm.value.region = { ...change.value }
  delete infoErrors.value['customer.cityId']
}

async function submitInfo(): Promise<void> {
  const current = context.value
  const order = props.order
  if (current === null || order === null || infoSubmitting.value) {
    return
  }
  const built = buildSalesOrderInfoUpdatePayload(current, infoForm.value)
  if (!built.valid) {
    infoErrors.value = { ...built.fieldErrors }
    return
  }
  infoErrors.value = {}
  infoActionError.value = null
  infoConflict.value = false
  const controller = new AbortController()
  infoController = controller
  infoSubmitting.value = true
  const authEpochBefore = useAppAccountStore().authEpoch
  try {
    const response = await salesOrdersApi.updateInfo(order.id, built.request, controller.signal)
    if (controller.signal.aborted || props.order?.id !== order.id) {
      return
    }
    if (useAppAccountStore().authEpoch !== authEpochBefore) {
      return
    }
    applyContext(response.data)
    toast.success('订单信息已保存')
    emit('saved')
  }
  catch (error) {
    if (controller.signal.aborted || isSalesOrderAbortError(error)) {
      return
    }
    const failure = getSalesOrderApiFailure(error)
    infoActionError.value = failure.message
    infoConflict.value = failure.code === 'SALES_ORDER_EDIT_VERSION_CONFLICT'
    Object.assign(infoErrors.value, failure.fieldErrors)
  }
  finally {
    if (infoController === controller) {
      infoController = null
    }
    infoSubmitting.value = false
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
    activeTab.value = 'info'
    void loadContext()
  },
  { immediate: true },
)
</script>

<template>
  <QsGenericModal
    :model-value="visible"
    :title="title"
    description="客户信息与出单信息一次保存；产品修改仍在独立的产品页签中复核后提交。"
    size="xl"
    :loading="loading"
    :error="loadError"
    :submitting="infoSubmitting"
    :dismiss-on-overlay="!infoSubmitting"
    :dismiss-on-escape="!infoSubmitting"
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
        <template #info>
          <div class="space-y-4">
            <section aria-label="客户信息" class="p-4 border border-border rounded-lg gap-4 grid md:grid-cols-2">
              <div class="min-w-0">
                <label for="sales-order-edit-customer-name" class="text-sm font-medium block">客户姓名（最多 24 字）</label>
                <FaInput
                  id="sales-order-edit-customer-name"
                  v-model="infoForm.name"
                  maxlength="24"
                  class="mt-1.5 w-full"
                  :disabled="infoSubmitting"
                  @update:model-value="delete infoErrors['customer.name']"
                />
                <p v-if="infoErrors['customer.name']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ infoErrors['customer.name'] }}
                </p>
              </div>
              <div class="min-w-0">
                <label for="sales-order-edit-customer-phone" class="text-sm font-medium block">客户电话</label>
                <FaInput
                  id="sales-order-edit-customer-phone"
                  v-model="infoForm.phone"
                  maxlength="64"
                  class="mt-1.5 w-full"
                  :disabled="infoSubmitting"
                  @update:model-value="delete infoErrors['customer.phone']"
                />
                <p v-if="infoErrors['customer.phone']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ infoErrors['customer.phone'] }}
                </p>
              </div>
              <div class="min-w-0">
                <label for="sales-order-edit-customer-fb" class="text-sm font-medium block">客户FB名称（选填）</label>
                <FaInput
                  id="sales-order-edit-customer-fb"
                  v-model="infoForm.fbName"
                  maxlength="128"
                  class="mt-1.5 w-full"
                  :disabled="infoSubmitting"
                  @update:model-value="delete infoErrors['customer.fbName']"
                />
                <p v-if="infoErrors['customer.fbName']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ infoErrors['customer.fbName'] }}
                </p>
              </div>
              <div class="min-w-0">
                <label for="sales-order-edit-customer-line" class="text-sm font-medium block">客户LINE名称（选填）</label>
                <FaInput
                  id="sales-order-edit-customer-line"
                  v-model="infoForm.lineName"
                  maxlength="128"
                  class="mt-1.5 w-full"
                  :disabled="infoSubmitting"
                  @update:model-value="delete infoErrors['customer.lineName']"
                />
                <p v-if="infoErrors['customer.lineName']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ infoErrors['customer.lineName'] }}
                </p>
              </div>
              <div class="min-w-0 md:col-span-2">
                <span class="text-sm font-medium block">三级地区</span>
                <QsRegionSelector
                  v-model="infoForm.region"
                  class="mt-1.5"
                  name="customerCityId"
                  required
                  :disabled="infoSubmitting"
                  @change="handleRegionChange"
                />
                <p v-if="infoErrors['customer.cityId']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ infoErrors['customer.cityId'] }}
                </p>
              </div>
              <div class="min-w-0 md:col-span-2">
                <label for="sales-order-edit-customer-address" class="text-sm font-medium block">详细地址</label>
                <FaTextarea
                  id="sales-order-edit-customer-address"
                  v-model="infoForm.addressDetail"
                  maxlength="1000"
                  class="mt-1.5 w-full"
                  :disabled="infoSubmitting"
                  @update:model-value="delete infoErrors['customer.addressDetail']"
                />
                <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                  保存时会移除全部空白，并按三级地区重新拼接完整地址；请勿重复填写已选地区。
                </p>
                <p v-if="infoErrors['customer.addressDetail']" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ infoErrors['customer.addressDetail'] }}
                </p>
              </div>
            </section>

            <section aria-label="出单信息" class="p-4 border border-border rounded-lg gap-4 grid md:grid-cols-2">
              <div class="min-w-0">
                <span class="text-sm font-medium block">出单日期</span>
                <QsDateTimeField
                  v-model="infoForm.orderDate"
                  class="mt-1.5 w-full"
                  precision="date"
                  disable-future
                  :disabled="infoSubmitting"
                  aria-label="出单日期"
                  @change="delete infoErrors.orderDate"
                />
                <p v-if="infoErrors.orderDate" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ infoErrors.orderDate }}
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
                  v-model="infoForm.remark"
                  maxlength="1000"
                  input-class="min-h-20"
                  class="mt-1.5 w-full"
                  :disabled="infoSubmitting"
                  @update:model-value="delete infoErrors.remark"
                />
                <p v-if="infoErrors.remark" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ infoErrors.remark }}
                </p>
              </div>
              <p class="qs-type-meta text-muted-foreground m-0 md:col-span-2">
                修改出单日期只影响列表的日期筛选与展示，不会改变已生成的凭证、对账与通知；定金与尾款拆分暂未提供页面入口，产品总额下降时系统会自动下调定金并要求确认。
              </p>
            </section>

            <section aria-label="修改原因" class="p-4 border border-border rounded-lg space-y-3">
              <div class="min-w-0">
                <label for="sales-order-edit-info-reason" class="text-sm font-medium block">修改原因（必填，进入变更记录与审计）</label>
                <FaTextarea
                  id="sales-order-edit-info-reason"
                  v-model="infoForm.reason"
                  maxlength="500"
                  input-class="min-h-16"
                  class="mt-1.5 w-full"
                  :disabled="infoSubmitting"
                  @update:model-value="delete infoErrors.reason"
                />
                <p v-if="infoErrors.reason" class="text-xs text-destructive m-0 mt-1" role="alert">
                  {{ infoErrors.reason }}
                </p>
              </div>
              <p class="qs-type-meta text-amber-700 m-0 dark:text-amber-300">
                客户姓名会同步出现在采购唛头、对账单与后续通知；已打印标签与已生成的凭证标题不会改变。
              </p>
            </section>

            <FaAlert
              v-if="infoActionError"
              variant="destructive"
              :title="infoActionError"
            >
              <template v-if="infoConflict" #description>
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
                :disabled="productBlockedReason !== null || infoSubmitting"
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
          :disabled="infoSubmitting"
          @click="setVisible(false)"
        >
          关闭
        </FaButton>
        <FaButton
          v-if="activeTab === 'info'"
          type="button"
          class="min-h-11 sm:min-h-9"
          :loading="infoSubmitting"
          :disabled="infoSubmitting || loading || context === null || !infoChanged"
          @click="submitInfo"
        >
          保存订单信息
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
