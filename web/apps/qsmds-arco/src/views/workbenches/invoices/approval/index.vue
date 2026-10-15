<script setup lang="ts">
import type { InvoiceRequestStatusValue } from '../invoice-status.logic'
import type { InvoiceRequestListItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import exchangeRatesApi from '@/api/modules/exchange-rates'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { calculateEstimatedCostCny } from '../invoice-cost.logic'
import { buildInvoiceDocumentItems } from '../invoice-document.logic'
import { resolveInvoiceFailureKey } from '../invoice-failure.logic'
import InvoiceRequestDetailDrawer from '../invoice-request-detail-drawer.vue'
import { isSettleable, resolveSettleRemaining, statusSwitchItems, statusTagClass } from '../invoice-status.logic'
import InvoiceRequestReviewModal from './review-modal.vue'

/**
 * 开票审批（财务）：一个页面 + 六态筛选（始终带计数）+ 按状态给动作 + 只读详情抽屉。
 *
 * 发票审批走独立的三步弹窗（review-modal）；退回、取消（原因必填）、上传发票照片（上传即定稿）、
 * 结算入账（满 120 小时才可用，展示汇率与算式）各是一个聚焦式弹窗。
 */
type ActionMode = 'return' | 'cancel' | 'document' | 'settle'

const { t } = useI18n()
const { auth } = useAppAuth()
const currencyCatalog = useCurrencyCatalog()
const canReview = computed(() => auth('invoice-requests:review'))

const status = ref<'ALL' | InvoiceRequestStatusValue>('PENDING_REVIEW')
const search = ref('')
const items = ref<InvoiceRequestListItemDto[]>([])
const counts = ref<Record<string, number>>({})
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const loadError = ref<string | null>(null)
const now = ref(new Date())

const detailOpen = ref(false)
const detailId = ref<string | null>(null)
const target = ref<InvoiceRequestListItemDto | null>(null)
const actionOpen = ref(false)
const mode = ref<ActionMode>('return')
const reason = ref('')
const busy = ref(false)
const actionError = ref<string | null>(null)
const pickedFile = ref<File | null>(null)
const images = ref<string[]>([])
const uploadError = ref<string | null>(null)
const rate = ref<{ id: string, version: number, foreignUnitsPerCny: string } | null>(null)
const reviewOpen = ref(false)
const reviewId = ref<string | null>(null)

const ACTION_TITLE_KEYS: Readonly<Record<ActionMode, string>> = {
  return: 'invoiceRequest.action.return',
  cancel: 'invoiceRequest.action.cancel',
  document: 'invoiceRequest.action.document',
  settle: 'invoiceRequest.action.settle',
}

const toolbarItems = computed(() => statusSwitchItems().map(item => ({
  value: item.value,
  label: t(item.labelKey),
  count: counts.value[item.value] ?? 0,
})))

function settleHint(row: InvoiceRequestListItemDto): string {
  if (row.documentUploadedAt === null || row.documentUploadedAt === undefined) {
    return t('invoiceRequest.detail.documentNone')
  }
  if (isSettleable(row.documentUploadedAt, now.value)) {
    return t('invoiceRequest.detail.settleable')
  }
  const remaining = resolveSettleRemaining(row.documentUploadedAt, now.value)
  return remaining === null ? '' : t('invoiceRequest.detail.settleWait', remaining)
}

/** 行内「结算入账」按钮的可用性：与结算弹窗同口径，未满 120 小时禁用并用 tooltip 展示等待时间。 */
function canSettleRow(row: InvoiceRequestListItemDto): boolean {
  return row.documentUploadedAt !== null && isSettleable(row.documentUploadedAt, now.value)
}

const columns = computed<QsGenericTableColumn<InvoiceRequestListItemDto>[]>(() => [
  { id: 'invoiceNo', accessorKey: 'invoiceNo', title: t('invoiceRequest.column.invoiceNo'), minWidth: 190, fixed: 'left' },
  { id: 'document', accessorFn: row => row.documentMediaAssetId, title: t('invoiceRequest.column.document'), minWidth: 96 },
  { id: 'status', accessorFn: row => row.status, title: t('invoiceRequest.column.status'), minWidth: 130 },
  { id: 'buyer', accessorFn: row => row.buyerName, title: t('invoiceRequest.column.buyer'), minWidth: 190 },
  { id: 'salesAmount', accessorKey: 'salesAmount', title: t('invoiceRequest.field.salesAmount'), minWidth: 190, align: 'right' },
  { id: 'taxAmount', accessorKey: 'taxAmount', title: t('invoiceRequest.field.taxAmount'), minWidth: 190, align: 'right' },
  { id: 'totalAmount', accessorKey: 'totalAmount', title: t('invoiceRequest.field.totalAmount'), minWidth: 190, align: 'right' },
  { id: 'invoiceRemark', accessorFn: row => row.invoiceRemark ?? '—', title: t('invoiceRequest.field.invoiceRemark'), minWidth: 200, cellClass: 'whitespace-normal break-words' },
  { id: 'recipient', accessorFn: row => row.recipientName, title: t('invoiceRequest.column.recipient'), minWidth: 220 },
  { id: 'internalRemark', accessorFn: row => row.internalRemark ?? '—', title: t('invoiceRequest.field.internalRemark'), minWidth: 200, cellClass: 'whitespace-normal break-words' },
  { id: 'submittedAt', accessorFn: row => row.submittedAt, title: t('invoiceRequest.column.submittedAt'), minWidth: 190 },
])

async function load(): Promise<void> {
  if (!canReview.value) {
    return
  }
  loading.value = true
  loadError.value = null
  now.value = new Date()
  try {
    const signal = new AbortController().signal
    const [list, statusCounts] = await Promise.all([
      invoiceRequestsApi.list({ page: page.value, pageSize: pageSize.value, status: status.value, ...(search.value === '' ? {} : { keyword: search.value }) }, signal),
      invoiceRequestsApi.statusCounts(search.value === '' ? {} : { keyword: search.value }, signal),
    ])
    items.value = list.data.items
    total.value = list.data.total
    counts.value = Object.fromEntries(statusCounts.data.statuses.map(entry => [entry.value, entry.count]))
  }
  catch {
    loadError.value = t('invoiceRequest.list.loadFailed')
  }
  finally {
    loading.value = false
  }
}

function changeStatus(): void {
  page.value = 1
  void load()
}

function openDetail(row: InvoiceRequestListItemDto): void {
  detailId.value = row.id
  detailOpen.value = true
}

function openReview(row: InvoiceRequestListItemDto): void {
  reviewId.value = row.id
  reviewOpen.value = true
}

function closeDetail(): void {
  detailOpen.value = false
  detailId.value = null
}

async function openAction(row: InvoiceRequestListItemDto, next: ActionMode): Promise<void> {
  target.value = row
  mode.value = next
  reason.value = ''
  actionError.value = null
  pickedFile.value = null
  images.value = []
  uploadError.value = null
  rate.value = null
  actionOpen.value = true
  if (next === 'settle') {
    await loadRate()
  }
}

async function loadRate(): Promise<void> {
  rate.value = null
  try {
    const response = await exchangeRatesApi.list(new AbortController().signal)
    const current = response.data.items.find(entry => entry.currency.code === 'TWD')?.currentRate
    if (current !== undefined && current !== null) {
      rate.value = { id: current.id, version: current.version, foreignUnitsPerCny: current.foreignUnitsPerCny }
    }
  }
  catch {
    rate.value = null
  }
}

/** 结算预览：与申请页预估、后端入账共用 invoice-cost.logic 的同一公式与常量。 */
const settlePreview = computed(() => {
  const row = target.value
  if (row === null || rate.value === null) {
    return null
  }
  const cost = calculateEstimatedCostCny(Number(row.totalAmount), Number(rate.value.foreignUnitsPerCny))
  return cost === null ? null : String(cost)
})

const ALLOWED_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp']

/** FaImageUpload 只负责选文件：本地先校验格式与体积，真正的上传在确认动作里。 */
function selectFile({ file }: { file: File }): null {
  uploadError.value = null
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    uploadError.value = t('invoiceRequest.upload.imageOnly')
    return null
  }
  if (file.size <= 0) {
    uploadError.value = t('invoiceRequest.upload.imageEmpty')
    return null
  }
  if (file.size > 10 * 1024 * 1024) {
    uploadError.value = t('invoiceRequest.upload.imageTooLarge')
    return null
  }
  pickedFile.value = file
  return null
}

