<script setup lang="ts">
import type { InvoiceRequestDto, InvoiceRequestHistoryDto, InvoiceRequestLineDto } from '@/api/generated/types.gen'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { resolveInvoiceFailureKey } from './invoice-failure.logic'
import { statusTagClass } from './invoice-status.logic'

/**
 * 开票申请只读详情抽屉：运营（开票记录）与财务（开票审批）共用。
 *
 * 只读、不承载任何动作——审批的写入动作在列表页的弹窗里。
 * 发票照片是私有内容：走 Blob + objectURL，并在身份切换、关闭与卸载时释放。
 */
const props = defineProps<{
  readonly id: string | null
  readonly modelValue: boolean
}>()
const emit = defineEmits<{
  'closed': []
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const accountStore = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()

const detail = ref<InvoiceRequestDto | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const photoUrl = ref<string | null>(null)
let abortController: AbortController | null = null

// 发票金额固定为台币：域内没有第二个币种，入账成本另按人民币展示。
const invoiceCurrency = 'TWD'

function releasePhoto(): void {
  if (photoUrl.value !== null) {
    URL.revokeObjectURL(photoUrl.value)
    photoUrl.value = null
  }
}

function reset(): void {
  abortController?.abort()
  abortController = null
  releasePhoto()
  detail.value = null
  error.value = null
  loading.value = false
}

async function load(): Promise<void> {
  if (props.id === null) {
    return
  }
  reset()
  const id = props.id
  const controller = new AbortController()
  abortController = controller
  const epoch = accountStore.authEpoch
  loading.value = true
  try {
    const { data } = await invoiceRequestsApi.get(id, controller.signal)
    // 身份切换后到达的旧响应必须丢弃，否则会把上一个身份的可见数据留在抽屉里。
    if (controller.signal.aborted || epoch !== accountStore.authEpoch) {
      return
    }
    detail.value = data
    if (data.documentMediaAssetId !== null) {
      const blob = await invoiceRequestsApi.documentBlob(id, controller.signal)
      if (controller.signal.aborted || epoch !== accountStore.authEpoch) {
        return
      }
      releasePhoto()
      photoUrl.value = URL.createObjectURL(blob.data)
    }
  }
  catch (failure) {
    if (controller.signal.aborted) {
      return
    }
    error.value = t(resolveInvoiceFailureKey(failure))
  }
  finally {
    if (!controller.signal.aborted) {
      loading.value = false
    }
  }
}

watch(() => [props.modelValue, props.id], ([open]) => {
  if (open) {
    void load()
  }
  else {
    reset()
  }
})

onBeforeUnmount(reset)

function close(): void {
  emit('update:modelValue', false)
}

function historyLine(entry: InvoiceRequestHistoryDto): string {
  return [t(`invoiceRequest.status.${entry.toStatus}`), entry.actorName].join(' · ')
}

/** 节点操作人：取流程历史里最近一次该动作的 actorName（退回可多次，取最新；未发生则为 null）。 */
const nodes = computed(() => {
  const history = detail.value?.history ?? []
  const actor = (action: InvoiceRequestHistoryDto['action']): string | null =>
    history.filter(entry => entry.action === action).at(-1)?.actorName ?? null
  return {
    applicant: detail.value?.creatorName ?? null,
    notifier: actor('NOTIFY'),
    uploader: actor('UPLOAD_DOCUMENT'),
    settler: actor('SETTLE'),
  }
})

function lineAmount(line: InvoiceRequestLineDto): string {
  return line.amount
}
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue"
    :title="t('invoiceRequest.detailTitle')"
    :description="detail === null ? undefined : `${detail.invoiceNo} · ${detail.buyerName}`"
    size="xl"
    :loading="loading"
    :error="error"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:receipt-text" class="size-5" aria-hidden="true" />
    </template>
    <template v-if="detail !== null && !loading && error === null" #header-extra>
      <FaTag variant="outline" class="qs-type-status-tag whitespace-nowrap" :class="statusTagClass(detail.status)">
        {{ t(`invoiceRequest.status.${detail.status}`) }}
      </FaTag>
    </template>
    <template #error-actions>
      <FaButton variant="outline" size="sm" @click="load">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
        {{ t('invoiceRequest.detail.retry') }}
      </FaButton>
    </template>

    <div v-if="detail !== null && error === null" class="space-y-5">
      <section class="p-4 border border-border rounded-xl bg-background min-w-0 space-y-4 sm:p-5">
        <header class="flex gap-2.5 items-center">
          <span class="text-muted-foreground rounded-lg bg-muted/60 flex shrink-0 size-8 items-center justify-center">
            <FaIcon name="i-lucide:clipboard-list" class="size-4" aria-hidden="true" />
          </span>
          <h3 class="qs-type-component-title m-0">
            {{ t('invoiceRequest.detail.sectionBasic') }}
          </h3>
        </header>
        <dl class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.detail.node.applicant') }}
            </dt>
            <dd class="m-0 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
              <QsPersonDisplay v-if="nodes.applicant !== null" :display-name="nodes.applicant" size="sm" />
              <span v-else class="qs-type-meta">—</span>
              <DateTimeDisplay :value="detail.submittedAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.detail.node.notifier') }}
            </dt>
            <dd class="m-0 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
              <QsPersonDisplay v-if="nodes.notifier !== null" :display-name="nodes.notifier" size="sm" />
              <span v-else class="qs-type-meta">—</span>
              <DateTimeDisplay :value="detail.notifiedAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.detail.node.uploader') }}
            </dt>
            <dd class="m-0 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
              <QsPersonDisplay v-if="nodes.uploader !== null" :display-name="nodes.uploader" size="sm" />
              <span v-else class="qs-type-meta">—</span>
              <DateTimeDisplay :value="detail.documentUploadedAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.detail.node.settler') }}
            </dt>
            <dd class="m-0 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
              <QsPersonDisplay v-if="nodes.settler !== null" :display-name="nodes.settler" size="sm" />
              <span v-else class="qs-type-meta">—</span>
              <DateTimeDisplay :value="detail.settledAt" />
            </dd>
          </div>
        </dl>
      </section>

      <section class="p-4 border border-border rounded-xl bg-background min-w-0 space-y-4 sm:p-5">
        <header class="flex gap-2.5 items-center">
          <span class="text-muted-foreground rounded-lg bg-muted/60 flex shrink-0 size-8 items-center justify-center">
            <FaIcon name="i-lucide:file-text" class="size-4" aria-hidden="true" />
          </span>
          <h3 class="qs-type-component-title m-0">
            {{ t('invoiceRequest.detail.sectionInvoice') }}
          </h3>
        </header>
        <dl class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.field.buyerName') }}
            </dt>
            <dd class="qs-type-body m-0 break-words">
              {{ detail.buyerName }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.field.buyerTaxId') }}
            </dt>
            <dd class="qs-type-data m-0">
              {{ detail.buyerTaxId }}
            </dd>
          </div>
        </dl>
        <div class="border border-border rounded-xl bg-background overflow-x-auto">
          <table class="text-sm w-full border-collapse">
            <caption class="sr-only">
              {{ t('invoiceRequest.form.linesSection') }}
            </caption>
            <thead class="bg-muted/45">
              <tr>
                <th scope="col" class="font-medium p-3 text-left w-12">
                  #
                </th>
                <th scope="col" class="font-medium p-3 text-left">
                  {{ t('invoiceRequest.field.productName') }}
                </th>
                <th scope="col" class="font-medium p-3 text-right w-20">
                  {{ t('invoiceRequest.field.quantity') }}
                </th>
                <th scope="col" class="font-medium p-3 text-right w-28">
                  {{ t('invoiceRequest.field.unitPrice') }}
                </th>
                <th scope="col" class="font-medium p-3 text-right w-32">
                  {{ t('invoiceRequest.field.amount') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="line in detail.lines" :key="line.lineNo" class="align-middle border-b border-border last:border-b-0">
                <td class="qs-type-meta p-3">
                  {{ line.lineNo }}
                </td>
                <td class="p-3 break-words">
                  {{ line.productName }}
                </td>
                <td class="qs-type-data p-3">
                  {{ line.quantity }}
                </td>
                <td class="qs-type-data p-3">
                  {{ line.unitPrice }}
                </td>
                <td class="qs-type-data-emphasis p-3">
                  {{ lineAmount(line) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex justify-end">
          <dl class="m-0 flex flex-col gap-2 w-full sm:w-80">
            <div class="flex gap-4 justify-between">
              <dt class="text-sm text-muted-foreground">
                {{ t('invoiceRequest.field.salesAmount') }}
              </dt>
              <dd class="m-0">
                <AmountDisplay :value="detail.salesAmount" :currency="invoiceCurrency" :currencies="currencyCatalog.currencies.value" />
              </dd>
            </div>
            <div class="flex gap-4 justify-between">
              <dt class="text-sm text-muted-foreground">
                {{ t('invoiceRequest.field.taxAmount') }}
              </dt>
              <dd class="m-0">
                <AmountDisplay :value="detail.taxAmount" :currency="invoiceCurrency" :currencies="currencyCatalog.currencies.value" />
              </dd>
            </div>
            <div class="p-4 border border-border rounded-xl bg-primary/5 flex gap-4 items-center justify-between">
              <dt class="text-sm text-muted-foreground">
                {{ t('invoiceRequest.field.totalAmount') }}
              </dt>
              <dd class="m-0 max-w-full overflow-x-auto">
                <AmountDisplay :value="detail.totalAmount" :currency="invoiceCurrency" :currencies="currencyCatalog.currencies.value" class="font-bold" />
              </dd>
            </div>
          </dl>
        </div>
        <dl class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.field.invoiceRemark') }}
            </dt>
            <dd class="qs-type-body m-0 break-words">
              {{ detail.invoiceRemark ?? '—' }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.field.internalRemark') }}
            </dt>
            <dd class="qs-type-body m-0 break-words">
              {{ detail.internalRemark ?? '—' }}
            </dd>
          </div>
        </dl>
      </section>

      <section class="p-4 border border-border rounded-xl bg-background min-w-0 space-y-4 sm:p-5">
        <header class="flex gap-2.5 items-center">
          <span class="text-muted-foreground rounded-lg bg-muted/60 flex shrink-0 size-8 items-center justify-center">
            <FaIcon name="i-lucide:truck" class="size-4" aria-hidden="true" />
          </span>
          <h3 class="qs-type-component-title m-0">
            {{ t('invoiceRequest.detail.sectionRecipient') }}
          </h3>
        </header>
        <dl class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.field.recipientName') }}
            </dt>
            <dd class="qs-type-body m-0">
              {{ detail.recipientName }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.field.recipientPhone') }}
            </dt>
            <dd class="qs-type-data m-0">
              {{ detail.recipientPhone }}
            </dd>
          </div>
          <div class="min-w-0 sm:col-span-2">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('invoiceRequest.field.recipientAddress') }}
            </dt>
            <dd class="qs-type-body m-0 [overflow-wrap:anywhere]">
              {{ detail.recipientAddress }}
            </dd>
          </div>
        </dl>
      </section>

      <div class="gap-5 grid min-w-0 lg:grid-cols-2">
        <section class="p-4 border border-border rounded-xl bg-background min-w-0 space-y-4 sm:p-5">
          <header class="flex gap-2.5 items-center">
            <span class="text-muted-foreground rounded-lg bg-muted/60 flex shrink-0 size-8 items-center justify-center">
              <FaIcon name="i-lucide:image" class="size-4" aria-hidden="true" />
            </span>
            <h3 class="qs-type-component-title m-0">
              {{ t('invoiceRequest.detail.document') }}
            </h3>
          </header>
          <FaImagePreview
            v-if="photoUrl !== null"
            :src="photoUrl"
            class="h-80 w-auto"
            :aria-label="t('invoiceRequest.detail.document')"
          />
          <p v-else class="qs-type-meta m-0">
            {{ t('invoiceRequest.detail.documentNone') }}
          </p>
        </section>

        <section class="p-4 border border-border rounded-xl bg-background min-w-0 space-y-4 sm:p-5">
          <header class="flex gap-2.5 items-center">
            <span class="text-muted-foreground rounded-lg bg-muted/60 flex shrink-0 size-8 items-center justify-center">
              <FaIcon name="i-lucide:landmark" class="size-4" aria-hidden="true" />
            </span>
            <h3 class="qs-type-component-title m-0">
              {{ t('invoiceRequest.detail.sectionSettle') }}
            </h3>
          </header>
          <dl v-if="detail.settleAmountCny !== null" class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('invoiceRequest.approval.settleRate') }}
              </dt>
              <dd class="qs-type-data m-0">
                {{ detail.foreignUnitsPerCnySnapshot ?? '—' }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('invoiceRequest.approval.settleAmount') }}
              </dt>
              <dd class="m-0">
                <AmountDisplay :value="detail.settleAmountCny" currency="CNY" :currencies="currencyCatalog.currencies.value" />
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('invoiceRequest.detail.settledAt') }}
              </dt>
              <dd class="m-0">
                <DateTimeDisplay :value="detail.settledAt" />
              </dd>
            </div>
          </dl>
          <p v-else class="qs-type-meta m-0">
            {{ t('invoiceRequest.detail.settleNone') }}
          </p>
        </section>
      </div>

      <section class="p-4 border border-border rounded-xl bg-background min-w-0 space-y-4 sm:p-5">
        <header class="flex gap-2.5 items-center">
          <span class="text-muted-foreground rounded-lg bg-muted/60 flex shrink-0 size-8 items-center justify-center">
            <FaIcon name="i-lucide:history" class="size-4" aria-hidden="true" />
          </span>
          <h3 class="qs-type-component-title m-0">
            {{ t('invoiceRequest.detail.sectionFlow') }}
          </h3>
        </header>
        <ol class="m-0 p-0 list-none space-y-3">
          <li v-for="entry in detail.history" :key="entry.occurredAt + entry.action" class="flex flex-wrap gap-x-3 gap-y-1 items-baseline">
            <span class="qs-type-body-medium">{{ historyLine(entry) }}</span>
            <DateTimeDisplay :value="entry.occurredAt" />
            <span v-if="entry.reason !== null" class="qs-type-meta basis-full">{{ t('invoiceRequest.detail.returnReason') }}：{{ entry.reason }}</span>
          </li>
        </ol>
        <p v-if="detail.documentUploadedAt !== null" class="qs-type-meta m-0">
          {{ t('invoiceRequest.detail.settleableAt') }}：{{ detail.settleableAt }}
        </p>
      </section>
    </div>

    <template #footer>
      <FaButton variant="outline" class="w-full md:w-auto" @click="close">
        {{ t('invoiceRequest.detail.close') }}
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
