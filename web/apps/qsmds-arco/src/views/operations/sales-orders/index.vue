<script setup lang="ts">
import type { SalesOrderListItemDto } from '@/api/generated/types.gen'
import type { SalesOrderListQuery } from '@/api/modules/sales-orders'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import salesOrdersApi from '@/api/modules/sales-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'

defineOptions({ name: 'OperationsSalesOrders' })

const router = useRouter()
const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()

const canRead = computed(() => auth('sales-orders:read'))
const canCreate = computed(() => auth('sales-orders:create'))
const rows = ref<SalesOrderListItemDto[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const searchKeyword = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const loading = ref(false)
const listError = ref('')
const requestId = ref<string>()
const currencyModalVisible = ref(false)
const selectedCurrency = ref<'TWD' | 'MYR' | null>(null)
let requestVersion = 0
let listAbortController: AbortController | null = null
let queryRefreshPending = false

const availableOrderCurrencies = computed(() => currencyCatalog.selectableCurrencies.value.filter(
  currency => currency.code === 'TWD' || currency.code === 'MYR',
))
const currencyOptions = computed(() => [
  { disabled: true, label: '请选择币种', value: '__sales_order_currency_empty__' },
  ...availableOrderCurrencies.value.map(currency => ({
    label: `${currency.code} · ${currency.name}`,
    value: currency.code,
  })),
])
// FaFormItem 依赖 FaForm 提供的表单上下文；弹窗虽然只有一个字段，也不能省略该容器。
const currencyFormModel = computed(() => ({
  salesOrderCurrency: selectedCurrency.value ?? '__sales_order_currency_empty__',
}))
const currencySelectionUnavailable = computed(() => (
  currencyCatalog.loading.value
  || currencyCatalog.errorMessage.value !== null
  || availableOrderCurrencies.value.length === 0
))
const listErrorDisplay = computed(() => requestId.value === undefined
  ? listError.value || undefined
  : `${listError.value}（requestId: ${requestId.value}）`)

const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'currencyCode',
    label: '订单币种',
    options: [
      { label: 'TWD', value: 'TWD' },
      { label: 'MYR', value: 'MYR' },
    ],
    placeholder: '选择订单币种',
  },
  {
    key: 'orderStatus',
    label: '订单状态',
    options: [
      { label: '草稿', value: 'DRAFT' },
      { label: '已确认', value: 'CONFIRMED' },
      { label: '已取消', value: 'CANCELLED' },
    ],
    placeholder: '选择订单状态',
  },
  {
    key: 'fulfillmentStatus',
    label: '履约状态',
    options: [
      { label: '待处理', value: 'PENDING' },
      { label: '备货中', value: 'PREPARING' },
      { label: '已发货', value: 'SHIPPED' },
      { label: '已签收', value: 'SIGNED' },
    ],
    placeholder: '选择履约状态',
  },
  {
    key: 'paymentStatus',
    label: '付款状态',
    options: [
      { label: '未付款', value: 'UNPAID' },
      { label: '部分付款', value: 'PARTIALLY_PAID' },
      { label: '已付清', value: 'PAID' },
    ],
    placeholder: '选择付款状态',
  },
]

const columns: QsGenericTableColumn<SalesOrderListItemDto>[] = [
  { accessorKey: 'orderNo', id: 'orderNo', fixed: 'left', minWidth: 190, title: '订单编号' },
  { accessorKey: 'orderDate', id: 'orderDate', width: 130, title: '出单日期' },
  { accessorKey: 'customerName', id: 'customerName', minWidth: 140, title: '客户姓名' },
  { accessorKey: 'customerPhone', id: 'customerPhone', minWidth: 160, title: '客户电话' },
  { accessorKey: 'customerCityName', id: 'customerCityName', minWidth: 130, title: '销售地区' },
  { accessorKey: 'currencyCode', id: 'currencyCode', width: 100, title: '币种' },
  { accessorKey: 'agreedTotalAmount', id: 'agreedTotalAmount', align: 'right', minWidth: 160, title: '销售总价' },
  { accessorKey: 'receivedAmount', id: 'receivedAmount', align: 'right', minWidth: 150, title: '已收款' },
  { accessorKey: 'outstandingAmount', id: 'outstandingAmount', align: 'right', minWidth: 150, title: '待收款' },
  { accessorKey: 'orderStatus', id: 'orderStatus', width: 120, title: '订单状态' },
  { accessorKey: 'fulfillmentStatus', id: 'fulfillmentStatus', width: 120, title: '履约状态' },
  { accessorKey: 'paymentStatus', id: 'paymentStatus', width: 120, title: '付款状态' },
  { accessorFn: item => item.issuer.displayName, id: 'issuer', minWidth: 140, title: '出单人' },
]

function enumFilter<T extends string>(
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = filters.value[key]
  return typeof value === 'string' && allowed.includes(value as T)
    ? value as T
    : undefined
}

