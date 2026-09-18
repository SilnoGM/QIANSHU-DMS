<script setup lang="ts">
import type { PackagingCostRequestDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import packagingCostsApi from '@/api/modules/packaging-costs'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { getPurchaseOrderApiFailure } from '../../operations/purchase-orders/purchase-order-list.logic'
import PackagingMobileRow from './mobile-row.vue'
import PackagingProof from './packaging-proof.vue'

defineOptions({ name: 'QsPackagingPayments' })
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const route = useRoute()
const router = useRouter()
const currencyCatalog = useCurrencyCatalog()
const canRead = computed(() => auth('packaging-costs:read'))
const canPay = computed(() => canRead.value && auth('packaging-costs:pay'))
const active = ref(false)
const enabled = computed(() => active.value && canRead.value && route.name === 'qsFinanceRealtimePackagingPayments')
const status = ref<PackagingCostRequestDto['status']>('PENDING_PAYMENT')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const items = shallowRef<PackagingCostRequestDto[]>([])
const total = ref(0)
const counts = ref({ PENDING_PAYMENT: 0, PAID: 0 })
const loading = ref(false)
const error = ref('')
let controller: AbortController | null = null
const tabs = computed(() => (['PENDING_PAYMENT', 'PAID'] as const).map(value => ({ value, label: t(`packagingPayment.status.${value}`), count: counts.value[value] })))
const columns = computed<QsGenericTableColumn<PackagingCostRequestDto>[]>(() => [
  { id: 'shipmentNo', accessorKey: 'shipmentNo', title: t('packagingPayment.shipmentNo'), minWidth: 230, fixed: 'left', copyable: true },
  { id: 'shippingMarkText', accessorKey: 'shippingMarkText', title: t('packagingPayment.shippingMarkText'), minWidth: 250, copyable: true },
  { id: 'source', title: t('packagingPayment.source'), minWidth: 240 },
  { id: 'packaging', title: t('packagingPayment.packagingInfo'), minWidth: 165 },
  { id: 'amount', accessorKey: 'amount', title: t('packagingPayment.amount'), minWidth: 150, align: 'right' },
  { id: 'images', title: t('packagingPayment.imagesTitle'), minWidth: 140 },
  { id: 'owner', accessorFn: record => record.owner.name, title: t('packagingPayment.owner'), minWidth: 150 },
  { id: 'submitted', accessorKey: 'submittedAt', title: t('packagingPayment.submitted'), minWidth: 185 },
  ...(status.value === 'PAID' ? [{ id: 'paid', accessorKey: 'paidAt', title: t('packagingPayment.paid'), minWidth: 185 }] : []),
  { id: 'remark', accessorKey: 'remark', title: t('packagingPayment.remark'), minWidth: 200 },
])
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
    const response = await packagingCostsApi.list({ page: page.value, pageSize: pageSize.value, status: status.value, keyword: keyword.value.trim() || undefined }, request.signal)
    if (current()) {
      items.value = response.data.items
      total.value = response.data.total
      counts.value = response.data.statusCounts
      // 最后一条付款后，回到仍有记录的最后一页。
      if (!items.value.length && page.value > 1) {
        page.value = Math.max(1, Math.ceil(total.value / pageSize.value))
        void load()
      }
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
function search() {
  page.value = 1
  void load()
}
function selectStatus(value: string | number) {
  if (value === 'PENDING_PAYMENT' || value === 'PAID') {
    status.value = value
    search()
  }
}
function openPayment(record: PackagingCostRequestDto) {
  if (enabled.value && canPay.value && record.status === 'PENDING_PAYMENT') {
    void router.push({ name: 'qsFinanceRealtimePackagingPayment', params: { requestId: record.id } })
  }
}
function openPaidDetail(record: PackagingCostRequestDto) {
  if (enabled.value && record.status === 'PAID') {
    void router.push({ name: 'qsFinanceRealtimePackagingPayment', params: { requestId: record.id } })
  }
}
watch([enabled, () => account.authEpoch], () => {
  items.value = []
  total.value = 0
  counts.value = { PENDING_PAYMENT: 0, PAID: 0 }
  void load()
}, { immediate: true, flush: 'sync' })
onMounted(() => active.value = true)
onActivated(() => active.value = true)
onDeactivated(() => active.value = false)
onBeforeUnmount(() => {
  active.value = false
  controller?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.packagingPayments')" :description="t('packagingPayment.intro')">
      <FaButton v-if="canRead" variant="outline" :loading="loading" @click="load">
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('packagingPayment.refresh') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain class="min-w-0">
      <FaEmpty v-if="!canRead" icon="i-lucide:shield-alert" :title="t('packagingPayment.noPermission')" class="py-12" />
      <template v-else>
        <QsStatusSwitchToolbar :model-value="status" :items="tabs" :aria-label="t('workbench.packagingPayments')" class="mb-4" @update:model-value="selectStatus" />
        <QsGenericTable
          v-model:page="page" v-model:page-size="pageSize" v-model:search="keyword"
          row-key="id" :show-row-number="false" :columns="columns" :data="items" :total="total" :loading="loading" :error="error || undefined"
          :addable="false" :page-size-options="[20, 50, 100]" :search-placeholder="t('packagingPayment.search')"
          :empty-title="t('packagingPayment.empty')" :empty-description="t(`packagingPayment.emptyDescription.${status}`)"
          :action-column="{ fixed: 'right', width: 110 }" table-class="w-max min-w-full"
          @search="search" @pagination-change="load" @retry="load"
        >
          <template #cell-shipmentNo="{ row }">
            <span class="qs-type-data-emphasis whitespace-nowrap">{{ row.original.shipmentNo || '—' }}</span>
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
            <PackagingProof :record="row.original" />
          </template>
          <template #cell-owner="{ row }">
            <QsPersonDisplay :display-name="row.original.owner.name" size="sm" />
          </template>
          <template #cell-submitted="{ row }">
            <QsTableStackedCell>
              <QsPersonDisplay :display-name="row.original.submittedBy.name" size="sm" />
              <QsTableStackedLine tone="muted">
                <DateTimeDisplay :value="row.original.submittedAt" />
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <template #cell-paid="{ row }">
            <QsTableStackedCell>
              <QsPersonDisplay v-if="row.original.paidBy" :display-name="row.original.paidBy.name" size="sm" />
              <QsTableStackedLine tone="muted">
                <DateTimeDisplay :value="row.original.paidAt" />
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <template #cell-remark="{ row }">
            <span class="whitespace-pre-wrap break-words">{{ row.original.remark || '—' }}</span>
          </template>
          <template #actions="{ row }">
            <FaButton v-if="canPay && row.status === 'PENDING_PAYMENT'" variant="ghost" size="sm" class="min-h-11 sm:min-h-8" :aria-label="`${row.shipmentNo}：${t('packagingPayment.pay')}`" @click="openPayment(row)">
              <FaIcon name="i-lucide:wallet" aria-hidden="true" />{{ t('packagingPayment.pay') }}
            </FaButton>
            <FaButton v-else-if="row.status === 'PAID'" variant="ghost" size="sm" class="min-h-11 sm:min-h-8" :aria-label="`${row.shipmentNo}：${t('packagingPayment.view')}`" @click="openPaidDetail(row)">
              <FaIcon name="i-lucide:eye" aria-hidden="true" />{{ t('packagingPayment.view') }}
            </FaButton>
            <span v-else class="text-muted-foreground">—</span>
          </template>
          <template #mobile-row="{ row }">
            <PackagingMobileRow :record="row" />
          </template>
        </QsGenericTable>
      </template>
    </FaPageMain>
  </div>
</template>
