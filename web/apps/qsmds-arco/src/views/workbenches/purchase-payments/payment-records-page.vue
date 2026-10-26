<script setup lang="ts">
import type { PurchasePaymentRecordStatusFilter } from './payment-records.logic'
import type { PurchasePaymentRecordDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'

import purchaseOrderPaymentsApi from '@/api/modules/purchase-order-payments'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import { getPurchaseOrderApiFailure } from '../../operations/purchase-orders/purchase-order-list.logic'
import {
  canVoidPurchasePaymentRecord,
  purchasePaymentRecordStatusFilterItems,
} from './payment-records.logic'
import PurchasePaymentVoidModal from './payment-void-modal.vue'

defineOptions({ name: 'QsPurchasePaymentRecordsPage' })

const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const route = useRoute()
const router = useRouter()
const currencyCatalog = useCurrencyCatalog()
const methodCatalog = useDictionaryCatalog('payment.method')

const canPay = computed(() => auth('purchase-orders:payment'))
const active = ref(false)
const enabled = computed(() => (
  active.value
  && canPay.value
  && route.name === 'qsFinanceRealtimePurchasePaymentRecords'
))
const status = ref<PurchasePaymentRecordStatusFilter>('ALL')
const statusItems = computed(() => purchasePaymentRecordStatusFilterItems(
  key => t(key),
))
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const items = shallowRef<PurchasePaymentRecordDto[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const voidVisible = ref(false)
const voidTarget = shallowRef<PurchasePaymentRecordDto | null>(null)
let controller: AbortController | null = null

const statusTagClasses: Record<'ACTIVE' | 'VOIDED', string> = {
  ACTIVE: 'border-primary/30 bg-primary/10 text-primary',
  VOIDED: 'border-destructive/30 bg-destructive/10 text-destructive',
}

const columns = computed<QsGenericTableColumn<PurchasePaymentRecordDto>[]>(() => [
  {
    id: 'orderNo',
    accessorKey: 'orderNo',
    title: t('purchasePayment.records.orderNo'),
    minWidth: 168,
    fixed: 'left',
    mobileCellClass: 'qs-type-data-emphasis',
  },
  {
    id: 'supplier',
    accessorKey: 'supplierName',
    title: t('purchasePayment.records.supplier'),
    minWidth: 150,
  },
  {
    id: 'paymentType',
    title: t('purchasePayment.records.paymentType'),
    width: 100,
  },
  {
    id: 'amount',
    accessorKey: 'amount',
    title: t('purchasePayment.records.amount'),
    width: 150,
    align: 'right',
  },
  {
    id: 'paidAt',
    accessorKey: 'paidAt',
    title: t('purchasePayment.records.paidAt'),
    width: 175,
  },
  {
    id: 'method',
    title: t('purchasePayment.records.method'),
    width: 130,
  },
  {
    id: 'recordedBy',
    title: t('purchasePayment.records.recordedBy'),
    width: 160,
  },
  {
    id: 'status',
    title: t('purchasePayment.records.status'),
    width: 110,
  },
  {
    id: 'voidInfo',
    title: t('purchasePayment.records.voidInfo'),
    minWidth: 240,
  },
])

function methodLabel(record: PurchasePaymentRecordDto): string {
  return methodCatalog.resolve(record.paymentMethod)?.label
    ?? record.paymentMethod
}

function paymentTypeLabel(record: PurchasePaymentRecordDto): string {
  return t(`purchasePayment.types.${record.paymentType}`)
}

async function load(): Promise<void> {
  controller?.abort()
  if (!enabled.value) {
    loading.value = false
    return
  }
  const request = new AbortController()
  controller = request
  const requestEpoch = account.authEpoch
  loading.value = true
  error.value = ''
  const current = () => (
    controller === request
    && !request.signal.aborted
    && enabled.value
    && account.authEpoch === requestEpoch
  )
  try {
    const response = await purchaseOrderPaymentsApi.list({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim() || undefined,
      status: status.value,
    }, request.signal)
    if (current()) {
      items.value = response.data.items
      total.value = response.data.total
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

function search(): void {
  page.value = 1
  void load()
}

function selectStatus(value: string): void {
  if (value !== 'ALL' && value !== 'ACTIVE' && value !== 'VOIDED') {
    return
  }
  status.value = value
  page.value = 1
  items.value = []
  void load()
}

function openVoid(record: PurchasePaymentRecordDto): void {
  if (!canVoidPurchasePaymentRecord(record)) {
    return
  }
  voidTarget.value = record
  voidVisible.value = true
}

function handleVoided(): void {
  void load()
}

function refreshOnFocus(): void {
  if (enabled.value) {
    void load()
  }
}

function goBack(): void {
  void router.push({ name: 'qsFinanceRealtimePurchasePayments' })
}

watch([enabled, () => account.authEpoch], () => {
  items.value = []
  total.value = 0
  void load()
}, { immediate: true, flush: 'sync' })

onMounted(() => {
  active.value = true
  window.addEventListener('focus', refreshOnFocus)
})
onActivated(() => active.value = true)
onDeactivated(() => active.value = false)
onBeforeUnmount(() => {
  active.value = false
  controller?.abort()
  window.removeEventListener('focus', refreshOnFocus)
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader
      :title="t('purchasePayment.records.title')"
      :description="t('purchasePayment.records.description')"
    >
      <FaButton
        variant="outline"
        class="min-h-11 sm:min-h-9"
        @click="goBack"
      >
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />
        {{ t('purchasePayment.records.back') }}
      </FaButton>
      <FaButton
        variant="outline"
        class="min-h-11 sm:min-h-9"
        :disabled="!enabled || loading"
        @click="load"
      >
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />
        {{ t('purchasePayment.records.refresh') }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain class="min-w-0">
      <FaEmpty
        v-if="!canPay"
        icon="i-lucide:shield-alert"
        :title="t('purchasePayment.records.noPermission')"
        class="py-12"
      />
      <div v-else class="min-w-0 space-y-4">
        <QsStatusSwitchToolbar
          :model-value="status"
          :items="statusItems"
          :aria-label="t('purchasePayment.records.status')"
          @update:model-value="selectStatus"
        />
        <QsGenericTable
          v-model:page="page"
          v-model:page-size="pageSize"
          v-model:search="keyword"
          row-key="id"
          :columns="columns"
          :data="items"
          :total="total"
          :loading="loading"
          :error="error || undefined"
          :addable="false"
          :page-size-options="[20, 50, 100]"
          :search-placeholder="t('purchasePayment.records.search')"
          :empty-title="t('purchasePayment.records.empty')"
          :empty-description="t('purchasePayment.records.emptyDescription')"
          :pagination-unit="t('purchasePayment.records.paginationUnit')"
          :action-column="{ fixed: 'right', minWidth: 96, width: 96 }"
          table-class="min-w-[1530px]"
          @search="search"
          @pagination-change="load"
          @retry="load"
        >
          <template #cell-paymentType="{ row }">
            <span class="font-medium">{{ paymentTypeLabel(row.original) }}</span>
          </template>
          <template #cell-amount="{ row }">
            <AmountDisplay
              :value="row.original.amount"
              currency="CNY"
              :currencies="currencyCatalog.currencies.value"
            />
          </template>
          <template #cell-paidAt="{ row }">
            <DateTimeDisplay :value="row.original.paidAt" />
          </template>
          <template #cell-method="{ row }">
            {{ methodLabel(row.original) }}
          </template>
          <template #cell-recordedBy="{ row }">
            <QsPersonDisplay
              :display-name="row.original.createdBy.displayName"
              size="md"
              :avatar-url="row.original.createdBy.avatarUrl"
            />
          </template>
          <template #cell-status="{ row }">
            <FaTag
              variant="outline"
              class="qs-type-status-tag"
              :class="statusTagClasses[row.original.voidedAt === null ? 'ACTIVE' : 'VOIDED']"
            >
              {{ t(row.original.voidedAt === null ? 'purchasePayment.records.valid' : 'purchasePayment.records.voided') }}
            </FaTag>
          </template>
          <template #cell-voidInfo="{ row }">
            <div v-if="row.original.voidedAt" class="flex flex-col gap-1 items-start">
              <QsPersonDisplay
                v-if="row.original.voidedBy"
                :display-name="row.original.voidedBy.displayName"
                size="sm"
                :avatar-url="row.original.voidedBy.avatarUrl"
              />
              <DateTimeDisplay :value="row.original.voidedAt" class="text-muted-foreground" />
              <FaTooltip :text="row.original.voidReason ?? '—'">
                <span class="qs-type-meta max-w-56 block truncate">{{ row.original.voidReason ?? '—' }}</span>
              </FaTooltip>
            </div>
            <span v-else class="text-muted-foreground">—</span>
          </template>
          <template #actions="{ row }">
            <FaButton
              v-if="canVoidPurchasePaymentRecord(row)"
              variant="ghost"
              size="sm"
              class="text-destructive min-h-11 sm:min-h-8"
              :disabled="loading || !enabled"
              @click="openVoid(row)"
            >
              {{ t('purchasePayment.records.voidAction') }}
            </FaButton>
            <span v-else class="text-muted-foreground">
              {{ t('purchasePayment.records.voided') }}
            </span>
          </template>
          <template #mobile-row="{ row }">
            <div class="flex flex-col gap-3">
              <div class="flex gap-3 items-start justify-between">
                <div class="min-w-0">
                  <span class="qs-type-data-emphasis block break-all">{{ row.orderNo }}</span>
                  <span class="qs-type-meta text-muted-foreground mt-1 block">{{ row.supplierName }}</span>
                </div>
                <FaTag
                  variant="outline"
                  class="qs-type-status-tag shrink-0"
                  :class="statusTagClasses[row.voidedAt === null ? 'ACTIVE' : 'VOIDED']"
                >
                  {{ t(row.voidedAt === null ? 'purchasePayment.records.valid' : 'purchasePayment.records.voided') }}
                </FaTag>
              </div>
              <dl class="m-0 gap-3 grid grid-cols-2">
                <div>
                  <dt class="qs-type-compact-label mb-1">
                    {{ t('purchasePayment.records.paymentType') }}
                  </dt>
                  <dd class="m-0">
                    {{ paymentTypeLabel(row) }}
                  </dd>
                </div>
                <div class="text-right">
                  <dt class="qs-type-compact-label mb-1">
                    {{ t('purchasePayment.records.amount') }}
                  </dt>
                  <dd class="m-0">
                    <AmountDisplay
                      :value="row.amount"
                      currency="CNY"
                      :currencies="currencyCatalog.currencies.value"
                    />
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-compact-label mb-1">
                    {{ t('purchasePayment.records.paidAt') }}
                  </dt>
                  <dd class="m-0">
                    <DateTimeDisplay :value="row.paidAt" />
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-compact-label mb-1">
                    {{ t('purchasePayment.records.method') }}
                  </dt>
                  <dd class="m-0">
                    {{ methodLabel(row) }}
                  </dd>
                </div>
                <div class="col-span-2">
                  <dt class="qs-type-compact-label mb-1">
                    {{ t('purchasePayment.records.recordedBy') }}
                  </dt>
                  <dd class="m-0">
                    <QsPersonDisplay
                      :display-name="row.createdBy.displayName"
                      size="sm"
                      :avatar-url="row.createdBy.avatarUrl"
                    />
                  </dd>
                </div>
                <div v-if="row.voidedAt" class="col-span-2">
                  <dt class="qs-type-compact-label mb-1">
                    {{ t('purchasePayment.records.voidInfo') }}
                  </dt>
                  <dd class="m-0 space-y-1">
                    <QsPersonDisplay
                      v-if="row.voidedBy"
                      :display-name="row.voidedBy.displayName"
                      size="sm"
                      :avatar-url="row.voidedBy.avatarUrl"
                    />
                    <DateTimeDisplay :value="row.voidedAt" class="text-muted-foreground" />
                    <p class="text-sm m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {{ row.voidReason ?? '—' }}
                    </p>
                  </dd>
                </div>
              </dl>
              <FaButton
                v-if="canVoidPurchasePaymentRecord(row)"
                variant="outline"
                class="min-h-11 w-full"
                :disabled="loading || !enabled"
                @click="openVoid(row)"
              >
                {{ t('purchasePayment.records.voidAction') }}
              </FaButton>
            </div>
          </template>
        </QsGenericTable>
      </div>
    </FaPageMain>

    <PurchasePaymentVoidModal
      v-model="voidVisible"
      :record="voidTarget"
      :currencies="currencyCatalog.currencies.value"
      @voided="handleVoided"
    />
  </div>
</template>
