<script setup lang="ts">
import type { SalesOrderEditTab } from './sales-order-edit.logic'
import type {
  SalesOrderEditContextDto,
  SalesOrderListItemDto,
  SalesOrderProductEditContextDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { OrderProductLineModel } from '@/components/business/QsOrderProductLineEditor/types'
import type { ProductPageLoader } from '@/components/business/QsProductSelector/types'
import type { RegionSelectorChange, RegionSelectorValue } from '@/components/business/QsRegionSelector/types'
import type {
  SalesOrderProductEditIntent,
  SalesOrderProductEditModalContext,
} from '@/components/business/QsSalesOrderProductsEditorModal/types'

import salesOrdersApi from '@/api/modules/sales-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDateTimeField from '@/components/business/QsDateTimeField/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsRegionSelector from '@/components/business/QsRegionSelector/index.vue'
import { createSalesOrderProductEditLines, reconcileSalesOrderProductEditLines } from '@/components/business/QsSalesOrderProductsEditorModal/logic'
import QsSalesOrderProductsEditorPanel from '@/components/business/QsSalesOrderProductsEditorModal/Panel.vue'
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
  currencies: readonly CurrencyDescriptor[]
}>()

const emit = defineEmits<{
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
const productContext = shallowRef<SalesOrderProductEditModalContext | null>(null)
const productLines = ref<readonly OrderProductLineModel[]>([])
const productReason = ref('客户调整产品')
const productLoading = ref(false)
const productSubmitting = ref(false)
const productError = ref<string | null>(null)
let productLoaded = false
let loadController: AbortController | null = null
let infoController: AbortController | null = null
let productAbortController: AbortController | null = null
let productSubmitAbortController: AbortController | null = null
let requestVersion = 0

const tabs = [
  { value: 'info', label: '订单信息' },
  { value: 'products', label: '产品' },
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

function handleTabChange(value: string): void {
  activeTab.value = value === 'products' ? 'products' : 'info'
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

function resetProductState(): void {
  productAbortController?.abort()
  productSubmitAbortController?.abort()
  productAbortController = null
  productSubmitAbortController = null
  productContext.value = null
  productLines.value = []
  productReason.value = '客户调整产品'
  productLoading.value = false
  productSubmitting.value = false
  productError.value = null
  productLoaded = false
}

function copyProductContext(
  context: SalesOrderProductEditContextDto,
): SalesOrderProductEditModalContext {
  return {
    ...context,
    salesOrder: { ...context.salesOrder },
    amounts: { ...context.amounts },
    existingLines: context.existingLines.map(line => ({
      ...line,
      mainImage: line.mainImage ?? null,
    })),
  }
}

/** 产品上下文首次切到产品页签时才加载；非海运前订单由资格判断提前拦住，不会产生 422。 */
async function loadProductContext(preserveDraft = false): Promise<void> {
  const orderId = props.order?.id
  if (orderId === undefined || productBlockedReason.value !== null) {
    return
  }
  productAbortController?.abort()
  const controller = new AbortController()
  productAbortController = controller
  productLoading.value = true
  productError.value = null
  const previousContext = productContext.value
  const previousLines = productLines.value
  try {
    const response = await salesOrdersApi.productEditContext(orderId, controller.signal)
    if (controller.signal.aborted || props.order?.id !== orderId) {
      return
    }
    const nextContext = copyProductContext(response.data)
    productContext.value = nextContext
    productLines.value = preserveDraft && previousContext !== null
      ? reconcileSalesOrderProductEditLines({
          previousContext,
          nextContext,
          previousLines,
        })
      : createSalesOrderProductEditLines(nextContext)
    productLoaded = true
  }
  catch (error) {
    if (controller.signal.aborted || isSalesOrderAbortError(error)) {
      return
    }
    const failure = getSalesOrderApiFailure(error)
    productError.value = failure.requestId === undefined
      ? failure.message
      : `${failure.message}（requestId: ${failure.requestId}）`
  }
  finally {
    if (productAbortController === controller) {
      productAbortController = null
      productLoading.value = false
    }
  }
}

const loadProductProducts: ProductPageLoader = async (query, signal) => {
  const orderId = props.order?.id
  if (orderId === undefined || query.currencyCode === 'CNY') {
    return {
      items: [],
      categories: [],
      unclassifiedCount: 0,
      page: query.page,
      pageSize: query.pageSize,
      total: 0,
    }
  }
  const response = await salesOrdersApi.productEditOptions(orderId, {
    ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
    supplierValue: query.supplierValue,
    ...(query.categoryName === undefined ? {} : { categoryName: query.categoryName }),
    ...(query.productHeadName === undefined ? {} : { productHeadName: query.productHeadName }),
    ...(query.unclassified === true ? { unclassified: true } : {}),
    page: query.page,
    pageSize: query.pageSize,
  }, signal)
  return {
    ...response.data,
    items: response.data.items.map(item => ({
      ...item,
      mainImage: item.mainImage ?? null,
    })),
  }
}

/**
 * 产品保存会改变金额、付款与履约状态：这里只同步壳层上下文里的版本与状态，
 * 保留订单信息页签未保存的草稿，再重拉产品上下文让面板回到最新基线。
 */
async function submitProduct(intent: SalesOrderProductEditIntent): Promise<void> {
  const orderId = props.order?.id
  if (orderId === undefined || productSubmitting.value) {
    return
  }
  productSubmitAbortController?.abort()
  const controller = new AbortController()
  productSubmitAbortController = controller
  productSubmitting.value = true
  productError.value = null
  try {
    const response = await salesOrdersApi.updateProducts(orderId, {
      expectedVersion: intent.expectedVersion,
      reason: intent.reason,
      confirmDepositReduction: intent.confirmDepositReduction,
      existingLines: intent.existingLines.map(line => ({ ...line })),
      newLines: intent.newLines.map(line => ({ ...line })),
    }, controller.signal)
    if (controller.signal.aborted || props.order?.id !== orderId) {
      return
    }
    const current = context.value
    if (current !== null) {
      context.value = {
        ...current,
        version: response.data.version,
        fulfillmentStatus: response.data.fulfillmentStatus,
        paymentStatus: response.data.paymentStatus,
      }
    }
    toast.success('销售订单产品已更新')
    emit('saved')
    await loadProductContext()
  }
  catch (error) {
    if (controller.signal.aborted || isSalesOrderAbortError(error)) {
      return
    }
    const failure = getSalesOrderApiFailure(error)
    productError.value = failure.requestId === undefined
      ? failure.message
      : `${failure.message}（requestId: ${failure.requestId}）`
  }
  finally {
    if (productSubmitAbortController === controller) {
      productSubmitAbortController = null
    }
    productSubmitting.value = false
  }
}

// 上下文与页签都可能后到：用户在订单上下文加载完成前切到产品页签时，
// 等上下文到达后再补一次懒加载，避免页签停在空白。
watch([activeTab, () => context.value], ([tab]) => {
  if (
    tab === 'products'
    && context.value !== null
    && productBlockedReason.value === null
    && !productLoaded
    && !productLoading.value
  ) {
    void loadProductContext()
  }
})

watch(
  () => [props.modelValue, props.order?.id] as const,
  ([open]) => {
    if (!open) {
      cancelRequests()
      resetProductState()
      context.value = null
      return
    }
    activeTab.value = 'info'
    resetProductState()
    void loadContext()
  },
  { immediate: true },
)
</script>

<template>
  <QsGenericModal
    :model-value="visible"
    :title="title"
    description="客户与出单信息一次保存；产品修改在产品页签内复核后提交。"
    size="3xl"
    class="sm:!max-w-[90rem] sm:!w-[calc(100%-3rem)]"
    :loading="loading"
    :error="loadError"
    :submitting="infoSubmitting || productSubmitting"
    :dismiss-on-overlay="!infoSubmitting && !productSubmitting"
    :dismiss-on-escape="!infoSubmitting && !productSubmitting"
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

      <QsStatusSwitchToolbar
        :model-value="activeTab"
        :items="tabs"
        aria-label="订单编辑页签"
        stretch
        @update:model-value="handleTabChange"
      />
      <div v-if="activeTab === 'info'" class="mt-4 min-w-0 space-y-4">
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

      <div v-else class="mt-4 min-w-0 space-y-4">
        <FaAlert
          v-if="productBlockedReason"
          variant="default"
          icon="i-lucide:info"
          :description="productBlockedReason"
        />
        <template v-else>
          <div v-if="productLoading" role="status" class="space-y-4">
            <span class="sr-only">正在加载产品编辑数据</span>
            <div v-for="n in 3" :key="n" class="rounded-lg bg-muted h-24 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
          </div>
          <FaAlert
            v-else-if="productError"
            variant="destructive"
            :title="productError"
          >
            <template #description>
              <FaButton variant="outline" @click="loadProductContext(true)">
                重新加载产品数据
              </FaButton>
            </template>
          </FaAlert>
          <QsSalesOrderProductsEditorPanel
            v-else
            :context="productContext"
            :lines="productLines"
            :reason="productReason"
            :currencies="currencies"
            :load-products="loadProductProducts"
            :submitting="productSubmitting"
            :show-cancel="false"
            @confirm="submitProduct"
            @validation-error="toast.warning($event)"
            @update:lines="productLines = $event"
            @update:reason="productReason = $event"
          />
        </template>
      </div>
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
