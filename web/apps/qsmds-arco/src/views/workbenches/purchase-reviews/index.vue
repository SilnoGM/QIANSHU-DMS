<script setup lang="ts">
import type { ReviewView } from './logic'
import type { PurchaseOrderDetailDto, PurchaseOrderListItemDto } from '@/api/generated/types.gen'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import purchaseOrdersApi from '@/api/modules/purchase-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { formatDateTime } from '@/components/base/DateTimeDisplay/format'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsPurchaseOrderDrawer from '@/components/business/QsPurchaseOrderDrawer/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { getPurchaseOrderApiFailure, orderStatusLabel, orderStatusTagClass, purchaseTypeLabel } from '../../operations/purchase-orders/purchase-order-list.logic'
import PurchaseOrderReviewModal from '../../operations/purchase-orders/purchase-order-review-modal.vue'
import { buildReviewQuery, countReviewViews } from './logic'

defineOptions({ name: 'QsPurchaseReviews' })
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const canRead = computed(() => auth('purchase-orders:read'))
const canReview = computed(() => auth('purchase-orders:review'))
const status = ref<ReviewView>('PENDING_REVIEW')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const items = shallowRef<PurchaseOrderListItemDto[]>([])
const counts = ref(countReviewViews([]))
const loading = ref(false)
const error = ref('')
const countsError = ref(false)
const reviewVisible = ref(false)
const reviewId = ref<string | null>(null)
const detailVisible = ref(false)
const selectedOrder = shallowRef<PurchaseOrderListItemDto | null>(null)
const detail = shallowRef<PurchaseOrderDetailDto | null>(null)
const detailLoading = ref(false)
const detailError = ref<string | null>(null)
let listController: AbortController | null = null
let countController: AbortController | null = null
let detailController: AbortController | null = null
const tabs = computed(() => (['PENDING_REVIEW', 'APPROVED', 'CANCELLED'] as const).map(value => ({ value, label: t(`purchaseReview.${value}`), count: countsError.value ? undefined : counts.value[value] })))
const columns = computed<QsGenericTableColumn<PurchaseOrderListItemDto>[]>(() => [
  { id: 'orderNo', accessorKey: 'orderNo', title: t('purchaseReview.orderNo'), minWidth: 240, fixed: 'left', copyable: true },
  { id: 'source', accessorKey: 'salesOrderNo', title: t('purchaseReview.source'), minWidth: 230 },
  { id: 'supplier', accessorFn: row => row.supplier.label, title: t('purchaseReview.supplier'), minWidth: 130 },
  { id: 'buyer', accessorFn: row => row.createdBy.displayName, title: t('purchaseReview.buyer'), minWidth: 150 },
  { id: 'products', accessorFn: row => row.lineSummary.lineCount, title: t('purchaseReview.products'), minWidth: 185 },
  { id: 'parts', accessorKey: 'partCount', title: t('purchaseReview.parts'), minWidth: 130 },
  { id: 'amount', accessorKey: 'purchaseTotalAmount', title: t('purchaseReview.amount'), minWidth: 185, align: 'right' },
  { id: 'terms', accessorKey: 'depositDueAmount', title: t('purchaseReview.terms'), minWidth: 220, align: 'right' },
  { id: 'date', accessorKey: 'createdAt', title: t('purchaseReview.date'), minWidth: 190 },
  ...(status.value === 'PENDING_REVIEW'
    ? []
    : [{
        id: 'reviewSummary',
        title: t('purchaseReview.summary.title'),
        minWidth: 360,
        accessorFn: (row: PurchaseOrderListItemDto) => row.reviewSummary
          ? `${row.reviewSummary.reviewedBy.displayName} · ${formatDateTime(row.reviewSummary.reviewedAt)} · ${t('purchaseReview.summary.reason')}：${row.reviewSummary.reason || t('purchaseReview.summary.notRecorded')}`
          : t('purchaseReview.summary.notRecorded'),
      }]),
  { id: 'status', accessorKey: 'orderStatus', title: t('purchaseReview.status'), minWidth: 130 },
])
function images(row: PurchaseOrderListItemDto): ImageGroupItem[] {
  return row.lineSummary.previews.flatMap(item => item.mainImage === null ? [] : [{ key: item.lineId, src: item.mainImage.contentUrl, alt: item.productName, tooltip: item.productName }])
}
async function load(): Promise<void> {
  listController?.abort()
  if (!canRead.value) {
    loading.value = false
    return
  }
  const current = new AbortController()
  listController = current
  const epoch = account.authEpoch
  loading.value = true
  error.value = ''
  try {
    const response = await purchaseOrdersApi.list(buildReviewQuery(status.value, keyword.value, page.value, pageSize.value), current.signal)
    if (current.signal.aborted || epoch !== account.authEpoch || !canRead.value) {
      return
    }
    items.value = response.data.items
    total.value = response.data.total
    // 审核成功会移出当前视图，最后一页为空时回到有效页，避免误以为没有待办。
    if (page.value > 1 && items.value.length === 0) {
      page.value = Math.max(1, Math.ceil(total.value / pageSize.value))
      await load()
    }
  }
  catch (failure) {
    if (!current.signal.aborted && epoch === account.authEpoch) {
      items.value = []
      error.value = getPurchaseOrderApiFailure(failure).message
    }
  }
  finally {
    if (listController === current) {
      loading.value = false
    }
  }
}
async function loadCounts(): Promise<void> {
  countController?.abort()
  if (!canRead.value) {
    return
  }
  const current = new AbortController()
  countController = current
  const epoch = account.authEpoch
  countsError.value = false
  try {
    const response = await purchaseOrdersApi.statusCounts({ view: 'all', keyword: keyword.value.trim() || undefined }, current.signal)
    if (!current.signal.aborted && epoch === account.authEpoch && canRead.value) {
      counts.value = countReviewViews(response.data.items)
    }
  }
  catch {
    if (!current.signal.aborted && epoch === account.authEpoch) {
      countsError.value = true
    }
  }
}
function refresh(): void {
  void load()
  void loadCounts()
}
function search(): void {
  page.value = 1
  refresh()
}
function selectTab(value: string | number): void {
  if (value === 'PENDING_REVIEW' || value === 'APPROVED' || value === 'CANCELLED') {
    status.value = value
    page.value = 1
    items.value = []
    void load()
  }
}
function openReview(row: PurchaseOrderListItemDto): void {
  if (!canRead.value || !canReview.value || row.orderStatus !== 'PENDING_REVIEW') {
    return
  }
  reviewId.value = row.id
  reviewVisible.value = true
}
async function loadDetail(): Promise<void> {
  detailController?.abort()
  const orderId = selectedOrder.value?.id
  if (!canRead.value || !detailVisible.value || !orderId) {
    return
  }
  const current = new AbortController()
  detailController = current
  const epoch = account.authEpoch
  detailLoading.value = true
  detailError.value = null
  detail.value = null
  try {
    const response = await purchaseOrdersApi.getById(orderId, current.signal)
    if (!current.signal.aborted && epoch === account.authEpoch && canRead.value) {
      detail.value = response.data
    }
  }
  catch (failure) {
    if (!current.signal.aborted && epoch === account.authEpoch) {
      detailError.value = getPurchaseOrderApiFailure(failure).message
    }
  }
  finally {
    if (detailController === current) {
      detailLoading.value = false
    }
  }
}
function view(row: PurchaseOrderListItemDto): void {
  selectedOrder.value = row
  detailVisible.value = true
  void loadDetail()
}
watch(detailVisible, (visible) => {
  if (!visible) {
    detailController?.abort()
    detail.value = null
  }
})
watch(() => [canRead.value, canReview.value, account.authEpoch], () => {
  listController?.abort()
  countController?.abort()
  detailController?.abort()
  reviewVisible.value = false
  reviewId.value = null
  detailVisible.value = false
  selectedOrder.value = null
  detail.value = null
  items.value = []
  total.value = 0
  counts.value = countReviewViews([])
  page.value = 1
  refresh()
}, { immediate: true })
onBeforeUnmount(() => {
  listController?.abort()
  countController?.abort()
  detailController?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.purchaseReviews')" :description="t('purchaseReview.intro')" />
    <FaPageMain v-if="!canRead">
      <FaEmpty icon="i-lucide:shield-alert" :title="t('purchaseReview.noPermission')" class="py-12" />
    </FaPageMain>
    <FaPageMain v-else class="min-w-0">
      <QsStatusSwitchToolbar :model-value="status" :items="tabs" :aria-label="t('workbench.purchaseReviews')" class="mb-4" @update:model-value="selectTab" />
      <p v-if="countsError" role="status" class="text-sm text-muted-foreground flex gap-2 items-center">
        {{ t('purchaseReview.countsFailed') }} <FaButton variant="link" size="sm" @click="loadCounts">
          {{ t('purchaseReview.retry') }}
        </FaButton>
      </p>
      <QsGenericTable
        v-model:page="page" v-model:page-size="pageSize" v-model:search="keyword"
        row-key="id" :show-row-number="false" :columns="columns" :data="items"
        :loading="loading" :error="error || undefined" :total="total" :addable="false"
        :search-placeholder="t('purchaseReview.search')" :empty-title="t('purchaseReview.empty')"
        :page-size-options="[20, 50, 100]" :action-column="{ fixed: 'right', minWidth: 145 }"
        @search="search" @pagination-change="load" @retry="refresh"
      >
        <template #cell-orderNo="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="qs-type-data-emphasis font-mono">
              {{ row.original.orderNo }}
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted">
              {{ purchaseTypeLabel(row.original.purchaseType) }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-source="{ row }">
          <QsTableStackedCell class="group">
            <QsTableStackedLine content-class="qs-type-data-emphasis font-mono">
              {{ row.original.salesOrderNo ?? t('purchaseReview.stock') }}
              <template #suffix>
                <CopyCellButton
                  v-if="row.original.salesOrderNo"
                  :label="t('purchaseReview.source')"
                  :text="row.original.salesOrderNo"
                />
              </template>
            </QsTableStackedLine>
            <QsTableStackedLine v-if="row.original.customerName" tone="muted">
              {{ row.original.customerName }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-buyer="{ row }">
          <QsPersonDisplay :display-name="row.original.createdBy.displayName" size="md" />
        </template>
        <template #cell-products="{ row }">
          <QsTableStackedCell>
            <ImageGroup v-if="images(row.original).length" :items="images(row.original)" :max-count="3" :size="40" radius="md" />
            <span v-else class="qs-type-meta">{{ t('purchaseReview.noImage') }}</span>
            <QsTableStackedLine tone="muted">
              {{ t('purchaseReview.lineSummary', { lines: row.original.lineSummary.lineCount, quantity: row.original.lineSummary.totalQuantity }) }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-parts="{ row }">
          {{ t('purchaseReview.partCount', { count: row.original.partCount }) }}
        </template>
        <template #cell-amount="{ row }">
          <AmountDisplay :value="row.original.purchaseTotalAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
        </template>
        <template #cell-terms="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine :label="t('purchaseReview.deposit')">
              <AmountDisplay :value="row.original.depositDueAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine :label="t('purchaseReview.balance')">
              <AmountDisplay :value="row.original.balanceDueAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-date="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="qs-type-data">
              {{ row.original.orderDate }}
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted">
              <DateTimeDisplay :value="row.original.createdAt" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-status="{ row }">
          <FaTag variant="outline" :class="orderStatusTagClass(row.original.orderStatus)">
            {{ orderStatusLabel(row.original.orderStatus) }}
          </FaTag>
        </template>
        <template #cell-reviewSummary="{ row }">
          <QsTableStackedCell v-if="row.original.reviewSummary" class="max-w-96 w-full">
            <div class="flex gap-3 min-w-0 whitespace-nowrap items-center">
              <QsPersonDisplay :display-name="row.original.reviewSummary.reviewedBy.displayName" size="sm" class="max-w-32" />
              <DateTimeDisplay :value="row.original.reviewSummary.reviewedAt" class="text-muted-foreground shrink-0" />
            </div>
            <QsTableStackedLine :label="t('purchaseReview.summary.reason')" nowrap content-class="flex-1 overflow-hidden">
              <FaTooltip :text="row.original.reviewSummary.reason || t('purchaseReview.summary.notRecorded')">
                <span class="block truncate">{{ row.original.reviewSummary.reason || t('purchaseReview.summary.notRecorded') }}</span>
              </FaTooltip>
            </QsTableStackedLine>
          </QsTableStackedCell>
          <span v-else class="qs-type-meta">{{ t('purchaseReview.summary.notRecorded') }}</span>
        </template>
        <template #actions="{ row }">
          <FaButton v-if="row.orderStatus === 'PENDING_REVIEW' && canReview" variant="ghost" size="sm" class="min-h-11 sm:min-h-8" @click="openReview(row)">
            <FaIcon name="i-lucide:clipboard-check" aria-hidden="true" />{{ t('purchaseReview.review') }}
          </FaButton>
          <FaButton v-else variant="ghost" size="sm" class="min-h-11 sm:min-h-8" @click="view(row)">
            <FaIcon name="i-lucide:eye" aria-hidden="true" />{{ t('purchaseReview.view') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </FaPageMain>
    <PurchaseOrderReviewModal v-model="reviewVisible" :order-id="reviewId" :currencies="currencyCatalog.currencies.value" @detail-updated="refresh" />
    <QsPurchaseOrderDrawer
      v-model="detailVisible" :order="selectedOrder" :detail="detail" :currencies="currencyCatalog.currencies.value"
      :loading="detailLoading" :error="detailError" action-error="" :busy="false"
      :can-attach-document="false" @reload="loadDetail"
    />
  </div>
</template>
