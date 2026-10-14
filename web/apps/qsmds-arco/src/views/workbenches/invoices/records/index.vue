<script setup lang="ts">
import type { InvoiceRequestStatusValue } from '../invoice-status.logic'
import type { InvoiceRequestDto, InvoiceRequestListItemDto } from '@/api/generated/types.gen'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import { isSettleable, resolveSettleRemaining, statusSwitchItems, statusTagClass } from '../invoice-status.logic'

/** 开票记录（运营）：仅本人数据，六态筛选，只有「已退回」提供重新填写入口。 */
const { t } = useI18n()
const router = useRouter()
const { auth } = useAppAuth()
const canRead = computed(() => auth('invoice-requests:read'))

const status = ref<'ALL' | InvoiceRequestStatusValue>('ALL')
const keyword = ref('')
const items = ref<InvoiceRequestListItemDto[]>([])
const counts = ref<Record<string, number>>({})
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const loadFailed = ref(false)
const detail = ref<InvoiceRequestDto | null>(null)
const detailFailed = ref(false)
const photoUrl = ref<string | null>(null)
const now = ref(new Date())

const toolbarItems = computed(() => statusSwitchItems().map(item => ({
  value: item.value,
  label: t(item.labelKey),
  ...(counts.value[item.value] === undefined ? {} : { count: counts.value[item.value] }),
})))

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
      invoiceRequestsApi.list({ page: page.value, pageSize: pageSize.value, status: status.value, ...(keyword.value === '' ? {} : { keyword: keyword.value }) }, signal),
      invoiceRequestsApi.statusCounts({ ...(keyword.value === '' ? {} : { keyword: keyword.value }) }, signal),
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

function changeStatus(value: string): void {
  status.value = value as 'ALL' | InvoiceRequestStatusValue
  page.value = 1
  void load()
}

function applyKeyword(): void {
  page.value = 1
  void load()
}

async function openDetail(item: InvoiceRequestListItemDto): Promise<void> {
  detailFailed.value = false
  try {
    const { data } = await invoiceRequestsApi.get(item.id, new AbortController().signal)
    detail.value = data
    if (data.documentMediaAssetId !== null) {
      const blob = await invoiceRequestsApi.documentBlob(item.id, new AbortController().signal)
      photoUrl.value = URL.createObjectURL(blob.data)
    }
  }
  catch {
    detailFailed.value = true
  }
}

function closeDetail(): void {
  detail.value = null
  if (photoUrl.value !== null) {
    URL.revokeObjectURL(photoUrl.value)
  }
  photoUrl.value = null
}

function refill(item: InvoiceRequestListItemDto): void {
  void router.push({ name: 'qsOperationsInvoicesCreate', query: { id: item.id } })
}

function settleHint(item: InvoiceRequestListItemDto): string {
  if (item.documentUploadedAt === null) {
    return t('invoiceRequest.detail.documentNone')
  }
  if (isSettleable(item.documentUploadedAt, now.value)) {
    return t('invoiceRequest.detail.settleable')
  }
  const remaining = resolveSettleRemaining(item.documentUploadedAt, now.value)
  return remaining === null ? '' : t('invoiceRequest.detail.settleWait', remaining)
}

