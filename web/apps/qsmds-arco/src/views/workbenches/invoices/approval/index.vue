<script setup lang="ts">
import type { InvoiceRequestStatusValue } from '../invoice-status.logic'
import type { InvoiceRequestListItemDto } from '@/api/generated/types.gen'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import exchangeRatesApi from '@/api/modules/exchange-rates'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import { resolveInvoiceFailureKey } from '../invoice-failure.logic'
import { buildInvoiceCopyText, isSettleable, resolveSettleRemaining, statusSwitchItems, statusTagClass } from '../invoice-status.logic'

/**
 * 开票审批（财务）：一个页面 + 六态筛选 + 按状态给动作。
 * 「审核并通知」提供复制开票信息；「上传发票照片」上传即定稿；「结算入账」在满 120 小时后可用。
 */
type ActionMode = 'review' | 'return' | 'cancel' | 'document' | 'settle'

const { t } = useI18n()
const router = useRouter()
const { auth } = useAppAuth()
const canReview = computed(() => auth('invoice-requests:review'))

const status = ref<'ALL' | InvoiceRequestStatusValue>('PENDING_REVIEW')
const keyword = ref('')
const items = ref<InvoiceRequestListItemDto[]>([])
const counts = ref<Record<string, number>>({})
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const failed = ref(false)
const now = ref(new Date())

const target = ref<InvoiceRequestListItemDto | null>(null)
const mode = ref<ActionMode | null>(null)
const reason = ref('')
const busy = ref(false)
const actionError = ref<string | null>(null)
const copyState = ref<'none' | 'copied' | 'failed'>('none')
const file = ref<File | null>(null)
const rate = ref<{ id: string, version: number, foreignUnitsPerCny: string } | null>(null)

const toolbarItems = computed(() => statusSwitchItems().map(item => ({
  value: item.value,
  label: t(item.labelKey),
  ...(counts.value[item.value] === undefined ? {} : { count: counts.value[item.value] }),
})))

const ACTION_TITLE_KEYS: Readonly<Record<ActionMode, string>> = {
  review: 'invoiceRequest.action.notify',
  return: 'invoiceRequest.action.return',
  cancel: 'invoiceRequest.action.cancel',
  document: 'invoiceRequest.action.document',
  settle: 'invoiceRequest.action.settle',
}

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
      invoiceRequestsApi.list({ page: page.value, pageSize: pageSize.value, status: status.value, ...(keyword.value === '' ? {} : { keyword: keyword.value }) }, signal),
      invoiceRequestsApi.statusCounts({ ...(keyword.value === '' ? {} : { keyword: keyword.value }) }, signal),
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

function changeStatus(value: string): void {
  status.value = value as 'ALL' | InvoiceRequestStatusValue
  page.value = 1
  void load()
}

async function openAction(item: InvoiceRequestListItemDto, next: ActionMode): Promise<void> {
  target.value = item
  mode.value = next
  reason.value = ''
  actionError.value = null
  copyState.value = 'none'
  file.value = null
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
  const item = target.value
  if (item === null || rate.value === null) {
    return null
  }
  const foreignUnitsPerCny = Number(rate.value.foreignUnitsPerCny)
  if (!Number.isFinite(foreignUnitsPerCny) || foreignUnitsPerCny <= 0) {
    return null
  }
  const amount = Math.ceil((Number(item.totalAmount) / foreignUnitsPerCny) * 0.06 + 30)
  return String(amount)
})

const settleWaitText = computed(() => {
  const item = target.value
  if (item === null) {
    return ''
  }
  if (item.documentUploadedAt === null) {
    return t('invoiceRequest.error.documentRequired')
  }
  if (isSettleable(item.documentUploadedAt, now.value)) {
    return t('invoiceRequest.detail.settleable')
  }
  const remaining = resolveSettleRemaining(item.documentUploadedAt, now.value)
  return remaining === null ? '' : t('invoiceRequest.detail.settleWait', remaining)
})

