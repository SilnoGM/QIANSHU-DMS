<script setup lang="ts">
import type { PurchasePayableRow, PurchasePayableSelection } from './purchase-payments.logic'
import type { PurchasePayableDto, PurchasePayableOrderDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn, QsGenericTableGrouping } from '@/components/business/QsGenericTable/logic'
import purchaseOrderPayablesApi from '@/api/modules/purchase-order-payables'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { sumMoneyValues } from '@/components/base/MoneyInput/logic'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { getPurchaseOrderApiFailure } from '../../operations/purchase-orders/purchase-order-list.logic'
import PaymentModal from './payment-modal.vue'
import { canPayPurchasePayable, createPurchasePayableGroups } from './purchase-payments.logic'

defineOptions({ name: 'QsPurchasePayments' })
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const route = useRoute()
const currencyCatalog = useCurrencyCatalog()
const canPay = computed(() => auth('purchase-orders:payment'))
const active = ref(false)
const enabled = computed(() => active.value && canPay.value && route.name === 'qsFinanceRealtimePurchasePayments')
const keyword = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '')
const page = ref(1)
const pageSize = ref(20)
const orders = shallowRef<PurchasePayableOrderDto[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const selection = shallowRef<PurchasePayableSelection | null>(null)
let controller: AbortController | null = null
const groups = computed(() => createPurchasePayableGroups(orders.value))
const grouping: QsGenericTableGrouping<PurchasePayableRow> = { getRows: group => group.children ?? [], getLabel: group => group.order.orderNo }
const amountColumns = ['dueAmount', 'paidAmount', 'remainingAmount'] as const
const statusTagClasses: Record<PurchasePayableDto['status'], string> = {
  PENDING_PAYMENT: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  PAID: 'border-primary/35 bg-primary/10 text-primary',
  NO_PAYMENT: 'border-border bg-muted text-muted-foreground',
  CANCELLED: 'border-border bg-muted text-muted-foreground',
}
const columns = computed<QsGenericTableColumn<PurchasePayableRow>[]>(() => [
  { id: 'paymentType', title: t('purchasePayment.paymentType'), width: 130, fixed: 'left' },
  ...amountColumns.map(id => ({
    id,
    accessorFn: (row: PurchasePayableRow) => row.payable?.[id],
    title: t(`purchasePayment.${id}`),
    width: 155,
    align: 'right' as const,
    summary: { type: 'sum' as const, component: AmountDisplay, componentProps: { currency: 'CNY', currencies: currencyCatalog.currencies.value } },
  })),
  { id: 'status', title: t('purchasePayment.statusLabel'), width: 130 },
  { id: 'paid', title: t('purchasePayment.paidInfo'), width: 185 },
])
const summaryValues = computed(() => Object.fromEntries(amountColumns.map(key => [key, sumMoneyValues(orders.value.flatMap(order => order.items.map(item => item[key])), { precision: 2 })])))

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
    const response = await purchaseOrderPayablesApi.list({ page: page.value, pageSize: pageSize.value, keyword: keyword.value.trim() || undefined }, request.signal)
    if (current()) {
      orders.value = response.data.items
      total.value = response.data.total
      if (!orders.value.length && page.value > 1) {
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
  selection.value = null
  void load()
}
function openPayment(row: PurchasePayableRow) {
  if (enabled.value && !loading.value && row.payable && canPayPurchasePayable(row.payable)) {
    selection.value = { order: row.order, item: row.payable }
  }
}
function applyPayment(updated: PurchasePayableOrderDto) {
  if (updated.items.some(item => item.status === 'PENDING_PAYMENT')) {
    orders.value = orders.value.map(order => order.id === updated.id ? updated : order)
  }
  else {
    const previousCount = orders.value.length
    orders.value = orders.value.filter(order => order.id !== updated.id)
    total.value = Math.max(0, total.value - (previousCount - orders.value.length))
  }
  void load()
}
watch(() => route.query.keyword, (value) => {
  keyword.value = typeof value === 'string' ? value : ''
  search()
})
watch([enabled, () => account.authEpoch], () => {
  orders.value = []
  total.value = 0
  selection.value = null
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
    <FaPageHeader :title="t('workbench.purchasePayments')" :description="t('purchasePayment.intro')">
      <FaButton v-if="canPay" variant="outline" :loading="loading" @click="load">
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('purchasePayment.refresh') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain class="min-w-0">
      <FaEmpty v-if="!canPay" icon="i-lucide:shield-alert" :title="t('purchasePayment.noPermission')" class="py-12" />
      <QsGenericTable
        v-else
        v-model:page="page" v-model:page-size="pageSize" v-model:search="keyword"
        row-key="id" :columns="columns" :data="groups" :grouping="grouping" :total="total" :loading="loading" :error="error || undefined"
        :summary-values="summaryValues" :addable="false" :page-size-options="[20, 50, 100]" :search-placeholder="t('purchasePayment.search')"
        :empty-title="t('purchasePayment.empty')" :empty-description="t('purchasePayment.emptyDescription')" :pagination-unit="t('purchasePayment.paginationUnit')"
        :action-column="{ fixed: 'right', width: 110 }" table-class="min-w-[1030px]"
        @search="search" @pagination-change="load" @retry="load"
      >
        <template #group-header="{ row }">
          <div class="min-w-0 w-full space-y-2">
            <div class="flex flex-wrap gap-x-5 gap-y-2 items-center justify-between">
              <span class="qs-type-data-emphasis break-all">{{ row.order.orderNo }}</span>
              <span class="flex gap-2 items-center">
                <span class="qs-type-meta text-muted-foreground">{{ t('purchasePayment.orderTotal') }}</span>
                <AmountDisplay :value="row.order.purchaseTotalAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
              </span>
            </div>
            <div class="text-sm flex flex-wrap gap-x-5 gap-y-2 items-center">
              <span class="min-w-0 break-words"><span class="text-muted-foreground">{{ t('purchasePayment.supplier') }}：</span>{{ row.order.supplierName }}</span>
              <span><span class="text-muted-foreground">{{ t('purchasePayment.orderDate') }}：</span><time :datetime="row.order.orderDate" class="qs-type-data">{{ row.order.orderDate }}</time></span>
              <span class="flex gap-1 items-center">
                <span class="text-muted-foreground">{{ t('purchasePayment.owner') }}：</span>
                <span v-if="row.order.accountOwnerType === 'COMPANY'">{{ t('purchasePayment.companyAccount') }}</span>
                <QsPersonDisplay v-else-if="row.order.owner" :display-name="row.order.owner.name" size="sm" />
                <span v-else>{{ t('purchasePayment.ownerUnavailable') }}</span>
              </span>
            </div>
          </div>
        </template>
        <template #cell-paymentType="{ row }">
          <span v-if="row.original.payable" class="font-medium">{{ t(`purchasePayment.types.${row.original.payable.paymentType}`) }}</span>
        </template>
        <template v-for="column in amountColumns" :key="column" #[`cell-${column}`]="{ row }">
          <AmountDisplay v-if="row.original.payable" :value="row.original.payable[column]" currency="CNY" :currencies="currencyCatalog.currencies.value" />
        </template>
        <template #cell-status="{ row }">
          <FaTag v-if="row.original.payable" variant="outline" class="qs-type-status-tag" :class="statusTagClasses[row.original.payable.status]">
            {{ t(`purchasePayment.status.${row.original.payable.status}`) }}
          </FaTag>
        </template>
        <template #cell-paid="{ row }">
          <div v-if="row.original.payable?.paidAt" class="flex flex-col gap-1 items-start">
            <QsPersonDisplay v-if="row.original.payable.paidBy" :display-name="row.original.payable.paidBy.name" size="sm" />
            <DateTimeDisplay :value="row.original.payable.paidAt" class="text-muted-foreground" />
          </div>
          <span v-else class="text-muted-foreground">—</span>
        </template>
        <template #actions="{ row }">
          <FaButton v-if="row.payable && canPayPurchasePayable(row.payable)" variant="ghost" size="sm" class="min-h-11 sm:min-h-8" :disabled="loading" :aria-label="t('purchasePayment.payLabel', { orderNo: row.order.orderNo, paymentType: t(`purchasePayment.types.${row.payable.paymentType}`) })" @click="openPayment(row)">
            <FaIcon name="i-lucide:wallet" aria-hidden="true" />{{ t('purchasePayment.pay') }}
          </FaButton>
          <span v-else-if="row.payable" class="text-muted-foreground">{{ t(`purchasePayment.status.${row.payable.status}`) }}</span>
        </template>
        <template #mobile-row="{ row }">
          <template v-if="row.payable">
            <div class="flex gap-3 items-center justify-between">
              <strong>{{ t(`purchasePayment.types.${row.payable.paymentType}`) }}</strong>
              <FaTag variant="outline" class="qs-type-status-tag" :class="statusTagClasses[row.payable.status]">
                {{ t(`purchasePayment.status.${row.payable.status}`) }}
              </FaTag>
            </div>
            <dl class="m-0 mt-3 space-y-2">
              <div v-for="column in amountColumns" :key="column" class="flex gap-3 items-center justify-between">
                <dt class="qs-type-compact-label">
                  {{ t(`purchasePayment.${column}`) }}
                </dt>
                <dd class="m-0">
                  <AmountDisplay :value="row.payable[column]" currency="CNY" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
            </dl>
            <div v-if="row.payable.paidAt" class="text-muted-foreground mt-3 flex flex-wrap gap-2 items-center">
              <QsPersonDisplay v-if="row.payable.paidBy" :display-name="row.payable.paidBy.name" size="sm" />
              <DateTimeDisplay :value="row.payable.paidAt" />
            </div>
          </template>
        </template>
      </QsGenericTable>
    </FaPageMain>
    <PaymentModal v-if="selection" :selection="selection" :enabled="enabled" @close="selection = null" @changed="applyPayment" @refresh="load" />
  </div>
</template>