function goPage(next: number): void {
  page.value = next
  void load()
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
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-3 items-center">
        <QsStatusSwitchToolbar :items="toolbarItems" :model-value="status" @update:model-value="changeStatus" />
        <div class="ml-auto flex gap-2 items-center">
          <input v-model="keyword" class="text-sm px-3 border border-border rounded-md bg-background min-h-11 sm:min-h-9" :placeholder="t('invoiceRequest.list.searchPlaceholder')" @keyup.enter="applyKeyword">
          <FaButton variant="outline" size="sm" :loading="loading" @click="applyKeyword">
            {{ t('invoiceRequest.detail.retry') }}
          </FaButton>
        </div>
      </div>

      <p v-if="loadFailed" class="text-sm text-destructive">
        {{ t('invoiceRequest.detail.loadFailed') }}
      </p>

      <div class="border border-border rounded-lg overflow-x-auto">
        <table class="text-sm min-w-[900px] w-full">
          <thead class="text-left bg-muted/40">
            <tr>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.column.invoiceNo') }}
              </th>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.column.submittedAt') }}
              </th>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.column.lineSummary') }}
              </th>
              <th class="font-medium px-3 py-2 text-right">
                {{ t('invoiceRequest.field.totalAmount') }}
              </th>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.detail.settleableAt') }}
              </th>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.column.document') }}
              </th>
              <th class="font-medium px-3 py-2">
                {{ t('invoiceRequest.column.lastAction') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" class="border-t border-border">
              <td class="font-mono px-3 py-2">
                {{ item.invoiceNo }}
              </td>
              <td class="px-3 py-2">
                <DateTimeDisplay :value="item.submittedAt" />
              </td>
              <td class="px-3 py-2">
                {{ item.lineSummary ?? '—' }}
              </td>
              <td class="px-3 py-2 text-right tabular-nums">
                {{ item.totalAmount }}
              </td>
              <td class="text-xs text-muted-foreground px-3 py-2">
                {{ settleHint(item) }}
              </td>
              <td class="px-3 py-2">
                <FaTag variant="outline" class="qs-type-status-tag" :class="statusTagClass(item.status)">
                  {{ t(`invoiceRequest.status.${item.status}`) }}
                </FaTag>
              </td>
              <td class="px-3 py-2">
                <div class="flex gap-2">
                  <FaButton variant="ghost" size="sm" @click="openDetail(item)">
                    {{ t('invoiceRequest.action.viewDetail') }}
                  </FaButton>
                  <FaButton v-if="item.status === 'RETURNED'" variant="outline" size="sm" @click="refill(item)">
                    {{ t('invoiceRequest.action.refill') }}
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

    <div v-if="detail !== null || detailFailed" class="p-4 bg-black/40 flex items-center inset-0 justify-center fixed z-50" @click.self="closeDetail">
      <div class="p-5 rounded-lg bg-card max-h-[90vh] max-w-2xl w-full shadow-lg overflow-y-auto">
        <template v-if="detailFailed">
          <p class="text-sm text-destructive">
            {{ t('invoiceRequest.detail.loadFailed') }}
          </p>
        </template>
        <template v-else-if="detail !== null">
          <div class="flex gap-4 items-start justify-between">
            <div>
              <h3 class="text-base font-semibold">
                {{ detail.invoiceNo }}
              </h3>
              <p class="text-sm text-muted-foreground mt-1">
                {{ detail.buyerName }} · {{ detail.buyerTaxId }}
              </p>
            </div>
            <FaTag variant="outline" class="qs-type-status-tag" :class="statusTagClass(detail.status)">
              {{ t(`invoiceRequest.status.${detail.status}`) }}
            </FaTag>
          </div>

          <table class="text-sm mt-4 w-full">
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
          <dl class="text-sm mt-3 pt-3 border-t border-border gap-1 grid">
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
          <dl class="text-sm mt-3 gap-1 grid">
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

          <div class="mt-4">
            <p class="text-sm font-medium">
              {{ t('invoiceRequest.detail.document') }}
            </p>
            <img v-if="photoUrl !== null" :src="photoUrl" :alt="t('invoiceRequest.detail.document')" class="mt-2 border border-border rounded-md max-h-72 object-contain">
            <p v-else class="text-sm text-muted-foreground mt-1">
              {{ t('invoiceRequest.detail.documentNone') }}
            </p>
          </div>

          <div class="mt-4">
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
        </template>
        <div class="mt-5 flex justify-end">
          <FaButton variant="outline" @click="closeDetail">
            {{ t('invoiceRequest.common.confirm') }}
          </FaButton>
        </div>
      </div>
    </div>
  </FaPageMain>
</template>
