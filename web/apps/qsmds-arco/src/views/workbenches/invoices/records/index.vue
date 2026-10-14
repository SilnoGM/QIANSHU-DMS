<script setup lang="ts">
import type { InvoiceRequestStatusValue } from '../invoice-status.logic'
import type { InvoiceRequestDto, InvoiceRequestListItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import { isSettleable, resolveSettleRemaining, statusSwitchItems, statusTagClass } from '../invoice-status.logic'

/** 开票记录（运营）：仅本人数据，六态筛选（始终带计数），只有「已退回」提供重新填写入口。 */
const { t } = useI18n()
const router = useRouter()
const { auth } = useAppAuth()
const canRead = computed(() => auth('invoice-requests:read'))

const status = ref<'ALL' | InvoiceRequestStatusValue>('ALL')
const search = ref('')
const items = ref<InvoiceRequestListItemDto[]>([])
const counts = ref<Record<string, number>>({})
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const loadFailed = ref(false)
const detail = ref<InvoiceRequestDto | null>(null)
const detailOpen = ref(false)
const detailFailed = ref(false)
const photoUrl = ref<string | null>(null)
const now = ref(new Date())

// 计数始终显示：缺失按 0 展示，避免工具栏在计数回来之前跳动。
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

const columns = computed<QsGenericTableColumn<InvoiceRequestListItemDto>[]>(() => [
  { id: 'invoiceNo', accessorKey: 'invoiceNo', title: t('invoiceRequest.column.invoiceNo'), minWidth: 180, fixed: 'left', copyable: true },
  { id: 'submittedAt', accessorFn: row => row.submittedAt, title: t('invoiceRequest.column.submittedAt'), minWidth: 170 },
  { id: 'lineSummary', accessorFn: row => row.lineSummary ?? '—', title: t('invoiceRequest.column.lineSummary'), minWidth: 200 },
  { id: 'totalAmount', accessorKey: 'totalAmount', title: t('invoiceRequest.field.totalAmount'), minWidth: 120, align: 'right' },
  { id: 'status', accessorFn: row => row.status, title: t('invoiceRequest.column.lastAction'), minWidth: 140 },
  { id: 'settleable', accessorFn: row => settleHint(row), title: t('invoiceRequest.detail.settleableAt'), minWidth: 200 },
])

async function load(): Promise<void> {
  if (!canRead.value) {
    return
  }
  loading.value = true
  loadFailed.value = false
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
    loadFailed.value = true
  }
  finally {
    loading.value = false
  }
}

function changeStatus(): void {
  page.value = 1
  void load()
}

async function openDetail(row: InvoiceRequestListItemDto): Promise<void> {
  detailFailed.value = false
  detail.value = null
  detailOpen.value = true
  try {
    const { data } = await invoiceRequestsApi.get(row.id, new AbortController().signal)
    detail.value = data
    if (data.documentMediaAssetId !== null) {
      const blob = await invoiceRequestsApi.documentBlob(row.id, new AbortController().signal)
      photoUrl.value = URL.createObjectURL(blob.data)
    }
  }
  catch {
    detailFailed.value = true
  }
}

function closeDetail(): void {
  detailOpen.value = false
  if (photoUrl.value !== null) {
    URL.revokeObjectURL(photoUrl.value)
  }
  photoUrl.value = null
}

function refill(row: InvoiceRequestListItemDto): void {
  void router.push({ name: 'qsOperationsInvoicesCreate', query: { id: row.id } })
}

onMounted(load)
onBeforeUnmount(closeDetail)
</script>

