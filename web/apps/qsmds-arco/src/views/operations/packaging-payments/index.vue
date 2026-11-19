<script setup lang="ts">
import type { PackagingCostRequestDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import packagingCostsApi from '@/api/modules/packaging-costs'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { resolveActionColumnWidth } from '@/components/business/QsGenericTable/action-column-width'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import PackagingMobileRow from '../../workbenches/packaging-payments/mobile-row.vue'
import PackagingProof from '../../workbenches/packaging-payments/packaging-proof.vue'
import { getPurchaseOrderApiFailure } from '../purchase-orders/purchase-order-list.logic'
import { buildPackagingPaymentRequestText } from '../warehouse-arrivals/packaging-cost.logic'
import AmountModal from './amount-modal.vue'

defineOptions({ name: 'QsOperationsPackagingPayments' })
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()
const canRead = computed(() => auth('packaging-costs:read'))
// 改金额沿用提报权限：装柜后到仓入口消失，运营仍要能纠正待付款金额。
const canChangeAmount = computed(() => canRead.value && auth('packaging-costs:create'))
const active = ref(false)
const enabled = computed(() => active.value && canRead.value && route.name === 'qsOperationsWarehousePackagingPayments')
const STATUS_FILTERS = ['ALL', 'PENDING_PAYMENT', 'PAID', 'CANCELLED'] as const
type StatusFilter = typeof STATUS_FILTERS[number]
const status = ref<StatusFilter>('ALL')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const items = shallowRef<PackagingCostRequestDto[]>([])
const total = ref(0)
const counts = ref<Record<StatusFilter, number>>({ ALL: 0, PENDING_PAYMENT: 0, PAID: 0, CANCELLED: 0 })
const loading = ref(false)
const error = ref('')
const amountTarget = shallowRef<PackagingCostRequestDto | null>(null)
let controller: AbortController | null = null
const tabs = computed(() => STATUS_FILTERS.map(value => ({
  value,
  label: value === 'ALL' ? t('packagingPayment.tabAll') : t(`packagingPayment.status.${value}`),
  count: counts.value[value],
})))
const columns = computed<QsGenericTableColumn<PackagingCostRequestDto>[]>(() => [
  { id: 'shipmentNo', accessorKey: 'shipmentNo', title: t('packagingPayment.shipmentNo'), minWidth: 177, fixed: 'left', copyable: true, copyMode: 'text' },
  { id: 'shippingMarkText', accessorKey: 'shippingMarkText', title: t('packagingPayment.shippingMarkText'), minWidth: 250, copyable: true },
  { id: 'source', title: t('packagingPayment.source'), minWidth: 240 },
  { id: 'packaging', title: t('packagingPayment.packagingInfo'), minWidth: 165 },
  { id: 'amount', accessorKey: 'amount', title: t('packagingPayment.amount'), minWidth: 150, align: 'right' },
  { id: 'images', title: t('packagingPayment.imagesTitle'), minWidth: 200 },
  { id: 'status', accessorKey: 'status', title: t('packagingPayment.fieldStatus'), minWidth: 110 },
  { id: 'submitted', accessorKey: 'submittedAt', title: t('packagingPayment.submitted'), minWidth: 185 },
  { id: 'paid', accessorKey: 'paidAt', title: t('packagingPayment.paid'), minWidth: 185 },
  { id: 'remark', accessorKey: 'remark', title: t('packagingPayment.remark'), minWidth: 200 },
])
const actionColumnWidth = computed(() => resolveActionColumnWidth([
  { chars: 3, kind: 'text' },
  { chars: 4, kind: 'text' },
]))
const amountVisible = computed({
  get: () => amountTarget.value !== null,
  set: (value: boolean) => {
    if (!value) {
      closeAmount()
    }
  },
})

/** 列表只读本人记录：归属条件由服务端按会话生成，客户端不能通过查询参数扩大范围。 */
async function load(): Promise<void> {
  controller?.abort()
  if (!enabled.value) {
    loading.value = false
    return
  }
  const request = new AbortController()
  const requestEpoch = account.authEpoch
  controller = request
  loading.value = true
  error.value = ''
  const current = () => controller === request && !request.signal.aborted && enabled.value && account.authEpoch === requestEpoch
  try {
    const response = await packagingCostsApi.list({
      page: page.value,
      pageSize: pageSize.value,
      ...(status.value === 'ALL' ? {} : { status: status.value }),
      ...(keyword.value.trim().length === 0 ? {} : { keyword: keyword.value.trim() }),
    }, request.signal)
    if (current()) {
      items.value = response.data.items
      total.value = response.data.total
      const summary = response.data.statusCounts
      counts.value = {
        ALL: summary.PENDING_PAYMENT + summary.PAID + summary.CANCELLED,
        PENDING_PAYMENT: summary.PENDING_PAYMENT,
        PAID: summary.PAID,
        CANCELLED: summary.CANCELLED,
      }
      // 付款后回到仍有记录的那一页，避免停留在空页。
      if (!items.value.length && page.value > 1) {
        page.value = Math.max(1, Math.ceil(total.value / pageSize.value))
        void load()
        return
      }
      syncAmountTarget()
    }
  }
  catch (failure) {
    if (current()) {
      error.value = getPurchaseOrderApiFailure(failure).message
    }
  }
  finally {
    if (current()) {
      loading.value = false
    }
  }
}

/** 重新读取后刷新弹窗里的记录版本；已付款或已移除就关闭，避免按旧版本继续改金额。 */
function syncAmountTarget(): void {
  const current = amountTarget.value
  if (!current) {
    return
  }
  const updated = items.value.find(item => item.id === current.id)
  amountTarget.value = updated && updated.status === 'PENDING_PAYMENT' ? updated : null
}
function selectStatus(value: string | number): void {
  if (!STATUS_FILTERS.includes(value as StatusFilter) || value === status.value) {
    return
  }
  status.value = value as StatusFilter
  page.value = 1
  void load()
}
function search(): void {
  page.value = 1
  void load()
}
function openAmount(record: PackagingCostRequestDto): void {
  if (enabled.value && canChangeAmount.value && record.status === 'PENDING_PAYMENT') {
    amountTarget.value = record
  }
}
function closeAmount(): void {
  amountTarget.value = null
}
/** 付款链接指向财务工作台，运营只负责复制发送，本身没有付款权限。 */
async function copyRequest(record: PackagingCostRequestDto): Promise<void> {
  const requestEpoch = account.authEpoch
  const current = () => account.authEpoch === requestEpoch
  try {
    const href = router.resolve({ name: 'qsFinanceRealtimePackagingPayment', params: { requestId: record.id } }).href
    await navigator.clipboard.writeText(buildPackagingPaymentRequestText(record, href, window.location.href))
    if (current()) {
      toast.success(t('packagingPayment.copySuccess'))
    }
  }
  catch {
    if (current()) {
      toast.warning(t('packagingPayment.copyFailed'))
    }
  }
}
watch([enabled, canChangeAmount, () => account.authEpoch], () => {
  controller?.abort()
  controller = null
  items.value = []
  total.value = 0
  counts.value = { ALL: 0, PENDING_PAYMENT: 0, PAID: 0, CANCELLED: 0 }
  amountTarget.value = null
  loading.value = false
  void load()
}, { immediate: true, flush: 'sync' })
onMounted(() => active.value = true)
onActivated(() => active.value = true)
onDeactivated(() => active.value = false)
onBeforeUnmount(() => active.value = false)
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('packagingPayment.listTitle')" :description="t('packagingPayment.listIntro')">
      <FaButton v-if="canRead" variant="outline" :loading="loading" @click="load">
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('packagingPayment.refresh') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain class="min-w-0">
      <FaEmpty v-if="!canRead" icon="i-lucide:shield-alert" :title="t('packagingPayment.noPermission')" class="py-12" />
      <template v-else>
        <QsStatusSwitchToolbar :model-value="status" :items="tabs" :aria-label="t('packagingPayment.listTitle')" class="mb-4" @update:model-value="selectStatus" />
        <QsGenericTable
          v-model:page="page" v-model:page-size="pageSize" v-model:search="keyword"
          row-key="id" :show-row-number="false" :columns="columns" :data="items" :total="total" :loading="loading" :error="error || undefined"
          :addable="false" :page-size-options="[20, 50, 100]" :search-placeholder="t('packagingPayment.search')"
          :empty-title="t('packagingPayment.empty')" :empty-description="t(`packagingPayment.emptyDescription.${status}`)"
          :action-column="{ fixed: 'right', minWidth: actionColumnWidth, width: actionColumnWidth }" table-class="w-max min-w-full"
          @search="search" @pagination-change="load" @retry="load"
        >
          <template #cell-shipmentNo="{ row }">
            <QsCopyableText v-if="row.original.shipmentNo" :label="t('packagingPayment.shipmentNo')" :text="row.original.shipmentNo" />
            <span v-else class="qs-type-data-emphasis whitespace-nowrap">—</span>
          </template>
          <template #cell-shippingMarkText="{ row }">
            <span class="qs-type-data break-all">{{ row.original.shippingMarkText || '—' }}</span>
          </template>
          <template #cell-source="{ row }">
            <QsTableStackedCell>
              <QsTableStackedLine :label="t('packagingPayment.purchaseOrderShort')" content-class="qs-type-data break-all">
                {{ row.original.purchaseOrderNo }}
              </QsTableStackedLine>
              <QsTableStackedLine :label="t('packagingPayment.salesOrderShort')" content-class="qs-type-data break-all" tone="muted">
                {{ row.original.salesOrderNo }}
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <template #cell-packaging="{ row }">
            <QsTableStackedCell>
              <QsTableStackedLine weight="medium">
                {{ row.original.packagingTypeName }}
              </QsTableStackedLine>
              <QsTableStackedLine tone="muted">
                {{ t(`packagingPayment.vendor.${row.original.packagingVendor}`) }}
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <template #cell-amount="{ row }">
            <AmountDisplay :value="row.original.amount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
          </template>
          <template #cell-images="{ row }">
            <PackagingProof :record="row.original" include-payment />
          </template>
          <template #cell-status="{ row }">
            <FaTag
              variant="outline" class="qs-type-status-tag"
              :class="row.original.status === 'PAID'
                ? 'text-primary border-primary/30 bg-primary/10 dark:text-emerald-300'
                : row.original.status === 'CANCELLED'
                  ? 'text-muted-foreground border-border bg-muted/30'
                  : 'text-amber-700 border-amber-500/30 bg-amber-500/10 dark:text-amber-300'"
            >
              {{ t(`packagingPayment.status.${row.original.status}`) }}
            </FaTag>
          </template>
          <template #cell-submitted="{ row }">
            <QsTableStackedCell>
              <QsPersonDisplay :display-name="row.original.submittedBy.name" size="sm" :avatar-url="row.original.submittedBy.avatarUrl" />
              <QsTableStackedLine tone="muted">
                <DateTimeDisplay :value="row.original.submittedAt" />
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <template #cell-paid="{ row }">
            <QsTableStackedCell v-if="row.original.status === 'PAID'">
              <QsPersonDisplay v-if="row.original.paidBy" :display-name="row.original.paidBy.name" size="sm" :avatar-url="row.original.paidBy.avatarUrl" />
              <QsTableStackedLine tone="muted">
                <DateTimeDisplay :value="row.original.paidAt" />
              </QsTableStackedLine>
            </QsTableStackedCell>
            <span v-else class="text-muted-foreground">—</span>
          </template>
          <template #cell-remark="{ row }">
            <span class="whitespace-pre-wrap break-words">{{ row.original.remark || '—' }}</span>
          </template>
          <template #actions="{ row }">
            <div class="flex flex-wrap gap-1 items-center">
              <FaButton
                v-if="canChangeAmount && row.status === 'PENDING_PAYMENT'"
                variant="ghost" size="sm" class="min-h-11 sm:min-h-8"
                :aria-label="`${row.shipmentNo}：${t('packagingPayment.changeAmount')}`"
                @click="openAmount(row)"
              >
                {{ t('packagingPayment.changeAmount') }}
              </FaButton>
              <FaButton
                variant="ghost" size="sm" class="min-h-11 sm:min-h-8"
                :aria-label="`${row.shipmentNo}：${t('packagingPayment.copyRequest')}`"
                @click="copyRequest(row)"
              >
                {{ t('packagingPayment.copyRequest') }}
              </FaButton>
            </div>
          </template>
          <template #mobile-row="{ row }">
            <PackagingMobileRow :record="row" include-payment :show-owner="false" />
          </template>
        </QsGenericTable>
      </template>
    </FaPageMain>
    <AmountModal
      v-model="amountVisible" :record="amountTarget" :enabled="enabled && canChangeAmount"
      @updated="load" @reload="load"
    />
  </div>
</template>
