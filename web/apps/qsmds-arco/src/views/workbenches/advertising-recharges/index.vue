<script setup lang="ts">
import type { AdvertisingRechargeDto } from '@/api/generated/types.gen'
import type { AdvertisingRechargeListQuery } from '@/api/modules/advertising-recharges'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { getApiClientFailureMessage } from '@/api/errors'
import advertisingRechargesApi from '@/api/modules/advertising-recharges'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import {
  ADVERTISING_RECHARGE_STATUS_FILTER_OPTIONS,
  advertisingRechargeStatusMeta,
} from '../network-ads/advertising-recharges/logic'
import { sumAdvertisingRechargeCounts } from '../network-ads/advertising-recharges/recharge-form'

defineOptions({ name: 'FinanceAdvertisingRecharges' })

const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const router = useRouter()
const route = useRoute()
const currencyCatalog = useCurrencyCatalog()
const canRead = computed(() => auth('advertising-recharges:read'))
const active = ref(false)
const status = ref<'ALL' | AdvertisingRechargeDto['status']>('ALL')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const items = ref<AdvertisingRechargeDto[]>([])
const counts = ref<Record<string, number>>({})
const loading = ref(false)
const loadError = ref('')
let controller: AbortController | null = null

const enabled = computed(() => active.value && canRead.value && route.name === 'qsFinanceRealtimeAdvertisingRecharges')
const toolbarItems = computed(() => ADVERTISING_RECHARGE_STATUS_FILTER_OPTIONS.map(option => ({
  value: option.value,
  label: t(option.labelKey),
  count: counts.value[option.value] ?? 0,
})))
const columns = computed<QsGenericTableColumn<AdvertisingRechargeDto>[]>(() => [
  { id: 'rechargeNo', accessorKey: 'rechargeNo', title: t('advertisingRecharge.field.rechargeNo'), minWidth: 170, fixed: 'left', cellClass: 'qs-type-data-emphasis', mobileCellClass: 'qs-type-data-emphasis' },
  { id: 'applicant', accessorFn: row => row.applicant.name, title: t('advertisingRecharge.field.applicant'), minWidth: 140 },
  { id: 'adAccountName', accessorKey: 'adAccountName', title: t('advertisingRecharge.field.adAccountName'), minWidth: 180 },
  { id: 'adAccountNo', accessorKey: 'adAccountNo', title: t('advertisingRecharge.field.adAccountNo'), minWidth: 160 },
  { id: 'rechargeAmount', accessorKey: 'rechargeAmount', title: t('advertisingRecharge.field.rechargeAmount'), minWidth: 150, align: 'right' },
  { id: 'paymentAmount', accessorFn: row => row.payment?.amountCny ?? '', title: t('advertisingRecharge.field.paymentAmount'), minWidth: 150, align: 'right' },
  { id: 'status', accessorKey: 'status', title: t('advertisingRecharge.field.status'), minWidth: 110 },
  { id: 'submittedAt', accessorKey: 'submittedAt', title: t('advertisingRecharge.field.submittedAt'), minWidth: 185 },
])

async function load(): Promise<void> {
  controller?.abort()
  if (!enabled.value) {
    loading.value = false
    return
  }
  const request = new AbortController()
  controller = request
  loading.value = true
  loadError.value = ''
  try {
    const query: AdvertisingRechargeListQuery = {
      page: page.value,
      pageSize: pageSize.value,
      status: status.value,
      ...(keyword.value.trim().length === 0 ? {} : { keyword: keyword.value.trim() }),
    }
    const response = await advertisingRechargesApi.list(query, request.signal)
    if (!request.signal.aborted && controller === request) {
      items.value = response.data.items
      total.value = response.data.total
      counts.value = sumAdvertisingRechargeCounts(response.data.statusCounts)
      if (!items.value.length && page.value > 1) {
        page.value = Math.max(1, Math.ceil(total.value / pageSize.value))
        void load()
      }
    }
  }
  catch (failure) {
    if (!request.signal.aborted && controller === request) {
      loadError.value = getApiClientFailureMessage(failure, t('advertisingRecharge.error.load'))
    }
  }
  finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

function search(value: string): void {
  keyword.value = value
  page.value = 1
  void load()
}

function openDetail(row: AdvertisingRechargeDto): void {
  if (!enabled.value || loading.value) {
    return
  }
  void router.push({ name: 'qsFinanceRealtimeAdvertisingRechargeDetail', params: { id: row.id } })
}

watch(() => route.query.keyword, (value) => {
  keyword.value = typeof value === 'string' ? value : ''
}, { immediate: true })

watch([enabled, status, page, pageSize, () => account.authEpoch], () => {
  if (enabled.value) {
    void load()
  }
}, { immediate: true })

watch(status, () => {
  page.value = 1
})

onMounted(() => {
  active.value = true
})
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
  controller?.abort()
  controller = null
  loading.value = false
})
onBeforeUnmount(() => {
  active.value = false
  controller?.abort()
  controller = null
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('advertisingRecharge.financePageTitle')" :description="t('advertisingRecharge.financePageDescription')" />

    <FaPageMain class="min-w-0">
      <QsStatusSwitchToolbar
        v-model="status"
        :items="toolbarItems"
        :aria-label="t('advertisingRecharge.financePageTitle')"
        class="mb-4"
      />
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        row-key="id"
        :columns="columns"
        :data="items"
        :total="total"
        :loading="loading"
        :error="loadError || undefined"
        :addable="false"
        searchable
        :search-placeholder="t('advertisingRecharge.financeSearchPlaceholder')"
        :page-size-options="[20, 50, 100]"
        :empty-title="t('advertisingRecharge.empty.all')"
        :empty-description="t('advertisingRecharge.empty.allHint')"
        :action-column="{ fixed: 'right', minWidth: 84, width: 84, title: t('advertisingRecharge.field.action') }"
        table-class="w-max min-w-full"
        :aria-label="t('advertisingRecharge.financePageTitle')"
        @search="search"
        @pagination-change="load"
        @retry="load"
      >
        <template #cell-applicant="{ row }">
          <QsPersonDisplay :display-name="row.original.applicant.name" size="md" :avatar-url="row.original.applicant.avatarUrl" />
        </template>

        <template #cell-rechargeAmount="{ row }">
          <AmountDisplay
            :value="row.original.rechargeAmount"
            :currency="row.original.rechargeCurrency"
            :currencies="currencyCatalog.currencies.value"
          />
        </template>

        <template #cell-paymentAmount="{ row }">
          <AmountDisplay
            v-if="row.original.payment"
            :value="row.original.payment.amountCny"
            currency="CNY"
            :currencies="currencyCatalog.currencies.value"
          />
          <span v-else class="text-muted-foreground">—</span>
        </template>

        <template #cell-status="{ row }">
          <span class="qs-type-tag px-2 py-0.5 border rounded-md" :class="advertisingRechargeStatusMeta(row.original.status).tagClass">
            {{ t(advertisingRechargeStatusMeta(row.original.status).labelKey) }}
          </span>
        </template>

        <template #cell-submittedAt="{ row }">
          <DateTimeDisplay :value="row.original.submittedAt" format="datetime" />
        </template>

        <template #actions="{ row }">
          <FaButton
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :aria-label="`${row.rechargeNo} · ${t('advertisingRecharge.action.view')}`"
            @click="openDetail(row)"
          >
            {{ t('advertisingRecharge.action.view') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </FaPageMain>
  </div>
</template>
