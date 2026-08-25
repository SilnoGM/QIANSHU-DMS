<script setup lang="ts">
import type { SalesOrderRecordsKind } from './sales-order-records-modal.logic'
import type {
  SalesOrderCurrencySummaryDto,
  SalesOrderLinePreviewDto,
  SalesOrderListItemDto,
} from '@/api/generated/types.gen'
import type { SalesOrderListQuery } from '@/api/modules/sales-orders'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'

import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'
import salesOrdersApi from '@/api/modules/sales-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsGoodTooltipContent from '@/components/business/QsGoodTooltip/QsGoodTooltipContent.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'

import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'
import {
  buildSalesOrderCustomerCopyText,
  formatSalesOrderSummaryAmount,
} from './sales-order-list.logic'
import SalesOrderRecordsModal from './sales-order-records-modal.vue'

defineOptions({ name: 'OperationsSalesOrders' })

const router = useRouter()
const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()

const canRead = computed(() => auth('sales-orders:read'))
const canCreate = computed(() => auth('sales-orders:create'))
const rows = ref<SalesOrderListItemDto[]>([])
const summariesByCurrency = ref<SalesOrderCurrencySummaryDto[]>([])
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
const recordsModalVisible = ref(false)
const recordsModalKind = ref<SalesOrderRecordsKind>('payments')
const recordsModalOrder = ref<SalesOrderListItemDto | null>(null)
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
  {
    accessorKey: 'orderNo',
    id: 'orderSummary',
    fixed: 'left',
    minWidth: 230,
    title: '订单',
  },
  { accessorFn: item => item.issuer.displayName, id: 'issuerSummary', minWidth: 180, title: '出单人' },
  { accessorKey: 'customerName', id: 'customerSummary', minWidth: 300, title: '客户' },
  { accessorFn: item => item.lineSummary.lineCount, id: 'productSummary', minWidth: 160, title: '产品' },
  {
    accessorKey: 'agreedTotalAmount',
    align: 'right',
    id: 'priceSummary',
    minWidth: 240,
    title: '售价',
  },
  {
    accessorKey: 'depositDueAmount',
    align: 'right',
    id: 'termsSummary',
    minWidth: 230,
    title: '约定金额',
  },
  {
    accessorKey: 'receivedAmount',
    align: 'right',
    id: 'collectionSummary',
    minWidth: 230,
    title: '实际收款',
  },
  { accessorKey: 'paymentRecordCount', id: 'paymentRecordsSummary', minWidth: 180, title: '实际收款记录' },
  { accessorKey: 'paymentStatus', id: 'paymentStatusSummary', minWidth: 170, title: '付款状态' },
  { accessorKey: 'orderStatus', id: 'orderStatusSummary', minWidth: 210, title: '订单状态' },
  { accessorFn: item => item.documentSummary.count, id: 'documentSummary', minWidth: 170, title: '订单凭证' },
  { accessorKey: 'remark', id: 'remarkSummary', minWidth: 240, title: '备注' },
  { accessorFn: item => item.statusChangeRecordCount + item.amountChangeRecordCount, id: 'changeRecordsSummary', minWidth: 170, title: '变更记录' },
  { accessorKey: 'updatedAt', id: 'auditSummary', minWidth: 240, title: '审计信息' },
]

function productImageItems(row: SalesOrderListItemDto): readonly ImageGroupItem[] {
  return row.lineSummary.previews.flatMap(preview => preview.mainImage === null
    ? []
    : [{
        alt: preview.productName,
        key: preview.lineId,
        src: preview.mainImage.contentUrl,
        tooltip: preview.productName,
      }])
}

function resolveProductPreview(
  row: SalesOrderListItemDto,
  item: ImageGroupItem,
): SalesOrderLinePreviewDto | undefined {
  // ImageGroup 可能折叠或重新排列可见项，按稳定的订单明细 ID 反查，避免 tooltip 与产品串项。
  return typeof item.key === 'string'
    ? row.lineSummary.previews.find(preview => preview.lineId === item.key)
    : undefined
}

