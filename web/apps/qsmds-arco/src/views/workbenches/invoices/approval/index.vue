<script setup lang="ts">
import type { InvoiceRequestStatusValue } from '../invoice-status.logic'
import type { InvoiceRequestListItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import exchangeRatesApi from '@/api/modules/exchange-rates'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import { resolveInvoiceFailureKey } from '../invoice-failure.logic'
import { buildInvoiceCopyText, isSettleable, resolveSettleRemaining, statusSwitchItems, statusTagClass } from '../invoice-status.logic'

/**
 * 开票审批（财务）：一个页面 + 六态筛选（始终带计数）+ 按状态给动作。
 * 「审核并通知」提供复制开票信息；「上传发票照片」上传即定稿；「结算入账」满 120 小时后可用。
 */
type ActionMode = 'review' | 'return' | 'cancel' | 'document' | 'settle'

const { t } = useI18n()
const router = useRouter()
const { auth } = useAppAuth()
const canReview = computed(() => auth('invoice-requests:review'))

const status = ref<'ALL' | InvoiceRequestStatusValue>('PENDING_REVIEW')
const search = ref('')
const items = ref<InvoiceRequestListItemDto[]>([])
const counts = ref<Record<string, number>>({})
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const failed = ref(false)
const now = ref(new Date())

const target = ref<InvoiceRequestListItemDto | null>(null)
const actionOpen = ref(false)
const mode = ref<ActionMode>('review')
const reason = ref('')
const busy = ref(false)
const actionError = ref<string | null>(null)
const copyState = ref<'none' | 'copied' | 'failed'>('none')
const file = ref<File | null>(null)
const rate = ref<{ id: string, version: number, foreignUnitsPerCny: string } | null>(null)

const ACTION_TITLE_KEYS: Readonly<Record<ActionMode, string>> = {
  review: 'invoiceRequest.action.notify',
  return: 'invoiceRequest.action.return',
  cancel: 'invoiceRequest.action.cancel',
  document: 'invoiceRequest.action.document',
  settle: 'invoiceRequest.action.settle',
}

// 计数始终显示：缺失按 0 展示，避免工具栏在计数回来之前跳动。
const toolbarItems = computed(() => statusSwitchItems().map(item => ({
  value: item.value,
  label: t(item.labelKey),
  count: counts.value[item.value] ?? 0,
})))

function settleWaitText(row: InvoiceRequestListItemDto): string {
  if (row.documentUploadedAt === null || row.documentUploadedAt === undefined) {
    return '—'
  }
  if (isSettleable(row.documentUploadedAt, now.value)) {
    return t('invoiceRequest.detail.settleable')
  }
  const remaining = resolveSettleRemaining(row.documentUploadedAt, now.value)
  return remaining === null ? '—' : t('invoiceRequest.detail.settleWait', remaining)
}

const columns = computed<QsGenericTableColumn<InvoiceRequestListItemDto>[]>(() => [
  { id: 'invoiceNo', accessorKey: 'invoiceNo', title: t('invoiceRequest.column.invoiceNo'), minWidth: 180, fixed: 'left', copyable: true },
  { id: 'creatorName', accessorKey: 'creatorName', title: t('invoiceRequest.column.submitter'), minWidth: 120 },
  { id: 'totalAmount', accessorKey: 'totalAmount', title: t('invoiceRequest.field.totalAmount'), minWidth: 120, align: 'right' },
  { id: 'submittedAt', accessorFn: row => row.submittedAt, title: t('invoiceRequest.column.submittedAt'), minWidth: 170 },
  { id: 'status', accessorFn: row => row.status, title: t('invoiceRequest.column.lastAction'), minWidth: 140 },
  { id: 'settleable', accessorFn: row => settleWaitText(row), title: t('invoiceRequest.detail.settleableAt'), minWidth: 200 },
])

async function load(): Promise<void> {
  if (!canReview.value) {
    return
  }
  loading.value = true
  failed.value = false
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
    failed.value = true
  }
  finally {
    loading.value = false
  }
}

function changeStatus(): void {
  page.value = 1
  void load()
}