function buildListQuery(): SalesOrderListQuery {
  const keyword = searchKeyword.value.trim().normalize('NFKC')
  const currencyCode = enumFilter('currencyCode', ['TWD', 'MYR'] as const)
  const orderStatus = enumFilter('orderStatus', ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const)
  const fulfillmentStatus = enumFilter(
    'fulfillmentStatus',
    ['PENDING', 'PREPARING', 'SHIPPED', 'SIGNED'] as const,
  )
  const paymentStatus = enumFilter(
    'paymentStatus',
    ['UNPAID', 'PARTIALLY_PAID', 'PAID'] as const,
  )
  return {
    page: page.value,
    pageSize: pageSize.value,
    ...(keyword === '' ? {} : { keyword }),
    ...(currencyCode === undefined ? {} : { currencyCode }),
    ...(orderStatus === undefined ? {} : { orderStatus }),
    ...(fulfillmentStatus === undefined ? {} : { fulfillmentStatus }),
    ...(paymentStatus === undefined ? {} : { paymentStatus }),
  }
}

async function loadOrders(): Promise<void> {
  if (!canRead.value) {
    return
  }
  listAbortController?.abort()
  const controller = new AbortController()
  listAbortController = controller
  const version = ++requestVersion
  const authEpoch = appAccountStore.authEpoch
  loading.value = true
  listError.value = ''
  requestId.value = undefined
  try {
    const response = await salesOrdersApi.list(buildListQuery(), controller.signal)
    if (
      controller.signal.aborted
      || version !== requestVersion
      || authEpoch !== appAccountStore.authEpoch
      || !canRead.value
    ) {
      return
    }
    rows.value = response.data.items.map(item => ({ ...item, issuer: { ...item.issuer } }))
    page.value = response.data.page
    pageSize.value = response.data.pageSize
    total.value = response.data.total
  }
  catch (error) {
    if (isSalesOrderAbortError(error) || version !== requestVersion) {
      return
    }
    const failure = getSalesOrderApiFailure(error)
    listError.value = failure.message
    requestId.value = failure.requestId
  }
  finally {
    if (version === requestVersion) {
      loading.value = false
    }
  }
}

function scheduleQueryRefresh(): void {
  if (queryRefreshPending) {
    return
  }
  queryRefreshPending = true
  queueMicrotask(() => {
    queryRefreshPending = false
    void loadOrders()
  })
}

function openCurrencyModal(): void {
  selectedCurrency.value = null
  currencyModalVisible.value = true
}

function updateSelectedCurrency(value: unknown): void {
  selectedCurrency.value = value === 'TWD' || value === 'MYR' ? value : null
}

function enterCreatePage(): void {
  if (selectedCurrency.value === null) {
    return
  }
  currencyModalVisible.value = false
  void router.push({
    name: 'operationsSalesOrderCreate',
    query: { currency: selectedCurrency.value },
  })
}

function handleSearch(): void {
  page.value = 1
  scheduleQueryRefresh()
}

function handleFilterChange(value: QsGenericTableFilterValues): void {
  filters.value = { ...value }
  page.value = 1
  scheduleQueryRefresh()
}

function handlePaginationChange(): void {
  scheduleQueryRefresh()
}

function orderStatusLabel(value: SalesOrderListItemDto['orderStatus']): string {
  return { DRAFT: '草稿', CONFIRMED: '已确认', CANCELLED: '已取消' }[value]
}

function fulfillmentStatusLabel(value: SalesOrderListItemDto['fulfillmentStatus']): string {
  return { PENDING: '待处理', PREPARING: '备货中', SHIPPED: '已发货', SIGNED: '已签收' }[value]
}

function paymentStatusLabel(value: SalesOrderListItemDto['paymentStatus']): string {
  return { UNPAID: '未付款', PARTIALLY_PAID: '部分付款', PAID: '已付清' }[value]
}

onMounted(() => void loadOrders())
onBeforeUnmount(() => {
  requestVersion += 1
  listAbortController?.abort()
})
</script>