function salesRegionLabel(row: SalesOrderListItemDto): string {
  return row.customerProvinceStateName === row.customerCityName
    ? row.customerCityName
    : `${row.customerProvinceStateName} / ${row.customerCityName}`
}

function changeRecordCount(row: SalesOrderListItemDto): number {
  return row.statusChangeRecordCount + row.amountChangeRecordCount
}

function openRecordsModal(
  kind: SalesOrderRecordsKind,
  order: SalesOrderListItemDto,
): void {
  recordsModalKind.value = kind
  recordsModalOrder.value = order
  recordsModalVisible.value = true
}

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
    rows.value = response.data.items.map(item => ({
      ...item,
      documentSummary: {
        ...item.documentSummary,
        previews: item.documentSummary.previews.map(preview => ({ ...preview })),
      },
      issuer: { ...item.issuer },
      lineSummary: {
        ...item.lineSummary,
        previews: item.lineSummary.previews.map(preview => ({
          ...preview,
          mainImage: preview.mainImage === null ? null : { ...preview.mainImage },
        })),
      },
    }))
    summariesByCurrency.value = response.data.summariesByCurrency.map(summary => ({ ...summary }))
    page.value = response.data.page
    pageSize.value = response.data.pageSize
    total.value = response.data.total
  }
  catch (error) {
    if (isSalesOrderAbortError(error) || version !== requestVersion) {
      return
    }
    const failure = getSalesOrderApiFailure(error)
    summariesByCurrency.value = []
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

// 桌面表格与移动卡片共用同一套语义色，颜色仅用于辅助识别，状态含义仍由文字承载。
function orderStatusTagClass(value: SalesOrderListItemDto['orderStatus']): string {
  return {
    DRAFT: 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
    CONFIRMED: 'border-primary/30 bg-primary/10 text-primary',
    CANCELLED: 'border-destructive/30 bg-destructive/10 text-destructive',
  }[value]
}

function fulfillmentStatusTagClass(
  value: SalesOrderListItemDto['fulfillmentStatus'],
): string {
  return {
    PENDING: 'border-border bg-muted text-muted-foreground',
    PREPARING: 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
    SHIPPED: 'border-blue-500/30 bg-blue-500/8 text-blue-700 dark:text-blue-300',
    SIGNED: 'border-primary/30 bg-primary/10 text-primary',
  }[value]
}

function paymentStatusTagClass(value: SalesOrderListItemDto['paymentStatus']): string {
  return {
    UNPAID: 'border-destructive/30 bg-destructive/10 text-destructive',
    PARTIALLY_PAID: 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
    PAID: 'border-primary/30 bg-primary/10 text-primary',
  }[value]
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
        table-class="min-w-[3010px]"
        @filter-change="handleFilterChange"
        @pagination-change="handlePaginationChange"
        @retry="loadOrders"
        @search="handleSearch"
      >
        <template #cell-orderSummary="{ row }">
          <QsTableStackedCell class="group">
            <QsTableStackedLine nowrap content-class="qs-type-data-emphasis font-mono">
              {{ row.original.orderNo }}
              <template #suffix>
                <CopyCellButton label="订单编号" :text="row.original.orderNo" />
              </template>
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="qs-type-meta" nowrap>
              {{ row.original.orderDate }} · {{ row.original.currencyCode }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-issuerSummary="{ row }">
          <QsPersonDisplay
            :display-name="row.original.issuer.displayName"
            size="md"
            class="max-w-[9rem]"
          />
        </template>

        <template #cell-customerSummary="{ row }">
          <QsTableStackedCell class="group">
            <QsTableStackedLine content-class="font-medium truncate" nowrap>
              {{ row.original.customerName }} · {{ row.original.customerPhone }}
              <template #suffix>
                <CopyCellButton label="客户信息" :text="buildSalesOrderCustomerCopyText(row.original)" />
              </template>
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="qs-type-meta truncate" nowrap>
              <FaTooltip :text="row.original.customerFullAddress">
                <span class="truncate">{{ salesRegionLabel(row.original) }} · {{ row.original.customerFullAddress }}</span>
              </FaTooltip>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-productSummary="{ row }">
          <ImageGroup
            :items="productImageItems(row.original)"
            :max-count="3"
            :size="40"
            radius="md"
          >
            <template #tooltip="{ item, index, total: imageTotal }">
              <QsGoodTooltipContent
                :image-src="item.src"
                :image-alt="item.alt"
              >
                <template v-if="resolveProductPreview(row.original, item)">
                  <div class="min-w-0">
                    <div class="flex gap-3 items-center justify-between">
                      <span class="tracking-[0.08em] font-semibold">订单产品</span>
                      <span class="opacity-60 tabular-nums">{{ index + 1 }} / {{ imageTotal }}</span>
                    </div>
                    <p class="text-sm leading-5 font-semibold m-0 mt-2 break-words">
                      {{ resolveProductPreview(row.original, item)?.productName }}
                    </p>
                  </div>
                </template>
                <span v-else class="opacity-70">产品信息不可用</span>
              </QsGoodTooltipContent>
            </template>
          </ImageGroup>
        </template>

        <template #cell-priceSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="实际售价" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.agreedTotalAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine label="标准售价" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.standardSubtotalAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-termsSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="定金" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.depositDueAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine label="尾款" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.balanceDueAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-collectionSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="已收" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.receivedAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine label="待收" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.outstandingAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-paymentRecordsSummary="{ row }">
          <FaButton
            type="button"
            variant="ghost"
            class="font-medium px-2 py-1.5 gap-2 h-auto"
            :aria-label="`查看 ${row.original.paymentRecordCount} 项实际收款记录`"
            @click="openRecordsModal('payments', row.original)"
          >
            <FaIcon name="i-lucide:hand-coins" class="text-primary size-4" aria-hidden="true" />
            {{ row.original.paymentRecordCount }} 项记录
          </FaButton>
        </template>

        <template #cell-paymentStatusSummary="{ row }">
          <FaTag
            variant="outline"
            class="qs-type-status-tag"
            :class="paymentStatusTagClass(row.original.paymentStatus)"
          >
            {{ paymentStatusLabel(row.original.paymentStatus) }}
          </FaTag>
        </template>

        <template #cell-orderStatusSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="订单状态" nowrap>
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="orderStatusTagClass(row.original.orderStatus)"
              >
                {{ orderStatusLabel(row.original.orderStatus) }}
              </FaTag>
            </QsTableStackedLine>
            <QsTableStackedLine label="订单进度" tone="muted" nowrap>
              <FaTag
                variant="outline"
                class="qs-type-status-tag"
                :class="fulfillmentStatusTagClass(row.original.fulfillmentStatus)"
              >
                {{ fulfillmentStatusLabel(row.original.fulfillmentStatus) }}
              </FaTag>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-documentSummary="{ row }">
          <FaButton
            type="button"
            variant="ghost"
            class="font-medium px-2 py-1.5 gap-2 h-auto"
            :aria-label="`查看 ${row.original.documentSummary.count} 项订单凭证`"
            @click="openRecordsModal('documents', row.original)"
          >
            <FaIcon name="i-lucide:files" class="text-primary size-4" aria-hidden="true" />
            {{ row.original.documentSummary.count }} 项凭证
          </FaButton>
        </template>

        <template #cell-remarkSummary="{ row }">
          <FaTooltip
            :text="row.original.remark ?? '未填写备注'"
            :disabled="row.original.remark === null"
          >
            <span class="max-w-[13rem] block truncate">
              {{ row.original.remark ?? '未填写备注' }}
            </span>
          </FaTooltip>
        </template>

        <template #cell-changeRecordsSummary="{ row }">
          <FaButton
            type="button"
            variant="ghost"
            class="font-medium px-2 py-1.5 gap-2 h-auto"
            :aria-label="`查看 ${changeRecordCount(row.original)} 项变更记录`"
            @click="openRecordsModal('changes', row.original)"
          >
            <FaIcon name="i-lucide:history" class="text-primary size-4" aria-hidden="true" />
            {{ changeRecordCount(row.original) }} 项记录
          </FaButton>
        </template>

        <template #cell-auditSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="创建" content-class="qs-type-meta" nowrap>
              <DateTimeDisplay :value="row.original.createdAt" />
            </QsTableStackedLine>
            <QsTableStackedLine label="更新" tone="muted" content-class="qs-type-meta flex gap-1" nowrap>
              <DateTimeDisplay :value="row.original.updatedAt" />
              <span>· v{{ row.original.version }}</span>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #summary>
          <!-- 币种作为稳定行维度，六项金额作为列维度，避免在窄表尾中重复币种和挤压标签。 -->
          <section
            data-testid="sales-order-summary-matrix"
            aria-label="销售订单金额汇总"
            class="border-t-2 border-border bg-background overflow-hidden"
          >
            <div class="md:grid md:grid-cols-[12rem_minmax(0,1fr)]">
              <div class="px-4 py-3 border-border flex gap-1 md:border-r md:flex-col md:justify-center">
                <span class="qs-type-meta">筛选结果</span>
                <strong class="qs-type-data-emphasis">共 {{ total }} 张订单</strong>
              </div>

              <div
                data-testid="sales-order-summary-desktop"
                class="min-w-0 hidden overflow-x-auto md:block"
              >
                <table class="text-sm min-w-[840px] w-full border-collapse">
                  <caption class="sr-only">
                    按币种汇总销售订单售价、付款约定与收款金额
                  </caption>
                  <thead class="text-muted-foreground bg-muted/20">
                    <tr class="border-b border-border/70">
                      <th scope="col" rowspan="2" class="font-medium px-4 py-2 text-left">
                        币种
                      </th>
                      <th scope="colgroup" colspan="2" class="font-medium px-4 py-2 text-center">
                        售价
                      </th>
                      <th scope="colgroup" colspan="2" class="font-medium px-4 py-2 text-center">
                        付款约定
                      </th>
                      <th scope="colgroup" colspan="2" class="font-medium px-4 py-2 text-center">
                        收款
                      </th>
                    </tr>
                    <tr class="border-b border-border/70">
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        实际售价
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        标准售价
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        定金
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        尾款
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        已收
                      </th>
                      <th scope="col" class="font-medium px-4 py-2 text-right">
                        待收
                      </th>
                    </tr>
                  </thead>
                  <tbody v-if="summariesByCurrency.length > 0">
                    <tr
                      v-for="summary in summariesByCurrency"
                      :key="summary.currencyCode"
                      class="border-b border-border/60 last:border-b-0"
                    >
                      <th scope="row" class="qs-type-data font-semibold px-4 py-3 text-left">
                        {{ summary.currencyCode }}
                      </th>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.agreedTotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.standardSubtotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.depositDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.balanceDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.receivedAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                      <td class="qs-type-data-emphasis text-foreground px-4 py-3 text-right whitespace-nowrap">
                        {{ formatSalesOrderSummaryAmount(summary.outstandingAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                      </td>
                    </tr>
                  </tbody>
                  <tbody v-else>
                    <tr>
                      <td colspan="7" class="text-muted-foreground px-4 py-5 text-center">
                        暂无金额汇总
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div
                data-testid="sales-order-summary-mobile"
                class="border-t border-border md:hidden"
              >
                <div v-if="summariesByCurrency.length > 0">
                  <section
                    v-for="summary in summariesByCurrency"
                    :key="summary.currencyCode"
                    class="p-4 border-b border-border last:border-b-0"
                    :aria-label="`${summary.currencyCode} 金额汇总`"
                  >
                    <h3 class="qs-type-data-emphasis m-0 mb-3">
                      {{ summary.currencyCode }}
                    </h3>
                    <dl class="m-0 gap-x-5 gap-y-4 grid grid-cols-2">
                      <div>
                        <dt class="qs-type-meta">
                          实际售价
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.agreedTotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          标准售价
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.standardSubtotalAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          定金
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.depositDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          尾款
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.balanceDueAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          已收
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.receivedAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                      <div>
                        <dt class="qs-type-meta">
                          待收
                        </dt>
                        <dd class="qs-type-data-emphasis text-foreground m-0 mt-1 whitespace-nowrap">
                          {{ formatSalesOrderSummaryAmount(summary.outstandingAmount, summary.currencyCode, currencyCatalog.currencies.value) }}
                        </dd>
                      </div>
                    </dl>
                  </section>
                </div>
                <p v-else class="text-sm text-muted-foreground m-0 px-4 py-5 text-center">
                  暂无金额汇总
                </p>
              </div>
            </div>
          </section>
        </template>

        <template #mobile-row="{ row, rowNumber }">
          <article data-testid="sales-order-mobile-summary">
            <div class="mb-4 pb-3 border-b border-border flex gap-3 items-start justify-between">
              <QsTableStackedCell class="group min-w-0">
                <QsTableStackedLine content-class="qs-type-data-emphasis font-mono break-all">
                  {{ row.orderNo }}
                  <template #suffix>
                    <CopyCellButton always-visible label="订单编号" :text="row.orderNo" />
                  </template>
                </QsTableStackedLine>
                <QsTableStackedLine tone="muted" content-class="qs-type-meta">
                  {{ row.orderDate }} · {{ row.currencyCode }}
                </QsTableStackedLine>
              </QsTableStackedCell>
              <span class="qs-type-meta shrink-0">#{{ rowNumber }}</span>
            </div>

            <dl class="m-0 gap-x-4 gap-y-4 grid grid-cols-2">
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  出单人
                </dt>
                <dd class="m-0">
                  <QsPersonDisplay
                    :display-name="row.issuer.displayName"
                    size="md"
                    class="max-w-full"
                  />
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  客户
                </dt>
                <dd class="group m-0">
                  <div class="font-medium flex gap-2 items-center">
                    {{ row.customerName }} · {{ row.customerPhone }}
                    <CopyCellButton always-visible label="客户信息" :text="buildSalesOrderCustomerCopyText(row)" />
                  </div>
                  <div class="qs-type-meta mt-1 break-all">
                    {{ salesRegionLabel(row) }} · {{ row.customerFullAddress }}
                  </div>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  产品
                </dt>
                <dd class="m-0">
                  <ImageGroup :items="productImageItems(row)" :max-count="3" :size="40" radius="md">
                    <template #tooltip="{ item, index, total: imageTotal }">
                      <QsGoodTooltipContent
                        :image-src="item.src"
                        :image-alt="item.alt"
                      >
                        <template v-if="resolveProductPreview(row, item)">
                          <div class="min-w-0">
                            <div class="flex gap-3 items-center justify-between">
                              <span class="tracking-[0.08em] font-semibold">订单产品</span>
                              <span class="opacity-60 tabular-nums">{{ index + 1 }} / {{ imageTotal }}</span>
                            </div>
                            <p class="text-sm leading-5 font-semibold m-0 mt-2 break-words">
                              {{ resolveProductPreview(row, item)?.productName }}
                            </p>
                          </div>
                        </template>
                        <span v-else class="opacity-70">产品信息不可用</span>
                      </QsGoodTooltipContent>
                    </template>
                  </ImageGroup>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  售价
                </dt>
                <dd class="m-0">
                  <QsTableStackedCell>
                    <QsTableStackedLine label="实际售价" nowrap>
                      <AmountDisplay :value="row.agreedTotalAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                    <QsTableStackedLine label="标准售价" nowrap>
                      <AmountDisplay :value="row.standardSubtotalAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                  </QsTableStackedCell>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  约定金额
                </dt>
                <dd class="m-0">
                  <QsTableStackedCell>
                    <QsTableStackedLine label="定金" nowrap>
                      <AmountDisplay :value="row.depositDueAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                    <QsTableStackedLine label="尾款" nowrap>
                      <AmountDisplay :value="row.balanceDueAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                  </QsTableStackedCell>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  实际收款
                </dt>
                <dd class="m-0">
                  <QsTableStackedCell>
                    <QsTableStackedLine label="已收" nowrap>
                      <AmountDisplay :value="row.receivedAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                    <QsTableStackedLine label="待收" nowrap>
                      <AmountDisplay :value="row.outstandingAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                    </QsTableStackedLine>
                  </QsTableStackedCell>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  实际收款记录
                </dt>
                <dd class="m-0">
                  <FaButton
                    type="button"
                    variant="ghost"
                    class="font-medium px-2 py-1.5 gap-2 h-auto"
                    @click="openRecordsModal('payments', row)"
                  >
                    <FaIcon name="i-lucide:hand-coins" class="text-primary size-4" aria-hidden="true" />
                    {{ row.paymentRecordCount }} 项记录
                  </FaButton>
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  付款状态
                </dt>
                <dd class="m-0">
                  <FaTag
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="paymentStatusTagClass(row.paymentStatus)"
                  >
                    {{ paymentStatusLabel(row.paymentStatus) }}
                  </FaTag>
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  订单状态
                </dt>
                <dd class="m-0">
                  <QsTableStackedCell>
                    <QsTableStackedLine label="订单状态" nowrap>
                      <FaTag
                        variant="outline"
                        class="qs-type-status-tag"
                        :class="orderStatusTagClass(row.orderStatus)"
                      >
                        {{ orderStatusLabel(row.orderStatus) }}
                      </FaTag>
                    </QsTableStackedLine>
                    <QsTableStackedLine label="订单进度" tone="muted" nowrap>
                      <FaTag
                        variant="outline"
                        class="qs-type-status-tag"
                        :class="fulfillmentStatusTagClass(row.fulfillmentStatus)"
                      >
                        {{ fulfillmentStatusLabel(row.fulfillmentStatus) }}
                      </FaTag>
                    </QsTableStackedLine>
                  </QsTableStackedCell>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  订单凭证
                </dt>
                <dd class="m-0">
                  <FaButton
                    type="button"
                    variant="ghost"
                    class="font-medium px-2 py-1.5 gap-2 h-auto"
                    @click="openRecordsModal('documents', row)"
                  >
                    <FaIcon name="i-lucide:files" class="text-primary size-4" aria-hidden="true" />
                    {{ row.documentSummary.count }} 项凭证
                  </FaButton>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  备注
                </dt>
                <dd class="m-0 min-w-0">
                  <FaTooltip :text="row.remark ?? '未填写备注'" :disabled="row.remark === null">
                    <span class="block truncate">{{ row.remark ?? '未填写备注' }}</span>
                  </FaTooltip>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  变更记录
                </dt>
                <dd class="m-0">
                  <FaButton
                    type="button"
                    variant="ghost"
                    class="font-medium px-2 py-1.5 gap-2 h-auto"
                    @click="openRecordsModal('changes', row)"
                  >
                    <FaIcon name="i-lucide:history" class="text-primary size-4" aria-hidden="true" />
                    {{ changeRecordCount(row) }} 项记录
                  </FaButton>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  审计信息
                </dt>
                <dd class="qs-type-meta m-0 flex flex-wrap gap-x-3 gap-y-1">
                  <span>创建 <DateTimeDisplay :value="row.createdAt" /></span>
                  <span>更新 <DateTimeDisplay :value="row.updatedAt" /> · v{{ row.version }}</span>
                </dd>
              </div>
            </dl>
          </article>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <SalesOrderRecordsModal
      v-model="recordsModalVisible"
      :kind="recordsModalKind"
      :order="recordsModalOrder"
      :currencies="currencyCatalog.currencies.value"
    />

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