async function copyInvoiceInfo(): Promise<void> {
  const item = target.value
  if (item === null) {
    return
  }
  try {
    const { data } = await invoiceRequestsApi.get(item.id, new AbortController().signal)
    const copied = await navigator.clipboard.writeText(buildInvoiceCopyText(data))
    copyState.value = copied === undefined ? 'copied' : 'copied'
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

async function submitAction(): Promise<void> {
  const item = target.value
  if (item === null || mode.value === null) {
    return
  }
  busy.value = true
  actionError.value = null
  try {
    const signal = new AbortController().signal
    if (mode.value === 'review') {
      await invoiceRequestsApi.notify(item.id, { expectedVersion: item.version }, signal)
    }
    else if (mode.value === 'return') {
      await invoiceRequestsApi.requestReturn(item.id, { reason: reason.value.trim(), expectedVersion: item.version }, signal)
    }
    else if (mode.value === 'cancel') {
      await invoiceRequestsApi.cancel(item.id, { reason: reason.value.trim(), expectedVersion: item.version }, signal)
    }
    else if (mode.value === 'document') {
      if (file.value === null) {
        throw new Error('missing file')
      }
      await invoiceRequestsApi.uploadDocument(item.id, file.value, signal)
    }
    else {
      if (rate.value === null) {
        throw new Error('missing rate')
      }
      await invoiceRequestsApi.settle(item.id, { expectedVersion: item.version, exchangeRateId: rate.value.id, exchangeRateVersion: rate.value.version }, signal)
    }
    mode.value = null
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

/** 审核并通知前先把信息复制到剪贴板，是线下通知的实际入口。 */
function canConfirm(): boolean {
  if (busy.value) {
    return false
  }
  if (mode.value === 'return' || mode.value === 'cancel') {
    return reason.value.trim() !== ''
  }
  if (mode.value === 'document') {
    return file.value !== null
  }
  if (mode.value === 'settle') {
    return rate.value !== null && target.value !== null && target.value.documentUploadedAt !== null && isSettleable(target.value.documentUploadedAt, now.value)
  }
  return true
}

function goPage(next: number): void {
  page.value = next
  void load()
}

function closeAction(): void {
  mode.value = null
  target.value = null
}

onMounted(load)
</script>

<template>
  <FaPageMain v-if="!canReview">
    <p class="text-muted-foreground py-12 text-center">
      {{ t('invoiceRequest.list.noPermission') }}
    </p>
  </FaPageMain>
  <FaPageMain v-else class="min-w-0">
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-3 items-center">
        <QsStatusSwitchToolbar :items="toolbarItems" :model-value="status" @update:model-value="changeStatus" />
        <div class="ml-auto flex gap-2 items-center">
          <input v-model="keyword" class="text-sm px-3 border border-border rounded-md bg-background min-h-11 sm:min-h-9" :placeholder="t('invoiceRequest.list.searchPlaceholder')" @keyup.enter="load">
          <FaButton variant="outline" size="sm" :loading="loading" @click="load">
            {{ t('invoiceRequest.detail.retry') }}
          </FaButton>
        </div>
      </div>

      <p v-if="failed" class="text-sm text-destructive">
        {{ t('invoiceRequest.detail.loadFailed') }}
      </p>

      <div class="border border-border rounded-lg overflow-x-auto">
        <table class="text-sm min-w-[1000px] w-full">
          <thead class="text-left bg-muted/40">
            <tr>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.column.invoiceNo') }}
              </th>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.column.submitter') }}
              </th>
              <th class="font-medium px-3 py-2 text-right">
                {{ t('invoiceRequest.field.totalAmount') }}
              </th>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.column.submittedAt') }}
              </th>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.detail.settleableAt') }}
              </th>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.column.lastAction') }}
              </th>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.action.notify') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" class="border-t border-border">
              <td class="font-mono px-3 py-2">
                {{ item.invoiceNo }}
              </td>
              <td class="px-3 py-2">
                {{ item.creatorName }}
              </td>
              <td class="px-3 py-2 text-right tabular-nums">
                {{ item.totalAmount }}
              </td>
              <td class="px-3 py-2">
                <DateTimeDisplay :value="item.submittedAt" />
              </td>
              <td class="text-xs text-muted-foreground px-3 py-2">
                {{ item.documentUploadedAt === null ? '—' : (isSettleable(item.documentUploadedAt, now) ? t('invoiceRequest.detail.settleable') : t('invoiceRequest.detail.settleWait', resolveSettleRemaining(item.documentUploadedAt, now) ?? { hours: 0, minutes: 0 })) }}
              </td>
              <td class="px-3 py-2">
                <FaTag variant="outline" class="qs-type-status-tag" :class="statusTagClass(item.status)">
                  {{ t(`invoiceRequest.status.${item.status}`) }}
                </FaTag>
              </td>
              <td class="px-3 py-2">
                <div class="flex flex-wrap gap-2">
                  <FaButton v-if="item.status === 'PENDING_REVIEW'" variant="outline" size="sm" @click="openAction(item, 'review')">
                    {{ t('invoiceRequest.action.notify') }}
                  </FaButton>
                  <FaButton v-if="item.status === 'PENDING_REVIEW'" variant="ghost" size="sm" @click="openAction(item, 'return')">
                    {{ t('invoiceRequest.action.return') }}
                  </FaButton>
                  <FaButton v-if="item.status === 'NOTIFIED'" variant="outline" size="sm" @click="openAction(item, 'document')">
                    {{ t('invoiceRequest.action.document') }}
                  </FaButton>
                  <FaButton v-if="item.status === 'ISSUED'" :variant="isSettleable(item.documentUploadedAt, now) ? 'default' : 'outline'" size="sm" @click="openAction(item, 'settle')">
                    {{ t('invoiceRequest.action.settle') }}
                  </FaButton>
                  <FaButton v-if="item.status !== 'SETTLED' && item.status !== 'CANCELLED'" variant="ghost" size="sm" class="text-muted-foreground hover:text-destructive" @click="openAction(item, 'cancel')">
                    {{ t('invoiceRequest.action.cancel') }}
                  </FaButton>
                  <FaButton variant="ghost" size="sm" @click="router.push({ name: 'qsFinanceInvoicesDetail', params: { id: item.id } })">
                    {{ t('invoiceRequest.action.viewDetail') }}
                  </FaButton>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && items.length === 0">
              <td colspan="7" class="text-muted-foreground px-3 py-10 text-center">
                {{ t('invoiceRequest.list.empty') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="text-sm text-muted-foreground flex items-center justify-between">
        <span>{{ total }}</span>
        <div class="flex gap-2">
          <FaButton variant="outline" size="sm" :disabled="page <= 1 || loading" @click="goPage(page - 1)">
            ‹
          </FaButton>
          <FaButton variant="outline" size="sm" :disabled="page * pageSize >= total || loading" @click="goPage(page + 1)">
            ›
          </FaButton>
        </div>
      </div>
    </div>

    <div v-if="mode !== null && target !== null" class="p-4 bg-black/40 flex items-center inset-0 justify-center fixed z-50">
      <div class="p-5 rounded-lg bg-card max-w-lg w-full shadow-lg">
        <h3 class="text-base font-semibold">
          {{ t(ACTION_TITLE_KEYS[mode]) }} · {{ target.invoiceNo }}
        </h3>

        <p v-if="mode === 'review'" class="text-sm text-muted-foreground mt-3">
          {{ t('invoiceRequest.approval.notifyBody') }}
        </p>
        <p v-if="mode === 'return'" class="text-sm text-muted-foreground mt-3">
          {{ t('invoiceRequest.approval.returnBody') }}
        </p>
        <p v-if="mode === 'cancel'" class="text-sm text-muted-foreground mt-3">
          {{ target.documentMediaAssetId === null ? t('invoiceRequest.approval.cancelBody') : t('invoiceRequest.approval.cancelBodyIssued') }}
        </p>
        <p v-if="mode === 'document'" class="text-sm text-muted-foreground mt-3">
          {{ t('invoiceRequest.approval.documentBody') }}
        </p>
        <p v-if="mode === 'document'" class="text-xs text-muted-foreground mt-1">
          {{ t('invoiceRequest.approval.documentHint') }}
        </p>

        <div v-if="mode === 'review'" class="mt-4 flex gap-3 items-center">
          <FaButton variant="outline" size="sm" @click="copyInvoiceInfo">
            {{ t('invoiceRequest.approval.copy') }}
          </FaButton>
          <span v-if="copyState === 'copied'" class="text-sm text-primary">{{ t('invoiceRequest.approval.copied') }}</span>
          <span v-if="copyState === 'failed'" class="text-sm text-destructive">{{ t('invoiceRequest.approval.copyFailed') }}</span>
        </div>

        <label v-if="mode === 'return' || mode === 'cancel'" class="text-sm mt-4 flex flex-col gap-1">
          <span>{{ t('invoiceRequest.action.reasonLabel') }}</span>
          <textarea v-model="reason" rows="3" class="px-3 py-2 border border-border rounded-md bg-background" :placeholder="t('invoiceRequest.action.reasonPlaceholder')" />
        </label>

        <div v-if="mode === 'document'" class="mt-4">
          <input type="file" accept="image/jpeg,image/png,image/webp" class="text-sm" @change="pickFile">
        </div>

        <dl v-if="mode === 'settle'" class="text-sm mt-4 gap-1 grid">
          <div class="flex justify-between">
            <dt>{{ t('invoiceRequest.field.totalAmount') }}</dt><dd class="tabular-nums">
              {{ target.totalAmount }}
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
          <p class="text-xs text-muted-foreground mt-1">
            {{ t('invoiceRequest.approval.settleFormula') }}
          </p>
          <p class="text-xs text-muted-foreground">
            {{ settleWaitText }}
          </p>
        </dl>

        <p v-if="actionError !== null" class="text-sm text-destructive mt-3">
          {{ actionError }}
        </p>

        <div class="mt-5 flex gap-2 justify-end">
          <FaButton variant="outline" :disabled="busy" @click="closeAction()">
            {{ t('invoiceRequest.common.cancel') }}
          </FaButton>
          <FaButton :variant="mode === 'cancel' ? 'destructive' : 'default'" :loading="busy" :disabled="!canConfirm()" @click="submitAction">
            {{ t('invoiceRequest.common.confirm') }}
          </FaButton>
        </div>
      </div>
    </div>
  </FaPageMain>
</template>