<template>
  <div class="sales-order-list-page min-w-0" data-testid="sales-order-list-page">
    <FaPageHeader
      title="销售订单"
      description="订单、履约与付款状态独立展示；实际收款与定金/尾款分开统计。"
    >
      <FaButton
        v-if="canCreate"
        type="button"
        class="min-h-11 sm:min-h-9"
        @click="openCurrencyModal"
      >
        <FaIcon name="i-lucide:plus" aria-hidden="true" />新增销售订单
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="!canRead">
      <FaEmpty
        icon="i-lucide:shield-alert"
        title="无权读取销售订单"
        description="当前身份缺少 sales-orders:read 权限。"
        class="py-12"
      />
    </FaPageMain>

    <FaPageMain v-else class="min-w-0">
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="searchKeyword"
        v-model:filters="filters"
        data-testid="sales-order-list-table"
        :row-key="item => item.id"
        :addable="false"
        :columns="columns"
        :data="rows"
        empty-title="暂无销售订单"
        empty-description="当前没有可展示的销售订单。"
        :error="listErrorDisplay"
        :filter-definitions="filterDefinitions"
        :loading="loading"
        :page-size-options="[20, 50, 100]"
        search-placeholder="搜索订单编号、客户姓名或电话"
        :searchable="true"
        :show-column-settings="true"
        :total="total"
        table-class="min-w-[1840px]"
        @filter-change="handleFilterChange"
        @pagination-change="handlePaginationChange"
        @retry="loadOrders"
        @search="handleSearch"
      >
        <template #cell-orderNo="{ row }">
          <span class="qs-type-data-emphasis font-mono">{{ row.original.orderNo }}</span>
        </template>
        <template #cell-currencyCode="{ row }">
          <span class="font-mono">{{ row.original.currencyCode }}</span>
        </template>
        <template #cell-agreedTotalAmount="{ row }">
          <AmountDisplay
            :value="row.original.agreedTotalAmount"
            :currency="row.original.currencyCode"
            :currencies="currencyCatalog.currencies.value"
          />
        </template>
        <template #cell-receivedAmount="{ row }">
          <AmountDisplay
            :value="row.original.receivedAmount"
            :currency="row.original.currencyCode"
            :currencies="currencyCatalog.currencies.value"
          />
        </template>
        <template #cell-outstandingAmount="{ row }">
          <AmountDisplay
            :value="row.original.outstandingAmount"
            :currency="row.original.currencyCode"
            :currencies="currencyCatalog.currencies.value"
          />
        </template>
        <template #cell-orderStatus="{ row }">
          <FaTag variant="outline" class="qs-type-status-tag">
            {{ orderStatusLabel(row.original.orderStatus) }}
          </FaTag>
        </template>
        <template #cell-fulfillmentStatus="{ row }">
          <FaTag variant="outline" class="qs-type-status-tag">
            {{ fulfillmentStatusLabel(row.original.fulfillmentStatus) }}
          </FaTag>
        </template>
        <template #cell-paymentStatus="{ row }">
          <FaTag variant="outline" class="qs-type-status-tag">
            {{ paymentStatusLabel(row.original.paymentStatus) }}
          </FaTag>
        </template>

        <template #mobile-row="{ row, rowNumber }">
          <div class="mb-4 pb-3 border-b border-border flex gap-3 items-start justify-between">
            <div class="min-w-0">
              <div class="qs-type-data-emphasis font-mono break-all">
                {{ row.orderNo }}
              </div>
              <div class="text-sm mt-1">
                {{ row.customerName }} · {{ row.customerCityName }}
              </div>
            </div>
            <span class="qs-type-meta shrink-0">#{{ rowNumber }}</span>
          </div>
          <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2">
            <div>
              <dt class="qs-type-compact-label">
                出单日期
              </dt><dd class="m-0">
                {{ row.orderDate }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                币种
              </dt><dd class="font-mono m-0">
                {{ row.currencyCode }}
              </dd>
            </div>
            <div class="col-span-2">
              <dt class="qs-type-compact-label">
                客户电话
              </dt><dd class="m-0 break-all">
                {{ row.customerPhone }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                订单状态
              </dt><dd class="m-0">
                {{ orderStatusLabel(row.orderStatus) }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                履约状态
              </dt><dd class="m-0">
                {{ fulfillmentStatusLabel(row.fulfillmentStatus) }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                付款状态
              </dt><dd class="m-0">
                {{ paymentStatusLabel(row.paymentStatus) }}
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label">
                待收款
              </dt><dd class="m-0">
                <AmountDisplay :value="row.outstandingAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
              </dd>
            </div>
          </dl>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <QsGenericModal
      v-model="currencyModalVisible"
      title="选择订单币种"
      description="一张订单只允许一个币种，进入新增页后不可切换。产品选择不限制币种，本单售价按订单币种填写。"
      size="sm"
    >
      <FaForm :model="currencyFormModel">
        <div class="gap-4 grid">
          <FaFormItem name="salesOrderCurrency" label="订单币种" required>
            <FaSelect
              :model-value="selectedCurrency ?? '__sales_order_currency_empty__'"
              :options="currencyOptions"
              class="w-full"
              :disabled="currencySelectionUnavailable"
              @update:model-value="updateSelectedCurrency"
            />
          </FaFormItem>
          <p v-if="currencyCatalog.loading.value" class="text-sm text-muted-foreground m-0" role="status">
            正在加载可用币种…
          </p>
          <FaAlert
            v-else-if="currencyCatalog.errorMessage.value"
            title="币种资料加载失败"
            :description="currencyCatalog.errorMessage.value"
            variant="destructive"
          />
          <FaAlert
            v-else-if="availableOrderCurrencies.length === 0"
            title="暂无可用销售币种"
            description="请先在基础资料中启用 TWD 或 MYR。"
            variant="destructive"
          />
        </div>
      </FaForm>
      <template #footer>
        <FaButton type="button" variant="outline" class="min-h-11 sm:min-h-9" @click="currencyModalVisible = false">
          取消
        </FaButton>
        <FaButton
          type="button"
          class="min-h-11 sm:min-h-9"
          :disabled="selectedCurrency === null || currencySelectionUnavailable"
          @click="enterCreatePage"
        >
          进入新增订单
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
