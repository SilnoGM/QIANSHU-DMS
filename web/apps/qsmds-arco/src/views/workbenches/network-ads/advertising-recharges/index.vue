<script setup lang="ts">
import type { AdvertisingRechargeCreatePayload } from './create-modal.vue'
import type { RechargeImageUploadFile } from './use-recharge-image-upload'
import type { AdvertisingRechargeDto } from '@/api/generated/types.gen'
import type { AdvertisingRechargeListSelfQuery } from '@/api/modules/advertising-recharges'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { getApiClientFailureMessage } from '@/api/errors'
import advertisingRechargesApi from '@/api/modules/advertising-recharges'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import CreateModal from './create-modal.vue'
import DetailDrawer from './detail-drawer.vue'
import {
  ADVERTISING_RECHARGE_STATUS_FILTER_OPTIONS,
  advertisingRechargeStatusMeta,
} from './logic'
import { resolveRechargeCurrencies, sumAdvertisingRechargeCounts } from './recharge-form'

defineOptions({ name: 'NetworkAdsAdvertisingRecharges' })

const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()
const canRead = computed(() => auth('advertising-recharges:read-self'))
const canCreate = computed(() => auth('advertising-recharges:create'))
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
const createOpen = ref(false)
const createKey = ref('')
const creating = ref(false)
const createError = ref('')
const created = ref<AdvertisingRechargeDto | null>(null)
const detailOpen = ref(false)
const detail = ref<AdvertisingRechargeDto | null>(null)
let controller: AbortController | null = null

const enabled = computed(() => active.value && canRead.value)
const rechargeCurrencies = computed(() => resolveRechargeCurrencies(currencyCatalog.currencies.value))
const toolbarItems = computed(() => ADVERTISING_RECHARGE_STATUS_FILTER_OPTIONS.map(option => ({
  value: option.value,
  label: t(option.labelKey),
  count: counts.value[option.value] ?? 0,
})))
const columns = computed<QsGenericTableColumn<AdvertisingRechargeDto>[]>(() => [
  { id: 'rechargeNo', accessorKey: 'rechargeNo', title: t('advertisingRecharge.field.rechargeNo'), minWidth: 170, fixed: 'left', cellClass: 'qs-type-data-emphasis', mobileCellClass: 'qs-type-data-emphasis' },
  { id: 'adAccountName', accessorKey: 'adAccountName', title: t('advertisingRecharge.field.adAccountName'), minWidth: 180 },
  { id: 'adAccountNo', accessorKey: 'adAccountNo', title: t('advertisingRecharge.field.adAccountNo'), minWidth: 160 },
  { id: 'rechargeAmount', accessorKey: 'rechargeAmount', title: t('advertisingRecharge.field.rechargeAmount'), minWidth: 150, align: 'right' },
  { id: 'status', accessorKey: 'status', title: t('advertisingRecharge.field.status'), minWidth: 110 },
  { id: 'paymentAmount', accessorFn: row => row.payment?.amountCny ?? '', title: t('advertisingRecharge.field.paymentAmount'), minWidth: 150, align: 'right' },
  { id: 'submittedAt', accessorKey: 'submittedAt', title: t('advertisingRecharge.field.submittedAt'), minWidth: 185 },
])

const uploadQr: RechargeImageUploadFile = async (file, signal) => {
  const response = await advertisingRechargesApi.uploadQr(file, signal)
  return { mediaAssetId: response.data.mediaAssetId }
}