function canConfirm(): boolean {
  if (busy.value || target.value === null) {
    return false
  }
  if (mode.value === 'return' || mode.value === 'cancel') {
    return reason.value.trim() !== ''
  }
  if (mode.value === 'document') {
    return pickedFile.value !== null
  }
  if (mode.value === 'settle') {
    return rate.value !== null && isSettleable(target.value.documentUploadedAt, now.value)
  }
  return true
}

async function submitAction(): Promise<void> {
  const row = target.value
  if (row === null) {
    return
  }
  busy.value = true
  actionError.value = null
  try {
    const signal = new AbortController().signal
    if (mode.value === 'return') {
      await invoiceRequestsApi.requestReturn(row.id, { reason: reason.value.trim(), expectedVersion: row.version }, signal)
    }
    else if (mode.value === 'cancel') {
      await invoiceRequestsApi.cancel(row.id, { reason: reason.value.trim(), expectedVersion: row.version }, signal)
    }
    else if (mode.value === 'document') {
      if (pickedFile.value === null) {
        throw new Error('missing file')
      }
      await invoiceRequestsApi.uploadDocument(row.id, pickedFile.value, signal)
    }
    else {
      if (rate.value === null) {
        throw new Error('missing rate')
      }
      await invoiceRequestsApi.settle(row.id, { expectedVersion: row.version, exchangeRateId: rate.value.id, exchangeRateVersion: rate.value.version }, signal)
    }
    actionOpen.value = false
    target.value = null
    await load()
  }
  catch (error) {
    actionError.value = t(resolveInvoiceFailureKey(error))
  }
  finally {
    busy.value = false
  }
}

