<script setup lang="ts">
import type { SalesOrderRecordsKind } from './sales-order-records-modal.logic'
import type {
  SalesOrderAmountRevisionDto,
  SalesOrderDetailDto,
  SalesOrderDocumentDto,
  SalesOrderListItemDto,
  SalesOrderPaymentDto,
  SalesOrderStatusHistoryDto,
} from '@/api/generated/types.gen'

import type { CurrencyDescriptor } from '@/components/base/currency'
import salesOrdersApi from '@/api/modules/sales-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { getSalesOrderApiFailure, isSalesOrderAbortError } from './sales-order-create.logic'

const props = defineProps<{
  currencies: readonly CurrencyDescriptor[]
  kind: SalesOrderRecordsKind
  modelValue: boolean
  order: SalesOrderListItemDto | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const detail = ref<SalesOrderDetailDto | null>(null)
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const activeChangeTab = ref<'status' | 'amount'>('status')
let requestVersion = 0
let detailAbortController: AbortController | null = null

const modalVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const modalTitle = computed(() => ({
  payments: '实际收款记录',
  documents: '订单凭证',
  changes: '变更记录',
})[props.kind])
const modalDescription = computed(() => props.order === null
  ? '查看销售订单相关记录。'
  : `${props.order.orderNo} · ${props.order.customerName}`)
const modalIcon = computed(() => ({
  payments: 'i-lucide:hand-coins',
  documents: 'i-lucide:files',
  changes: 'i-lucide:history',
})[props.kind])
const activeDocuments = computed(() => detail.value?.documents.filter(
  document => document.detachedAt === null,
) ?? [])
const changeTabs = computed(() => [
  {
    label: `状态变更（${detail.value?.statusHistory.length ?? 0}）`,
    value: 'status',
  },
  {
    label: `金额变更（${detail.value?.amountRevisions.length ?? 0}）`,
    value: 'amount',
  },
])

function paymentTypeLabel(value: SalesOrderPaymentDto['paymentType']): string {
  return { DEPOSIT: '定金', BALANCE: '尾款', OTHER: '其他收款' }[value]
}

function documentTypeLabel(value: SalesOrderDocumentDto['documentType']): string {
  return { DEPOSIT_VOUCHER: '定金凭证', DELIVERY_RECEIPT: '签收单', OTHER: '其他凭证' }[value]
}

function statusDimensionLabel(value: SalesOrderStatusHistoryDto['dimension']): string {
  return { ORDER: '订单状态', FULFILLMENT: '订单进度', PAYMENT: '付款状态' }[value]
}

function statusValueLabel(value: string): string {
  return {
    DRAFT: '草稿',
    CONFIRMED: '已确认',
    CANCELLED: '已取消',
    PENDING: '待处理',
    PREPARING: '备货中',
    SHIPPED: '已发货',
    SIGNED: '已签收',
    UNPAID: '未付款',
    PARTIALLY_PAID: '部分付款',
    PAID: '已付清',
  }[value] ?? value
}

function optionalText(value: string | null): string {
  return value?.trim() || '—'
}

function amountRevisionItems(revision: SalesOrderAmountRevisionDto) {
  return [
    {
      label: '销售总价',
      oldValue: revision.oldAgreedTotalAmount,
      newValue: revision.newAgreedTotalAmount,
    },
    {
      label: '定金',
      oldValue: revision.oldDepositDueAmount,
      newValue: revision.newDepositDueAmount,
    },
    {
      label: '尾款',
      oldValue: revision.oldBalanceDueAmount,
      newValue: revision.newBalanceDueAmount,
    },
  ]
}

function handleChangeTab(value: string | number): void {
  if (value === 'status' || value === 'amount') {
    activeChangeTab.value = value
  }
}

function cancelDetailRequest(): void {
  requestVersion += 1
  detailAbortController?.abort()
  detailAbortController = null
}

/** 每次打开都读取最新详情，避免列表计数和弹窗记录在状态变更后出现时间差。 */
async function loadDetail(): Promise<void> {
  const orderId = props.order?.id
  if (!props.modelValue || orderId === undefined) {
    return
  }

  cancelDetailRequest()
  const currentVersion = requestVersion
  const controller = new AbortController()
  detailAbortController = controller
  loading.value = true
  errorMessage.value = null
  detail.value = null

  try {
    const response = await salesOrdersApi.getById(orderId, controller.signal)
    if (
      currentVersion !== requestVersion
      || controller.signal.aborted
      || props.order?.id !== orderId
      || !props.modelValue
    ) {
      return
    }
    detail.value = response.data
  }
  catch (error) {
    if (isSalesOrderAbortError(error) || currentVersion !== requestVersion) {
      return
    }
    errorMessage.value = getSalesOrderApiFailure(error).message
  }
  finally {
    if (currentVersion === requestVersion) {
      loading.value = false
      detailAbortController = null
    }
  }
}

watch(
  () => [props.modelValue, props.order?.id, props.kind] as const,
  ([visible, orderId]) => {
    if (!visible || orderId === undefined) {
      cancelDetailRequest()
      detail.value = null
      errorMessage.value = null
      loading.value = false
      return
    }
    activeChangeTab.value = 'status'
    void loadDetail()
  },
  { immediate: true },
)

onBeforeUnmount(cancelDetailRequest)
</script>

<template>
  <QsGenericModal
    v-model="modalVisible"
    :title="modalTitle"
    :description="modalDescription"
    :loading="loading"
    :error="errorMessage"
    size="xl"
  >
    <template #header-leading>
      <FaIcon :name="modalIcon" class="size-5" aria-hidden="true" />
    </template>

    <template #error-actions>
      <FaButton type="button" variant="outline" @click="loadDetail">
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />重新加载
      </FaButton>
    </template>

    <template v-if="detail">
      <section v-if="kind === 'payments'" aria-label="实际收款记录列表">
        <FaEmpty
          v-if="detail.payments.length === 0"
          icon="i-lucide:hand-coins"
          title="暂无实际收款记录"
          description="该订单还没有有效或已作废的收款记录。"
          class="py-10"
        />
        <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
          <li
            v-for="payment in detail.payments"
            :key="payment.id"
            class="py-4 gap-4 grid sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap gap-2 items-center">
                <h3 class="qs-type-section-title m-0">
                  {{ paymentTypeLabel(payment.paymentType) }}
                </h3>
                <FaTag
                  variant="outline"
                  class="qs-type-status-tag"
                  :class="payment.voidedAt === null
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-destructive/30 bg-destructive/10 text-destructive'"
                >
                  {{ payment.voidedAt === null ? '有效' : '已作废' }}
                </FaTag>
              </div>
              <p class="qs-type-meta m-0 mt-2">
                收款时间：<DateTimeDisplay :value="payment.receivedAt" />
              </p>
              <dl class="text-sm m-0 mt-3 gap-x-5 gap-y-2 grid sm:grid-cols-2">
                <div>
                  <dt class="text-muted-foreground inline">
                    收款方式：
                  </dt><dd class="m-0 inline">
                    {{ optionalText(payment.paymentMethod) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-muted-foreground inline">
                    参考编号：
                  </dt><dd class="m-0 inline break-all">
                    {{ optionalText(payment.referenceNo) }}
                  </dd>
                </div>
                <div class="sm:col-span-2">
                  <dt class="text-muted-foreground inline">
                    备注：
                  </dt><dd class="m-0 inline break-words">
                    {{ optionalText(payment.remark) }}
                  </dd>
                </div>
                <div class="sm:col-span-2">
                  <dt class="text-muted-foreground inline">
                    记录人：
                  </dt>
                  <dd class="m-0 inline-flex gap-2 items-center">
                    <QsPersonDisplay :display-name="payment.createdBy.displayName" size="sm" />
                    <DateTimeDisplay :value="payment.createdAt" />
                  </dd>
                </div>
              </dl>
              <div
                v-if="payment.voidedAt"
                class="text-sm mt-3 p-3 border border-destructive/20 rounded-lg bg-destructive/5"
              >
                <p class="m-0 break-words">
                  作废原因：{{ optionalText(payment.voidReason) }}
                </p>
                <p class="text-muted-foreground m-0 mt-1">
                  {{ payment.voidedBy?.displayName ?? '未知用户' }} · <DateTimeDisplay :value="payment.voidedAt" />
                </p>
              </div>
            </div>
            <AmountDisplay
              :value="payment.amount"
              :currency="detail.currencyCode"
              :currencies="currencies"
              class="qs-type-data-emphasis whitespace-nowrap sm:text-right"
            />
          </li>
        </ul>
      </section>

      <section v-else-if="kind === 'documents'" aria-label="订单凭证列表">
        <FaEmpty
          v-if="activeDocuments.length === 0"
          icon="i-lucide:files"
          title="暂无订单凭证"
          description="该订单目前没有有效凭证。"
          class="py-10"
        />
        <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
          <li
            v-for="document in activeDocuments"
            :key="document.id"
            class="py-4 flex gap-4 min-w-0 items-start"
          >
            <a
              :href="document.contentUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="border border-border rounded-lg bg-muted/30 flex shrink-0 size-20 items-center justify-center overflow-hidden"
              :aria-label="`打开凭证 ${document.title || document.originalFilename}`"
            >
              <img
                v-if="document.mediaType === 'IMAGE'"
                :src="document.contentUrl"
                :alt="document.title || document.originalFilename"
                class="size-full object-cover"
              >
              <FaIcon v-else name="i-lucide:file-text" class="text-muted-foreground size-8" aria-hidden="true" />
            </a>
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap gap-2 items-center">
                <h3 class="qs-type-section-title m-0 break-words">
                  {{ document.title || document.originalFilename }}
                </h3>
                <FaTag variant="outline" class="qs-type-status-tag">
                  {{ documentTypeLabel(document.documentType) }}
                </FaTag>
              </div>
              <p class="qs-type-meta m-0 mt-1 break-all">
                {{ document.originalFilename }}<template v-if="document.mimeType">
                  · {{ document.mimeType }}
                </template><template v-if="document.sizeBytes">
                  · {{ document.sizeBytes }} bytes
                </template>
              </p>
              <p class="text-sm m-0 mt-2 break-words">
                备注：{{ optionalText(document.remark) }}
              </p>
              <div class="qs-type-meta mt-3 flex flex-wrap gap-x-4 gap-y-2 items-center">
                <span class="inline-flex gap-2 items-center">
                  上传人：<QsPersonDisplay :display-name="document.createdBy.displayName" size="sm" />
                </span>
                <span>上传时间：<DateTimeDisplay :value="document.createdAt" /></span>
                <span>{{ document.paymentId === null ? '未关联收款记录' : '已关联收款记录' }}</span>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <section v-else-if="kind === 'changes'" aria-label="订单变更记录">
        <FaTabs
          :model-value="activeChangeTab"
          :list="changeTabs"
          list-class="h-auto min-h-11 w-full"
          content-class="mt-4 min-w-0"
          @update:model-value="handleChangeTab"
        >
          <template #status>
            <FaEmpty
              v-if="detail.statusHistory.length === 0"
              icon="i-lucide:history"
              title="暂无状态变更"
              description="订单状态、订单进度和付款状态尚无变更记录。"
              class="py-10"
            />
            <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
              <li v-for="history in detail.statusHistory" :key="history.id" class="py-4">
                <div class="flex flex-wrap gap-2 items-center justify-between">
                  <h3 class="qs-type-section-title m-0">
                    {{ statusDimensionLabel(history.dimension) }}
                  </h3>
                  <DateTimeDisplay :value="history.changedAt" class="qs-type-meta" />
                </div>
                <p class="m-0 mt-2 flex flex-wrap gap-2 items-center">
                  <FaTag variant="outline" class="qs-type-status-tag">
                    {{ statusValueLabel(history.fromStatus) }}
                  </FaTag>
                  <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4" aria-hidden="true" />
                  <FaTag variant="outline" class="qs-type-status-tag">
                    {{ statusValueLabel(history.toStatus) }}
                  </FaTag>
                </p>
                <p class="text-sm m-0 mt-3 break-words">
                  原因：{{ optionalText(history.reason) }}
                </p>
                <div class="qs-type-meta mt-2 inline-flex gap-2 items-center">
                  操作人：<QsPersonDisplay :display-name="history.changedBy.displayName" size="sm" />
                </div>
              </li>
            </ul>
          </template>

          <template #amount>
            <FaEmpty
              v-if="detail.amountRevisions.length === 0"
              icon="i-lucide:badge-dollar-sign"
              title="暂无金额变更"
              description="销售总价、定金和尾款尚无修改记录。"
              class="py-10"
            />
            <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
              <li v-for="revision in detail.amountRevisions" :key="revision.id" class="py-4">
                <div class="flex flex-wrap gap-2 items-center justify-between">
                  <h3 class="qs-type-section-title m-0">
                    金额约定变更
                  </h3>
                  <DateTimeDisplay :value="revision.changedAt" class="qs-type-meta" />
                </div>
                <div class="mt-3 gap-3 grid md:grid-cols-3">
                  <div
                    v-for="amount in amountRevisionItems(revision)"
                    :key="amount.label"
                    class="p-3 border border-border rounded-lg bg-muted/15"
                  >
                    <p class="qs-type-compact-label m-0">
                      {{ amount.label }}
                    </p>
                    <div class="mt-2 flex flex-wrap gap-2 items-center">
                      <AmountDisplay :value="amount.oldValue" :currency="detail.currencyCode" :currencies="currencies" />
                      <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4" aria-hidden="true" />
                      <AmountDisplay :value="amount.newValue" :currency="detail.currencyCode" :currencies="currencies" />
                    </div>
                  </div>
                </div>
                <p class="text-sm m-0 mt-3 break-words">
                  原因：{{ revision.reason }}
                </p>
                <div class="qs-type-meta mt-2 inline-flex gap-2 items-center">
                  操作人：<QsPersonDisplay :display-name="revision.changedBy.displayName" size="sm" />
                </div>
              </li>
            </ul>
          </template>
        </FaTabs>
      </section>
    </template>
  </QsGenericModal>
</template>
