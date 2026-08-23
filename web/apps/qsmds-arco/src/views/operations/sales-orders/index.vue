<script setup lang="ts">
import type {
  SalesOrderCurrencySummaryDto,
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
    summary: { type: 'count' },
    title: '订单',
  },
  { accessorKey: 'customerName', id: 'customerSummary', minWidth: 260, title: '客户' },
  { accessorFn: item => item.lineSummary.lineCount, id: 'productSummary', minWidth: 230, title: '产品' },
  {
    accessorKey: 'agreedTotalAmount',
    align: 'right',
    id: 'termsSummary',
    minWidth: 250,
    summary: { type: 'sum' },
    title: '销售与付款约定',
  },
  {
    accessorKey: 'receivedAmount',
    align: 'right',
    id: 'collectionSummary',
    minWidth: 230,
    summary: { type: 'sum' },
    title: '实际收款',
  },
  { accessorKey: 'orderStatus', id: 'statusSummary', minWidth: 230, title: '状态' },
  { accessorFn: item => item.documentSummary.count, id: 'documentSummary', minWidth: 250, title: '凭证与备注' },
  { accessorKey: 'updatedAt', id: 'auditSummary', minWidth: 240, title: '审计信息' },
]

const summaryValues = computed(() => ({
  collectionSummary: null,
  orderSummary: total.value,
  termsSummary: null,
}))

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

function documentImageItems(row: SalesOrderListItemDto): readonly ImageGroupItem[] {
  return row.documentSummary.previews.flatMap(preview => preview.mediaType !== 'IMAGE'
    ? []
    : [{
        alt: preview.title ?? '订单凭证',
        key: preview.id,
        src: preview.contentUrl,
        tooltip: preview.title ?? '订单凭证',
      }])
}

function productPreviewNames(row: SalesOrderListItemDto): string {
  return row.lineSummary.previews.map(preview => preview.productName).join('、')
}

function documentPreviewTitles(row: SalesOrderListItemDto): string {
  return row.documentSummary.previews
    .map(preview => preview.title ?? '未命名凭证')
    .join('、')
}

function salesRegionLabel(row: SalesOrderListItemDto): string {
  return row.customerProvinceStateName === row.customerCityName
    ? row.customerCityName
    : `${row.customerProvinceStateName} / ${row.customerCityName}`
}