async function load(): Promise<void> {
  controller?.abort()
  if (!enabled.value) {
    return
  }
  const request = new AbortController()
  controller = request
  loading.value = true
  loadError.value = ''
  try {
    const query: AdvertisingRechargeListSelfQuery = {
      page: page.value,
      pageSize: pageSize.value,
      status: status.value,
      ...(keyword.value.trim().length === 0 ? {} : { keyword: keyword.value.trim() }),
    }
    const response = await advertisingRechargesApi.listSelf(query, request.signal)
    if (!request.signal.aborted && controller === request) {
      items.value = response.data.items
      total.value = response.data.total
      counts.value = sumAdvertisingRechargeCounts(response.data.statusCounts)
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

function openCreate(): void {
  if (!canCreate.value) {
    return
  }
  createKey.value = crypto.randomUUID()
  creating.value = false
  createError.value = ''
  created.value = null
  createOpen.value = true
}

async function submitCreate(payload: AdvertisingRechargeCreatePayload): Promise<void> {
  if (creating.value) {
    return
  }
  creating.value = true
  createError.value = ''
  try {
    const response = await advertisingRechargesApi.create({
      accountType: payload.accountType,
      adAccountName: payload.adAccountName,
      adAccountNo: payload.adAccountNo,
      rechargeAmount: payload.rechargeAmount,
      rechargeCurrency: payload.rechargeCurrency as 'USD' | 'CNY',
      ...(payload.paymentQrMediaAssetId === undefined ? {} : { paymentQrMediaAssetId: payload.paymentQrMediaAssetId }),
      ...(payload.remark === undefined ? {} : { remark: payload.remark }),
    }, createKey.value)
    created.value = response.data
    toast.success(t('advertisingRecharge.toast.submitted'))
    if (status.value !== 'ALL' || page.value !== 1) {
      status.value = 'ALL'
      page.value = 1
    }
    else {
      void load()
    }
  }
  catch (failure) {
    createError.value = getApiClientFailureMessage(failure, t('advertisingRecharge.error.submit'))
  }
  finally {
    creating.value = false
  }
}

function openDetail(row: AdvertisingRechargeDto): void {
  detail.value = row
  detailOpen.value = true
}

function applyChanged(updated: AdvertisingRechargeDto): void {
  detail.value = updated
  const index = items.value.findIndex(item => item.id === updated.id)
  if (index >= 0) {
    items.value = items.value.map(item => item.id === updated.id ? updated : item)
  }
  void load()
}

watch(() => account.authEpoch, () => {
  controller?.abort()
  controller = null
  loading.value = false
  items.value = []
  counts.value = {}
  total.value = 0
  createOpen.value = false
  detailOpen.value = false
  detail.value = null
})

watch([enabled, status, page, pageSize, () => account.authEpoch], () => {
  if (enabled.value) {
    void load()
  }
}, { immediate: true })

watch(status, () => {
  page.value = 1
})

watch(createOpen, (open) => {
  if (!open) {
    created.value = null
    createError.value = ''
  }
})

onMounted(() => {
  active.value = true
})
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
  createOpen.value = false
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
    <FaPageHeader :title="t('advertisingRecharge.pageTitle')" :description="t('advertisingRecharge.pageDescription')">
      <FaButton v-if="canCreate" @click="openCreate">
        <FaIcon name="i-lucide:plus" aria-hidden="true" />
        {{ t('advertisingRecharge.action.create') }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain class="min-w-0">
      <QsStatusSwitchToolbar
        v-model="status"
        :items="toolbarItems"
        :aria-label="t('advertisingRecharge.pageTitle')"
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
        :search-placeholder="t('advertisingRecharge.searchPlaceholder')"
        :page-size-options="[20, 50, 100]"
        :empty-title="t('advertisingRecharge.empty.own')"
        :empty-description="t('advertisingRecharge.empty.ownHint')"
        :action-column="{ fixed: 'right', minWidth: 84, width: 84, title: t('advertisingRecharge.field.action') }"
        table-class="w-max min-w-full"
        :aria-label="t('advertisingRecharge.pageTitle')"
        @search="search"
        @pagination-change="load"
        @retry="load"
      >
        <template #cell-adAccountName="{ row }">
          <span class="break-words">{{ row.original.adAccountName }}</span>
        </template>

        <template #cell-rechargeAmount="{ row }">
          <AmountDisplay
            :value="row.original.rechargeAmount"
            :currency="row.original.rechargeCurrency"
            :currencies="currencyCatalog.currencies.value"
          />
        </template>

        <template #cell-status="{ row }">
          <span class="qs-type-tag px-2 py-0.5 border rounded-md" :class="advertisingRechargeStatusMeta(row.original.status).tagClass">
            {{ t(advertisingRechargeStatusMeta(row.original.status).labelKey) }}
          </span>
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

    <CreateModal
      v-model="createOpen"
      :currencies="rechargeCurrencies"
      :enabled="canCreate"
      :submitting="creating"
      :error="createError || null"
      :created="created"
      :upload="uploadQr"
      @submit="submitCreate"
    />

    <DetailDrawer
      v-model="detailOpen"
      :recharge="detail"
      @changed="applyChanged"
    />
  </div>
</template>