const cancelBodyKey = computed(() => target.value?.documentMediaAssetId === null
  ? 'invoiceRequest.approval.cancelBody'
  : 'invoiceRequest.approval.cancelBodyIssued')

onMounted(load)
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('invoiceRequest.approval.title')" :description="t('invoiceRequest.approval.description')" />

    <FaPageMain v-if="!canReview">
      <FaEmpty icon="i-lucide:shield-alert" :title="t('invoiceRequest.list.noPermission')" class="py-12" />
    </FaPageMain>
    <FaPageMain v-else class="min-w-0">
      <QsStatusSwitchToolbar v-model="status" :items="toolbarItems" :aria-label="t('invoiceRequest.approval.title')" class="mb-4" @update:model-value="changeStatus" />
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="search"
        row-key="id"
        :addable="false"
        :columns="columns"
        :data="items"
        :loading="loading"
        :total="total"
        :error="loadError || undefined"
        :search-placeholder="t('invoiceRequest.list.searchPlaceholder')"
        :empty-title="t('invoiceRequest.list.empty')"
        :empty-description="t('invoiceRequest.list.emptyDescription')"
        :action-column="{ fixed: 'right', minWidth: 300 }"
        @pagination-change="load"
        @search="load"
        @retry="load"
      >
        <template #cell-invoiceNo="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="qs-type-data-emphasis break-all whitespace-normal">
              {{ row.original.invoiceNo }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-document="{ row }">
          <ImageGroup :items="buildInvoiceDocumentItems(row.original, t('invoiceRequest.column.document'))" :max-count="1" radius="lg" size="sm" />
        </template>
        <template #cell-buyer="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="whitespace-normal break-words">
              {{ row.original.buyerName }}
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="qs-type-data">
              {{ row.original.buyerTaxId }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-salesAmount="{ row }">
          <QsTableStackedCell class="text-right justify-items-end">
            <QsTableStackedLine>
              <AmountDisplay :value="row.original.salesAmount" currency="TWD" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-taxAmount="{ row }">
          <QsTableStackedCell class="text-right justify-items-end">
            <QsTableStackedLine>
              <AmountDisplay :value="row.original.taxAmount" currency="TWD" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-recipient="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="whitespace-normal">
              {{ `${row.original.recipientName} · ${row.original.recipientPhone}` }}
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted" content-class="whitespace-normal">
              {{ row.original.recipientAddress }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-totalAmount="{ row }">
          <QsTableStackedCell class="text-right justify-items-end">
            <QsTableStackedLine>
              <AmountDisplay :value="row.original.totalAmount" currency="TWD" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-submittedAt="{ row }">
          <QsTableStackedCell>
            <QsPersonDisplay :display-name="row.original.creatorName" size="sm" />
            <QsTableStackedLine tone="muted">
              <DateTimeDisplay :value="row.original.submittedAt" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-status="{ row }">
          <FaTag variant="outline" class="qs-type-status-tag" :class="statusTagClass(row.original.status)">
            {{ t(`invoiceRequest.status.${row.original.status}`) }}
          </FaTag>
        </template>

        <template #mobile-row="{ row }">
          <div class="space-y-2">
            <div class="flex gap-3 items-start justify-between">
              <span class="qs-type-data-emphasis break-all">{{ row.invoiceNo }}</span>
              <FaTag variant="outline" class="qs-type-status-tag whitespace-nowrap" :class="statusTagClass(row.status)">
                {{ t(`invoiceRequest.status.${row.status}`) }}
              </FaTag>
            </div>
            <ImageGroup
              v-if="row.documentMediaAssetId !== null"
              :items="buildInvoiceDocumentItems(row, t('invoiceRequest.column.document'))"
              :max-count="1"
              radius="lg"
              size="sm"
            />
            <dl class="m-0 gap-x-4 gap-y-2 grid grid-cols-2">
              <div class="min-w-0">
                <dt class="qs-type-meta mb-1">
                  {{ t('invoiceRequest.column.buyer') }}
                </dt>
                <dd class="text-sm m-0 break-words">
                  {{ row.buyerName }}
                  <span class="qs-type-data block">{{ row.buyerTaxId }}</span>
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="qs-type-meta mb-1">
                  {{ t('invoiceRequest.column.submittedAt') }}
                </dt>
                <dd class="text-sm m-0">
                  {{ row.creatorName }}
                  <span class="text-muted-foreground block">{{ row.submittedAt.slice(0, 19).replace('T', ' ') }}</span>
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="qs-type-meta mb-1">
                  {{ t('invoiceRequest.field.totalAmount') }}
                </dt>
                <dd class="m-0">
                  <AmountDisplay :value="row.totalAmount" currency="TWD" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="qs-type-meta mb-1">
                  {{ t('invoiceRequest.field.salesAmount') }} / {{ t('invoiceRequest.field.taxAmount') }}
                </dt>
                <dd class="m-0 flex flex-col gap-1 items-start">
                  <AmountDisplay :value="row.salesAmount" currency="TWD" :currencies="currencyCatalog.currencies.value" />
                  <AmountDisplay :value="row.taxAmount" currency="TWD" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div class="col-span-2 min-w-0">
                <dt class="qs-type-meta mb-1">
                  {{ t('invoiceRequest.column.recipient') }}
                </dt>
                <dd class="text-sm m-0 break-words">
                  {{ `${row.recipientName} · ${row.recipientPhone}` }}
                  <span class="text-muted-foreground block">{{ row.recipientAddress }}</span>
                </dd>
              </div>
              <div v-if="row.invoiceRemark !== null" class="col-span-2 min-w-0">
                <dt class="qs-type-meta mb-1">
                  {{ t('invoiceRequest.field.invoiceRemark') }}
                </dt>
                <dd class="text-sm m-0 break-words">
                  {{ row.invoiceRemark }}
                </dd>
              </div>
            </dl>
          </div>
        </template>

        <template #actions="{ row }">
          <FaButton
            v-if="row.status === 'PENDING_REVIEW'"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :aria-label="`${row.invoiceNo} · ${t('invoiceRequest.action.review')}`"
            @click="openReview(row)"
          >
            <FaIcon name="i-lucide:clipboard-check" aria-hidden="true" />{{ t('invoiceRequest.action.review') }}
          </FaButton>
          <FaButton
            v-if="row.status === 'PENDING_REVIEW'"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :aria-label="`${row.invoiceNo} · ${t('invoiceRequest.action.return')}`"
            @click="openAction(row, 'return')"
          >
            <FaIcon name="i-lucide:undo-2" aria-hidden="true" />{{ t('invoiceRequest.action.return') }}
          </FaButton>
          <FaButton
            v-if="row.status === 'NOTIFIED'"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :aria-label="`${row.invoiceNo} · ${t('invoiceRequest.action.document')}`"
            @click="openAction(row, 'document')"
          >
            <FaIcon name="i-lucide:image-plus" aria-hidden="true" />{{ t('invoiceRequest.action.document') }}
          </FaButton>
          <FaTooltip v-if="row.status === 'ISSUED'" :text="settleHint(row)">
            <span class="inline-flex">
              <FaButton
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8"
                :disabled="!canSettleRow(row)"
                :aria-label="`${row.invoiceNo} · ${t('invoiceRequest.action.settle')}`"
                @click="openAction(row, 'settle')"
              >
                <FaIcon name="i-lucide:landmark" aria-hidden="true" />{{ t('invoiceRequest.action.settle') }}
              </FaButton>
            </span>
          </FaTooltip>
          <FaButton
            v-if="row.status !== 'SETTLED' && row.status !== 'CANCELLED'"
            variant="ghost"
            size="sm"
            class="text-destructive min-h-11 sm:min-h-8"
            :aria-label="`${row.invoiceNo} · ${t('invoiceRequest.action.cancel')}`"
            @click="openAction(row, 'cancel')"
          >
            <FaIcon name="i-lucide:circle-x" aria-hidden="true" />{{ t('invoiceRequest.action.cancel') }}
          </FaButton>
          <FaButton
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :aria-label="`${row.invoiceNo} · ${t('invoiceRequest.action.viewDetail')}`"
            @click="openDetail(row)"
          >
            <FaIcon name="i-lucide:eye" aria-hidden="true" />{{ t('invoiceRequest.action.viewDetail') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <InvoiceRequestDetailDrawer :id="detailId" v-model="detailOpen" @closed="closeDetail" />
    <InvoiceRequestReviewModal :id="reviewId" v-model="reviewOpen" @completed="load" />

    <QsGenericModal
      v-model="actionOpen"
      :title="t(ACTION_TITLE_KEYS[mode])"
      :description="target === null ? undefined : `${target.invoiceNo} · ${target.buyerName}`"
      size="xl"
      :submitting="busy"
      :dismiss-on-escape="!busy"
      :dismiss-on-overlay="!busy"
    >
      <template #header-leading>
        <FaIcon name="i-lucide:stamp" class="size-5" aria-hidden="true" />
      </template>

      <div v-if="target !== null" class="space-y-5">
        <section class="p-4 border border-border rounded-xl bg-muted/15 min-w-0 space-y-4 sm:p-5">
          <div class="flex gap-4 items-start justify-between">
            <div class="min-w-0">
              <p class="qs-type-compact-label mb-1.5">
                {{ t('invoiceRequest.column.invoiceNo') }}
              </p>
              <p class="qs-type-data-emphasis m-0 break-all">
                {{ target.invoiceNo }}
              </p>
            </div>
            <div class="text-right">
              <p class="qs-type-compact-label mb-1.5">
                {{ t('invoiceRequest.field.totalAmount') }}
              </p>
              <div tabindex="0" class="flex max-w-full overflow-x-auto [&_[data-currency]]:text-3xl [&_[data-currency]]:font-bold">
                <AmountDisplay :value="target.totalAmount" currency="TWD" :currencies="currencyCatalog.currencies.value" />
              </div>
            </div>
          </div>
          <dl class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('invoiceRequest.column.submitter') }}
              </dt>
              <dd class="m-0">
                <QsPersonDisplay :display-name="target.creatorName" size="sm" />
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('invoiceRequest.field.buyerTaxId') }}
              </dt>
              <dd class="qs-type-data m-0">
                {{ target.buyerTaxId }}
              </dd>
            </div>
          </dl>
        </section>

        <section class="p-4 border-2 border-primary/30 rounded-xl bg-background min-w-0 space-y-4 sm:p-5">
          <header class="flex gap-2.5 items-center">
            <span class="text-primary rounded-lg bg-primary/10 flex shrink-0 size-8 items-center justify-center">
              <FaIcon name="i-lucide:clipboard-check" class="size-4" aria-hidden="true" />
            </span>
            <h3 class="qs-type-component-title m-0">
              {{ t(ACTION_TITLE_KEYS[mode]) }}
            </h3>
          </header>

          <p v-if="mode === 'return'" class="qs-type-meta m-0">
            {{ t('invoiceRequest.approval.returnBody') }}
          </p>
          <p v-if="mode === 'cancel'" class="qs-type-meta m-0">
            {{ t(cancelBodyKey) }}
          </p>
          <p v-if="mode === 'document'" class="qs-type-meta m-0">
            {{ t('invoiceRequest.approval.documentBody') }}
          </p>

          <FaForm v-if="mode === 'return' || mode === 'cancel'" :disabled="busy" class="min-w-0">
            <FaFormItem name="reason" :label="t('invoiceRequest.action.reasonLabel')" required :auto-bind="false">
              <FaTextarea
                v-model="reason"
                :rows="3"
                maxlength="500"
                input-class="min-h-24"
                :placeholder="t('invoiceRequest.action.reasonPlaceholder')"
                :disabled="busy"
                :aria-label="t('invoiceRequest.action.reasonLabel')"
              />
              <p class="qs-type-meta m-0 mt-1.5 text-right">
                {{ reason.length }} / 500
              </p>
            </FaFormItem>
          </FaForm>

          <div v-if="mode === 'document'" class="space-y-2">
            <FaImageUpload
              v-model="images"
              :max="1"
              :width="144"
              :height="104"
              :disabled="busy"
              :http-request="selectFile"
              :aria-label="t('invoiceRequest.action.document')"
            >
              <span class="text-muted-foreground border border-border rounded-lg border-dashed flex flex-col gap-2 size-full items-center justify-center">
                <FaIcon name="i-lucide:image-plus" class="size-6" aria-hidden="true" />
                <span class="qs-type-meta">{{ t('invoiceRequest.upload.pick') }}</span>
              </span>
            </FaImageUpload>
            <p class="qs-type-meta m-0">
              {{ t('invoiceRequest.approval.documentHint') }}
            </p>
            <p v-if="pickedFile !== null" class="qs-type-meta text-primary m-0">
              {{ pickedFile.name }}
            </p>
            <p v-if="uploadError !== null" role="alert" class="qs-type-meta text-destructive m-0">
              {{ uploadError }}
            </p>
          </div>

          <dl v-if="mode === 'settle'" class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('invoiceRequest.approval.settleRate') }}
              </dt>
              <dd class="qs-type-data m-0">
                {{ rate === null ? '—' : rate.foreignUnitsPerCny }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('invoiceRequest.approval.settleAmount') }}
              </dt>
              <dd class="m-0">
                <AmountDisplay :value="settlePreview" currency="CNY" :currencies="currencyCatalog.currencies.value" />
              </dd>
            </div>
            <div class="min-w-0 sm:col-span-2">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('invoiceRequest.detail.settleableAt') }}
              </dt>
              <dd class="qs-type-meta m-0">
                {{ settleHint(target) }}
              </dd>
            </div>
            <p class="qs-type-meta m-0 sm:col-span-2">
              {{ t('invoiceRequest.approval.settleFormula') }}
            </p>
          </dl>

          <FaAlert v-if="actionError !== null" variant="destructive" icon="i-lucide:circle-alert" :title="actionError" role="alert" />
        </section>
      </div>

      <template #footer>
        <FaButton type="button" variant="outline" :disabled="busy" @click="actionOpen = false">
          {{ t('invoiceRequest.common.cancel') }}
        </FaButton>
        <FaButton
          type="button"
          :variant="mode === 'cancel' ? 'destructive' : 'default'"
          :loading="busy"
          :disabled="!canConfirm()"
          @click="submitAction"
        >
          {{ t('invoiceRequest.common.confirm') }}
        </FaButton>
      </template>
    </QsGenericModal>
  </div>
</template>