function hasPositiveAmount(value: string): boolean {
  return Number(value) > 0
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
        :summary-values="summaryValues"
        :total="total"
        table-class="min-w-[1940px]"
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
              {{ row.original.orderDate }} · {{ row.original.issuer.displayName }} · {{ row.original.currencyCode }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-customerSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="font-medium truncate" nowrap>
              {{ row.original.customerName }} · {{ row.original.customerPhone }}
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="qs-type-meta truncate" nowrap>
              <FaTooltip :text="row.original.customerFullAddress">
                <span class="truncate">{{ salesRegionLabel(row.original) }} · {{ row.original.customerFullAddress }}</span>
              </FaTooltip>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-productSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="flex gap-2 items-center" nowrap>
              <ImageGroup
                :items="productImageItems(row.original)"
                :max-count="3"
                :size="32"
                radius="md"
              />
              <FaTooltip :text="productPreviewNames(row.original)">
                <strong>{{ row.original.lineSummary.lineCount }} 项 · {{ row.original.lineSummary.totalQuantity }} 件</strong>
              </FaTooltip>
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="qs-type-meta flex gap-1 items-baseline" nowrap>
              <span>目录 {{ row.original.lineSummary.catalogCount }} · 临时 {{ row.original.lineSummary.customCount }} · 小计</span>
              <AmountDisplay :value="row.original.lineSubtotalAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-termsSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="总价" content-class="ml-auto flex justify-end text-right" nowrap weight="semibold">
              <AmountDisplay :value="row.original.agreedTotalAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine label="定金 / 尾款" tone="muted" content-class="ml-auto flex gap-1 justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.depositDueAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
              <span>/</span>
              <AmountDisplay :value="row.original.balanceDueAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-collectionSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine label="已收" tone="success" content-class="ml-auto flex justify-end text-right" nowrap weight="semibold">
              <AmountDisplay :value="row.original.receivedAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine label="待收" :tone="hasPositiveAmount(row.original.outstandingAmount) ? 'danger' : 'muted'" content-class="ml-auto flex justify-end text-right" nowrap>
              <AmountDisplay :value="row.original.outstandingAmount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-statusSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="flex gap-1.5" nowrap>
              <FaTag variant="outline" class="qs-type-status-tag">
                {{ orderStatusLabel(row.original.orderStatus) }}
              </FaTag>
              <FaTag variant="outline" class="qs-type-status-tag">
                {{ fulfillmentStatusLabel(row.original.fulfillmentStatus) }}
              </FaTag>
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="flex gap-1.5" nowrap>
              <span class="qs-type-meta">付款</span>
              <FaTag variant="outline" class="qs-type-status-tag">
                {{ paymentStatusLabel(row.original.paymentStatus) }}
              </FaTag>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #cell-documentSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="flex gap-2 items-center" nowrap>
              <ImageGroup
                v-if="row.original.documentSummary.imageCount > 0"
                :items="documentImageItems(row.original)"
                :max-count="3"
                :size="32"
                radius="md"
              />
              <FaIcon v-else name="i-lucide:file-text" class="text-muted-foreground size-5" aria-hidden="true" />
              <FaTooltip :text="documentPreviewTitles(row.original)" :disabled="row.original.documentSummary.count === 0">
                <span>{{ row.original.documentSummary.count }} 份凭证</span>
              </FaTooltip>
              <span v-if="row.original.documentSummary.count > row.original.documentSummary.imageCount" class="qs-type-meta">
                含 {{ row.original.documentSummary.count - row.original.documentSummary.imageCount }} 份文件
              </span>
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="qs-type-meta truncate" nowrap>
              <FaTooltip :text="row.original.remark ?? '未填写备注'" :disabled="row.original.remark === null">
                <span class="truncate">{{ row.original.remark ?? '未填写备注' }}</span>
              </FaTooltip>
            </QsTableStackedLine>
          </QsTableStackedCell>
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

        <template #summary-orderSummary>
          <div class="gap-0.5 grid">
            <span class="qs-type-meta">筛选结果</span>
            <strong class="qs-type-data-emphasis">共 {{ total }} 张订单</strong>
          </div>
        </template>

        <template #summary-termsSummary>
          <div class="text-right gap-1.5 grid justify-items-end">
            <span class="qs-type-meta">筛选结果 · 销售总价</span>
            <div v-for="summary in summariesByCurrency" :key="summary.currencyCode" class="flex gap-2 items-baseline">
              <span class="qs-type-meta font-mono">{{ summary.currencyCode }} · {{ summary.orderCount }} 单</span>
              <AmountDisplay :value="summary.agreedTotalAmount" :currency="summary.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </div>
          </div>
        </template>

        <template #summary-collectionSummary>
          <div class="text-right gap-1.5 grid justify-items-end">
            <span class="qs-type-meta">筛选结果 · 实收 / 待收</span>
            <div v-for="summary in summariesByCurrency" :key="summary.currencyCode" class="flex gap-1 whitespace-nowrap items-baseline">
              <span class="qs-type-meta font-mono">{{ summary.currencyCode }}</span>
              <AmountDisplay :value="summary.receivedAmount" :currency="summary.currencyCode" :currencies="currencyCatalog.currencies.value" />
              <span class="qs-type-meta">/</span>
              <AmountDisplay :value="summary.outstandingAmount" :currency="summary.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </div>
          </div>
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
                  {{ row.orderDate }} · {{ row.issuer.displayName }} · {{ row.currencyCode }}
                </QsTableStackedLine>
              </QsTableStackedCell>
              <span class="qs-type-meta shrink-0">#{{ rowNumber }}</span>
            </div>

            <dl class="m-0 gap-x-4 gap-y-4 grid grid-cols-2">
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  客户
                </dt>
                <dd class="m-0">
                  <div class="font-medium">
                    {{ row.customerName }} · {{ row.customerPhone }}
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
                <dd class="m-0 flex gap-3 items-center">
                  <ImageGroup :items="productImageItems(row)" :max-count="3" :size="40" radius="md" />
                  <span>
                    {{ row.lineSummary.lineCount }} 项 · {{ row.lineSummary.totalQuantity }} 件
                    <br>
                    <span class="qs-type-meta">目录 {{ row.lineSummary.catalogCount }} · 临时 {{ row.lineSummary.customCount }}</span>
                    <br>
                    <span class="qs-type-meta inline-flex gap-1 items-baseline">小计 <AmountDisplay :value="row.lineSubtotalAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" /></span>
                  </span>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  销售总价
                </dt>
                <dd class="qs-type-data-emphasis m-0">
                  <AmountDisplay :value="row.agreedTotalAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  定金 / 已收
                </dt>
                <dd class="m-0 gap-1 grid">
                  <AmountDisplay :value="row.depositDueAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" /><AmountDisplay :value="row.receivedAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  尾款 / 待收
                </dt>
                <dd class="m-0 gap-1 grid">
                  <AmountDisplay :value="row.balanceDueAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" /><AmountDisplay :value="row.outstandingAmount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  状态
                </dt>
                <dd class="m-0 flex flex-wrap gap-1.5">
                  <FaTag variant="outline" class="qs-type-status-tag">
                    {{ orderStatusLabel(row.orderStatus) }}
                  </FaTag>
                  <FaTag variant="outline" class="qs-type-status-tag">
                    {{ fulfillmentStatusLabel(row.fulfillmentStatus) }}
                  </FaTag>
                  <FaTag variant="outline" class="qs-type-status-tag">
                    {{ paymentStatusLabel(row.paymentStatus) }}
                  </FaTag>
                </dd>
              </div>
              <div class="col-span-2">
                <dt class="qs-type-compact-label mb-1">
                  凭证与备注
                </dt>
                <dd class="m-0 flex gap-3 items-center">
                  <ImageGroup v-if="row.documentSummary.imageCount > 0" :items="documentImageItems(row)" :max-count="3" :size="40" radius="md" />
                  <FaIcon v-else name="i-lucide:file-text" class="text-muted-foreground size-5" aria-hidden="true" />
                  <span class="min-w-0">
                    <span>{{ row.documentSummary.count }} 份凭证</span>
                    <span v-if="row.documentSummary.previews[0]?.title" class="qs-type-meta mt-1 block truncate">{{ row.documentSummary.previews[0].title }}</span>
                    <span class="qs-type-meta mt-1 block break-all">{{ row.remark ?? '未填写备注' }}</span>
                  </span>
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