<template>
  <FaPageMain v-if="!canRead">
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
        <FaButton variant="ghost" size="sm" @click="openDetail(row)">
          {{ t('invoiceRequest.action.viewDetail') }}
        </FaButton>
        <FaButton v-if="row.status === 'RETURNED'" variant="outline" size="sm" @click="refill(row)">
          {{ t('invoiceRequest.action.refill') }}
        </FaButton>
      </template>
    </QsGenericTable>
    <p v-if="loadFailed" class="text-sm text-destructive mt-3">
      {{ t('invoiceRequest.detail.loadFailed') }}
    </p>

    <QsGenericModal v-model="detailOpen" :title="t('invoiceRequest.detailTitle')" :description="detail === null ? undefined : `${detail.invoiceNo} · ${detail.buyerName}`" size="lg">
      <p v-if="detailFailed" class="text-sm text-destructive">
        {{ t('invoiceRequest.detail.loadFailed') }}
      </p>
      <div v-else-if="detail !== null" class="flex flex-col gap-3">
        <FaTag variant="outline" class="qs-type-status-tag self-start" :class="statusTagClass(detail.status)">
          {{ t(`invoiceRequest.status.${detail.status}`) }}
        </FaTag>
        <table class="text-sm w-full">
          <thead class="text-muted-foreground text-left">
            <tr>
              <th class="font-medium py-1">
                {{ t('invoiceRequest.field.productName') }}
              </th>
              <th class="font-medium py-1 text-right">
                {{ t('invoiceRequest.field.quantity') }}
              </th>
              <th class="font-medium py-1 text-right">
                {{ t('invoiceRequest.field.unitPrice') }}
              </th>
              <th class="font-medium py-1 text-right">
                {{ t('invoiceRequest.field.amount') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in detail.lines" :key="line.lineNo" class="border-t border-border">
              <td class="py-1">
                {{ line.productName }}
              </td>
              <td class="py-1 text-right tabular-nums">
                {{ line.quantity }}
              </td>
              <td class="py-1 text-right tabular-nums">
                {{ line.unitPrice }}
              </td>
              <td class="py-1 text-right tabular-nums">
                {{ line.amount }}
              </td>
            </tr>
          </tbody>
        </table>
        <dl class="text-sm pt-3 border-t border-border gap-1 grid">
          <div class="flex justify-between">
            <dt>{{ t('invoiceRequest.field.salesAmount') }}</dt><dd class="tabular-nums">
              {{ detail.salesAmount }}
            </dd>
          </div>
          <div class="flex justify-between">
            <dt>{{ t('invoiceRequest.field.taxAmount') }}</dt><dd class="tabular-nums">
              {{ detail.taxAmount }}
            </dd>
          </div>
          <div class="font-semibold flex justify-between">
            <dt>{{ t('invoiceRequest.field.totalAmount') }}</dt><dd class="tabular-nums">
              {{ detail.totalAmount }}
            </dd>
          </div>
        </dl>
        <dl class="text-sm gap-1 grid">
          <div class="flex gap-4 justify-between">
            <dt>{{ t('invoiceRequest.field.invoiceRemark') }}</dt><dd>{{ detail.invoiceRemark ?? '—' }}</dd>
          </div>
          <div class="flex gap-4 justify-between">
            <dt>{{ t('invoiceRequest.field.internalRemark') }}</dt><dd>{{ detail.internalRemark ?? '—' }}</dd>
          </div>
          <div class="flex gap-4 justify-between">
            <dt>{{ t('invoiceRequest.field.recipientName') }}</dt><dd>{{ detail.recipientName }}</dd>
          </div>
          <div class="flex gap-4 justify-between">
            <dt>{{ t('invoiceRequest.field.recipientPhone') }}</dt><dd>{{ detail.recipientPhone }}</dd>
          </div>
          <div class="flex gap-4 justify-between">
            <dt>{{ t('invoiceRequest.field.recipientAddress') }}</dt><dd class="text-right">
              {{ detail.recipientAddress }}
            </dd>
          </div>
          <div v-if="detail.settleAmountCny !== null" class="flex gap-4 justify-between">
            <dt>{{ t('invoiceRequest.approval.settleAmount') }}</dt><dd class="tabular-nums">
              {{ detail.settleAmountCny }}
            </dd>
          </div>
        </dl>
        <div>
          <p class="text-sm font-medium">
            {{ t('invoiceRequest.detail.document') }}
          </p>
          <img v-if="photoUrl !== null" :src="photoUrl" :alt="t('invoiceRequest.detail.document')" class="mt-2 border border-border rounded-md max-h-72 object-contain">
          <p v-else class="text-sm text-muted-foreground mt-1">
            {{ t('invoiceRequest.detail.documentNone') }}
          </p>
        </div>
        <div>
          <p class="text-sm font-medium">
            {{ t('invoiceRequest.detail.history') }}
          </p>
          <ul class="text-sm text-muted-foreground mt-2 flex flex-col gap-1">
            <li v-for="entry in detail.history" :key="entry.occurredAt + entry.action">
              {{ t(`invoiceRequest.status.${entry.toStatus}`) }} · {{ entry.actorName }} · {{ entry.occurredAt.slice(0, 19).replace('T', ' ') }}
              <span v-if="entry.reason !== null">· {{ entry.reason }}</span>
            </li>
          </ul>
        </div>
      </div>
      <template #footer>
        <FaButton variant="outline" @click="closeDetail">
          {{ t('invoiceRequest.common.confirm') }}
        </FaButton>
      </template>
    </QsGenericModal>
  </FaPageMain>
</template>