async function openAction(row: InvoiceRequestListItemDto, next: ActionMode): Promise<void> {
  target.value = row
  mode.value = next
  reason.value = ''
  actionError.value = null
  copyState.value = 'none'
  file.value = null
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

/** 结算预览与后端同一公式：向上取整(总计 ÷ 汇率 × 0.06 + 30)。 */
const settlePreview = computed(() => {
  const row = target.value
  if (row === null || rate.value === null) {
    return null
  }
  const foreignUnitsPerCny = Number(rate.value.foreignUnitsPerCny)
  if (!Number.isFinite(foreignUnitsPerCny) || foreignUnitsPerCny <= 0) {
    return null
  }
  return String(Math.ceil((Number(row.totalAmount) / foreignUnitsPerCny) * 0.06 + 30))
})

async function copyInvoiceInfo(): Promise<void> {
  const row = target.value
  if (row === null) {
    return
  }
  try {
    const { data } = await invoiceRequestsApi.get(row.id, new AbortController().signal)
    await navigator.clipboard.writeText(buildInvoiceCopyText(data))
    copyState.value = 'copied'
  }
  catch {
    // 复制失败不谎报：让财务手动选择文本。
    copyState.value = 'failed'
  }
}

function pickFile(event: Event): void {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
}

function canConfirm(): boolean {
  if (busy.value || target.value === null) {
    return false
  }
  if (mode.value === 'return' || mode.value === 'cancel') {
    return reason.value.trim() !== ''
  }
  if (mode.value === 'document') {
    return file.value !== null
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
    if (mode.value === 'review') {
      await invoiceRequestsApi.notify(row.id, { expectedVersion: row.version }, signal)
    }
    else if (mode.value === 'return') {
      await invoiceRequestsApi.requestReturn(row.id, { reason: reason.value.trim(), expectedVersion: row.version }, signal)
    }
    else if (mode.value === 'cancel') {
      await invoiceRequestsApi.cancel(row.id, { reason: reason.value.trim(), expectedVersion: row.version }, signal)
    }
    else if (mode.value === 'document') {
      if (file.value === null) {
        throw new Error('missing file')
      }
      await invoiceRequestsApi.uploadDocument(row.id, file.value, signal)
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
  <FaPageMain v-if="!canReview">
    <p class="text-muted-foreground py-12 text-center">
      {{ t('invoiceRequest.list.noPermission') }}
    </p>
  </FaPageMain>
  <FaPageMain v-else class="min-w-0">
    <QsStatusSwitchToolbar v-model="status" :items="toolbarItems" class="mb-4" @update:model-value="changeStatus" />
    <QsGenericTable
      v-model:page="page"
      v-model:page-size="pageSize"
      v-model:search="search"
      row-key="id"
      :columns="columns"
      :data="items"
      :loading="loading"
      :total="total"
      :search-placeholder="t('invoiceRequest.list.searchPlaceholder')"
      @pagination-change="load"
      @search="load"
    >
      <template #cell-status="{ row }">
        <FaTag variant="outline" class="qs-type-status-tag" :class="statusTagClass(row.original.status)">
          {{ t(`invoiceRequest.status.${row.original.status}`) }}
        </FaTag>
      </template>
      <template #cell-submittedAt="{ row }">
        <DateTimeDisplay :value="row.original.submittedAt" />
      </template>
      <template #actions="{ row }">
        <FaButton v-if="row.status === 'PENDING_REVIEW'" variant="outline" size="sm" @click="openAction(row, 'review')">
          {{ t('invoiceRequest.action.notify') }}
        </FaButton>
        <FaButton v-if="row.status === 'PENDING_REVIEW'" variant="ghost" size="sm" @click="openAction(row, 'return')">
          {{ t('invoiceRequest.action.return') }}
        </FaButton>
        <FaButton v-if="row.status === 'NOTIFIED'" variant="outline" size="sm" @click="openAction(row, 'document')">
          {{ t('invoiceRequest.action.document') }}
        </FaButton>
        <FaButton v-if="row.status === 'ISSUED'" variant="outline" size="sm" @click="openAction(row, 'settle')">
          {{ t('invoiceRequest.action.settle') }}
        </FaButton>
        <FaButton v-if="row.status !== 'SETTLED' && row.status !== 'CANCELLED'" variant="ghost" size="sm" class="text-muted-foreground hover:text-destructive" @click="openAction(row, 'cancel')">
          {{ t('invoiceRequest.action.cancel') }}
        </FaButton>
        <FaButton variant="ghost" size="sm" @click="router.push({ name: 'qsFinanceInvoicesDetail', params: { id: row.id } })">
          {{ t('invoiceRequest.action.viewDetail') }}
        </FaButton>
      </template>
    </QsGenericTable>
    <p v-if="failed" class="text-sm text-destructive mt-3">
      {{ t('invoiceRequest.detail.loadFailed') }}
    </p>

    <QsGenericModal
      v-model="actionOpen"
      :title="t(ACTION_TITLE_KEYS[mode])"
      :description="target === null ? undefined : target.invoiceNo"
      size="md"
      :submitting="busy"
      :error="actionError"
    >
      <div class="text-sm flex flex-col gap-3">
        <p v-if="mode === 'review'" class="text-muted-foreground">
          {{ t('invoiceRequest.approval.notifyBody') }}
        </p>
        <p v-if="mode === 'return'" class="text-muted-foreground">
          {{ t('invoiceRequest.approval.returnBody') }}
        </p>
        <p v-if="mode === 'cancel'" class="text-muted-foreground">
          {{ t(cancelBodyKey) }}
        </p>
        <p v-if="mode === 'document'" class="text-muted-foreground">
          {{ t('invoiceRequest.approval.documentBody') }}
        </p>
        <p v-if="mode === 'document'" class="text-xs text-muted-foreground">
          {{ t('invoiceRequest.approval.documentHint') }}
        </p>

        <div v-if="mode === 'review'" class="flex gap-3 items-center">
          <FaButton variant="outline" size="sm" @click="copyInvoiceInfo">
            {{ t('invoiceRequest.approval.copy') }}
          </FaButton>
          <span v-if="copyState === 'copied'" class="text-primary">{{ t('invoiceRequest.approval.copied') }}</span>
          <span v-if="copyState === 'failed'" class="text-destructive">{{ t('invoiceRequest.approval.copyFailed') }}</span>
        </div>

        <label v-if="mode === 'return' || mode === 'cancel'" class="flex flex-col gap-1">
          <span>{{ t('invoiceRequest.action.reasonLabel') }}</span>
          <textarea v-model="reason" rows="3" class="px-3 py-2 border border-border rounded-md bg-background" :placeholder="t('invoiceRequest.action.reasonPlaceholder')" />
        </label>

        <div v-if="mode === 'document'">
          <input type="file" accept="image/jpeg,image/png,image/webp" @change="pickFile">
        </div>

        <dl v-if="mode === 'settle'" class="gap-1 grid">
          <div class="flex justify-between">
            <dt>{{ t('invoiceRequest.field.totalAmount') }}</dt><dd class="tabular-nums">
              {{ target?.totalAmount }}
            </dd>
          </div>
          <div class="flex justify-between">
            <dt>{{ t('invoiceRequest.approval.settleRate') }}</dt><dd class="tabular-nums">
              {{ rate === null ? '—' : rate.foreignUnitsPerCny }}
            </dd>
          </div>
          <div class="flex justify-between">
            <dt>{{ t('invoiceRequest.approval.settleAmount') }}</dt><dd class="tabular-nums">
              {{ settlePreview ?? '—' }}
            </dd>
          </div>
          <p class="text-xs text-muted-foreground">
            {{ t('invoiceRequest.approval.settleFormula') }}
          </p>
          <p class="text-xs text-muted-foreground">
            {{ target === null ? '' : settleWaitText(target) }}
          </p>
        </dl>
      </div>
      <template #footer>
        <FaButton variant="outline" :disabled="busy" @click="actionOpen = false">
          {{ t('invoiceRequest.common.cancel') }}
        </FaButton>
        <FaButton :variant="mode === 'cancel' ? 'destructive' : 'default'" :loading="busy" :disabled="!canConfirm()" @click="submitAction">
          {{ t('invoiceRequest.common.confirm') }}
        </FaButton>
      </template>
    </QsGenericModal>
  </FaPageMain>
</template>
