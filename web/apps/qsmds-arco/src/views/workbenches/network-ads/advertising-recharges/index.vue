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
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { takePendingRechargePaste } from './create-handoff'
import CreateModal from './create-modal.vue'
import DetailDrawer from './detail-drawer.vue'
import {
  ADVERTISING_RECHARGE_STATUS_FILTER_OPTIONS,
  advertisingRechargeProofUrl,
  advertisingRechargeQrUrl,
  advertisingRechargeStatusMeta,
  buildAdvertisingRechargeCopyText,
  buildAdvertisingRechargeDetailLink,
} from './logic'
import { resolveRechargeCurrencies, sumAdvertisingRechargeCounts } from './recharge-form'

defineOptions({ name: 'NetworkAdsAdvertisingRecharges' })

const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()
const router = useRouter()
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
/** 由广告户卡片「充值」跳转带入的识别文本，只用于打开新增弹窗那一次。 */
const initialPaste = ref('')
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
  // 列顺序与财务端保持一致；最后一列同为 185，运营侧只展示提交时间（申请人恒为自己）。
  { id: 'rechargeNo', accessorKey: 'rechargeNo', title: t('advertisingRecharge.field.rechargeNo'), minWidth: 170, fixed: 'left', cellClass: 'qs-type-data-emphasis', mobileCellClass: 'qs-type-data-emphasis' },
  { id: 'adAccountName', accessorKey: 'adAccountName', title: t('advertisingRecharge.field.adAccountName'), minWidth: 180 },
  { id: 'adAccountNo', accessorKey: 'adAccountNo', title: t('advertisingRecharge.field.adAccountNo'), minWidth: 160 },
  { id: 'rechargeAmount', accessorKey: 'rechargeAmount', title: t('advertisingRecharge.field.rechargeAmount'), minWidth: 150, align: 'right' },
  { id: 'paymentQr', title: t('advertisingRecharge.field.paymentQr'), minWidth: 104 },
  { id: 'paymentProof', title: t('advertisingRecharge.field.paymentProof'), minWidth: 104 },
  { id: 'paymentAmount', accessorFn: row => row.payment?.amountCny ?? '', title: t('advertisingRecharge.field.paymentAmount'), minWidth: 150, align: 'right' },
  { id: 'status', accessorKey: 'status', title: t('advertisingRecharge.field.status'), minWidth: 110 },
  { id: 'submittedAt', accessorKey: 'submittedAt', title: t('advertisingRecharge.field.submittedAt'), minWidth: 185 },
])

/** 列表缩略图：走私有内容路由，只在已登录会话内可取。 */
function qrCellItems(row: AdvertisingRechargeDto) {
  const qr = row.paymentQr

  if (!qr) {
    return []
  }

  const src = advertisingRechargeQrUrl(row.id, 'self')

  return [{ alt: t('advertisingRecharge.field.paymentQr'), key: qr.mediaAssetId, src, previewSrc: src, tooltip: qr.fileName }]
}

function proofCellItems(row: AdvertisingRechargeDto) {
  const proof = row.payment?.proof ?? null

  if (!proof) {
    return []
  }

  const src = advertisingRechargeProofUrl(row.id, 'self')

  return [{ alt: t('advertisingRecharge.field.paymentProof'), key: proof.mediaAssetId, src, previewSrc: src, tooltip: proof.fileName }]
}

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
  createOpen.value = true
}

/**
 * 广告户卡片「充值」跳转时留下的一次性交接：取出即清空，所以只会触发一次。
 * 不走路由 query——布局的 RouterView 按 fullPath 做 key，清 query 会重建整页。
 */
function consumePendingCreate(): void {
  const text = takePendingRechargePaste()

  if (text === null || !canCreate.value) {
    return
  }

  initialPaste.value = text
  openCreate()
}

async function submitCreate(payload: AdvertisingRechargeCreatePayload): Promise<void> {
  if (creating.value) {
    return
  }
  creating.value = true
  createError.value = ''
  try {
    await advertisingRechargesApi.create({
      accountType: payload.accountType,
      adAccountName: payload.adAccountName,
      adAccountNo: payload.adAccountNo,
      rechargeAmount: payload.rechargeAmount,
      rechargeCurrency: payload.rechargeCurrency as 'USD' | 'CNY',
      ...(payload.paymentQrMediaAssetId === undefined ? {} : { paymentQrMediaAssetId: payload.paymentQrMediaAssetId }),
      ...(payload.remark === undefined ? {} : { remark: payload.remark }),
    }, createKey.value)
    createOpen.value = false
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

/**
 * 通知已覆盖提交后的告知，但小助理离线时仍需要手动转发。
 * 文案与原先的复制步骤保持一致：账户名 + 编号 + 财务详情链接。
 */
async function copyRechargeInfo(row: AdvertisingRechargeDto): Promise<void> {
  const href = router.resolve({
    name: 'qsFinanceRealtimeAdvertisingRechargeDetail',
    params: { id: row.id },
  }).href
  const text = buildAdvertisingRechargeCopyText({
    adAccountName: row.adAccountName,
    adAccountNo: row.adAccountNo,
    link: buildAdvertisingRechargeDetailLink(window.location.origin, href),
  })

  try {
    await navigator.clipboard.writeText(text)
    toast.success(t('advertisingRecharge.create.copied'))
  }
  catch {
    toast.error(t('advertisingRecharge.create.copyFailed'))
  }
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
    createError.value = ''
    initialPaste.value = ''
  }
})

onMounted(() => {
  active.value = true
  consumePendingCreate()
})
onActivated(() => {
  active.value = true
  consumePendingCreate()
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
        :action-column="{ fixed: 'right', minWidth: 176, width: 176, title: t('advertisingRecharge.field.action') }"
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

        <template #cell-paymentQr="{ row }">
          <ImageGroup
            v-if="row.original.paymentQr"
            :items="qrCellItems(row.original)"
            :max-count="1"
            size="sm"
            tooltip-mode="native"
          />
          <span v-else class="text-muted-foreground">—</span>
        </template>

        <template #cell-paymentProof="{ row }">
          <ImageGroup
            v-if="row.original.payment?.proof"
            :items="proofCellItems(row.original)"
            :max-count="1"
            size="sm"
            tooltip-mode="native"
          />
          <span v-else class="text-muted-foreground">—</span>
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
          <div class="flex flex-nowrap gap-1 items-center">
            <FaButton
              variant="ghost"
              size="sm"
              class="min-h-11 sm:min-h-8"
              :aria-label="`${row.rechargeNo} · ${t('advertisingRecharge.action.copyInfo')}`"
              @click="copyRechargeInfo(row)"
            >
              {{ t('advertisingRecharge.action.copyInfo') }}
            </FaButton>
            <FaButton
              variant="ghost"
              size="sm"
              class="min-h-11 sm:min-h-8"
              :aria-label="`${row.rechargeNo} · ${t('advertisingRecharge.action.view')}`"
              @click="openDetail(row)"
            >
              {{ t('advertisingRecharge.action.view') }}
            </FaButton>
          </div>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <CreateModal
      v-model="createOpen"
      :currencies="rechargeCurrencies"
      :enabled="canCreate"
      :submitting="creating"
      :error="createError || null"
      :initial-paste="initialPaste"
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
