<script setup lang="ts">
import type { PurchaseOrderDetailDto, PurchaseOrderPaymentDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import { mediaThumbnailUrl } from '@/utils/media-variant'

const props = defineProps<{ detail: PurchaseOrderDetailDto, kind: 'payments' | 'documents', currencies: readonly CurrencyDescriptor[] }>()
const { t } = useI18n()
const paymentMethods = useDictionaryCatalog('payment.method')
const activeDocuments = computed(() => props.detail.documents.filter(document => document.detachedAt === null))
const documentRows = computed(() => {
  const payments = new Map(props.detail.payments.map(payment => [payment.id, payment]))
  return activeDocuments.value.map(document => ({ document, payment: document.paymentId === null ? undefined : payments.get(document.paymentId) }))
})
// 采购允许没有付款凭证；按同单付款 ID 关联，绝不按数组顺序猜测附件。
function paymentDocuments(payment: PurchaseOrderPaymentDto) {
  return activeDocuments.value.filter(document => document.paymentId === payment.id)
}
function optionalText(value: string | null | undefined) {
  return value?.trim() || '-'
}
function paymentMethodLabel(value: string) {
  return paymentMethods.resolve(value)?.label ?? optionalText(value)
}
const documentTones = {
  ORDER_ISSUANCE_VOUCHER: 'border-blue-500/30 bg-blue-500/8 text-blue-700 dark:text-blue-300',
  PAYMENT_VOUCHER: 'border-emerald-500/30 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300',
  DELIVERY_RECEIPT: 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300',
} as const
</script>

<template>
  <section v-if="kind === 'payments'" :aria-label="t('purchaseOrderList.records.payments')">
    <FaEmpty v-if="!detail.payments.length" icon="i-lucide:hand-coins" :title="t('purchaseOrderDrawer.noPayments')" :description="t('purchaseOrderList.records.noPaymentsDescription')" class="py-10" />
    <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
      <li v-for="payment in detail.payments" :key="payment.id" class="py-4 gap-4 grid sm:grid-cols-[minmax(0,1fr)_auto]">
        <div class="min-w-0">
          <div class="flex flex-wrap gap-2 items-center">
            <h3 class="qs-type-section-title m-0">
              {{ t(`purchaseOrderDrawer.paymentTypes.${payment.paymentType}`) }}
            </h3>
            <FaTag variant="outline" class="qs-type-status-tag" :class="payment.voidedAt === null ? 'border-primary/30 bg-primary/10 text-primary' : 'border-destructive/30 bg-destructive/10 text-destructive'">
              {{ t(payment.voidedAt === null ? 'purchaseOrderDrawer.valid' : 'purchaseOrderDrawer.voided') }}
            </FaTag>
          </div>
          <p class="qs-type-meta m-0 mt-2">
            {{ t('purchaseOrderList.records.paidAt') }}：<DateTimeDisplay :value="payment.paidAt" />
          </p>
          <dl class="text-sm m-0 mt-3 gap-x-5 gap-y-2 grid sm:grid-cols-2">
            <div>
              <dt class="text-muted-foreground inline">
                {{ t('purchaseOrderDrawer.paymentMethod') }}：
              </dt><dd class="m-0 inline">
                {{ paymentMethodLabel(payment.paymentMethod) }}
              </dd>
            </div>
            <div class="sm:col-span-2">
              <dt class="text-muted-foreground inline">
                {{ t('purchaseOrderList.records.remark') }}：
              </dt><dd class="m-0 inline whitespace-pre-wrap [overflow-wrap:anywhere]">
                {{ optionalText(payment.remark) }}
              </dd>
            </div>
            <div class="sm:col-span-2">
              <dt class="text-muted-foreground inline">
                {{ t('purchaseOrderDrawer.recordedBy') }}：
              </dt><dd class="m-0 flex flex-col gap-1 items-start">
                <QsPersonDisplay :display-name="payment.createdBy.displayName" size="sm" :avatar-url="payment.createdBy.avatarUrl" />
                <span class="text-muted-foreground"><DateTimeDisplay :value="payment.createdAt" /></span>
              </dd>
            </div>
          </dl>
          <p v-if="!paymentDocuments(payment).length" class="qs-type-meta m-0 mt-3">
            {{ t('purchaseOrderDrawer.noVoucher') }}
          </p>
          <div v-for="voucher in paymentDocuments(payment)" :key="voucher.id" class="mt-3 p-3 border border-border rounded-lg bg-muted/15 flex gap-3 min-w-0 items-center">
            <FaImagePreview v-if="voucher.mediaType === 'IMAGE'" :src="mediaThumbnailUrl(voucher.contentUrl) ?? voucher.contentUrl" class="rounded-md shrink-0 size-14 object-cover" :aria-label="t('purchaseOrderList.records.preview', { name: voucher.title || voucher.originalFilename })" />
            <a v-else :href="voucher.contentUrl" target="_blank" rel="noopener noreferrer" class="border border-border rounded-md bg-background flex shrink-0 size-14 items-center justify-center" :aria-label="t('purchaseOrderList.records.openFile', { name: voucher.title || voucher.originalFilename })">
              <FaIcon name="i-lucide:file-text" class="text-muted-foreground size-6" aria-hidden="true" />
            </a>
            <div class="min-w-0">
              <p class="text-sm font-medium m-0 truncate">
                {{ voucher.title || voucher.originalFilename }}
              </p>
              <p class="qs-type-meta m-0 mt-1 truncate">
                {{ voucher.originalFilename }}
              </p>
            </div>
          </div>
          <div v-if="payment.voidedAt" class="text-sm mt-3 p-3 border border-destructive/20 rounded-lg bg-destructive/5">
            <p class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {{ t('purchaseOrderDrawer.voidReason') }}：{{ optionalText(payment.voidReason) }}
            </p>
            <div class="mt-1 flex flex-col gap-1 items-start">
              <QsPersonDisplay :display-name="payment.voidedBy?.displayName ?? '-'" size="sm" :avatar-url="payment.voidedBy?.avatarUrl" />
              <span class="text-muted-foreground"><DateTimeDisplay :value="payment.voidedAt" /></span>
            </div>
          </div>
        </div>
        <AmountDisplay :value="payment.amount" :currency="detail.currencyCode" :currencies="currencies" class="qs-type-data-emphasis text-emerald-700 font-semibold max-w-full overflow-x-auto dark:text-emerald-300 sm:text-right" />
      </li>
    </ul>
  </section>

  <section v-else :aria-label="t('purchaseOrderList.records.documents')">
    <FaEmpty v-if="!documentRows.length" icon="i-lucide:files" :title="t('purchaseOrderDrawer.noDocuments')" :description="t('purchaseOrderList.records.noDocumentsDescription')" class="py-10" />
    <ul v-else class="m-0 p-0 list-none border-y border-border divide-border divide-y">
      <li v-for="{ document, payment } in documentRows" :key="document.id" class="py-4 flex gap-4 min-w-0 items-start">
        <FaImagePreview v-if="document.mediaType === 'IMAGE'" :src="mediaThumbnailUrl(document.contentUrl) ?? document.contentUrl" class="shrink-0 size-20 object-cover" :aria-label="t('purchaseOrderList.records.preview', { name: document.title || document.originalFilename })">
          <template #error>
            <div class="text-muted-foreground flex size-20 items-center justify-center">
              <FaIcon name="i-lucide:image-off" class="size-8" aria-hidden="true" />
              <span class="sr-only">{{ t('purchaseOrderList.records.imageError') }}</span>
            </div>
          </template>
        </FaImagePreview>
        <a v-else :href="document.contentUrl" target="_blank" rel="noopener noreferrer" class="border border-border rounded-lg bg-muted/30 flex shrink-0 size-20 items-center justify-center overflow-hidden" :aria-label="t('purchaseOrderList.records.openFile', { name: document.title || document.originalFilename })">
          <FaIcon name="i-lucide:file-text" class="text-muted-foreground size-8" aria-hidden="true" />
        </a>
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap gap-2 items-center">
            <h3 class="qs-type-section-title m-0 [overflow-wrap:anywhere]">
              {{ document.title || document.originalFilename }}
            </h3>
            <FaTag variant="outline" class="qs-type-status-tag" :class="documentTones[document.documentType]">
              {{ t(`purchaseOrderDrawer.documentTypes.${document.documentType}`) }}
            </FaTag>
          </div>
          <p class="qs-type-meta m-0 mt-1 break-all">
            {{ document.originalFilename }}<template v-if="document.mimeType">
              · {{ document.mimeType }}
            </template><template v-if="document.sizeBytes">
              · {{ document.sizeBytes }} bytes
            </template>
          </p>
          <p class="text-sm m-0 mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {{ t('purchaseOrderList.records.remark') }}：{{ optionalText(document.remark) }}
          </p>
          <div v-if="payment" class="text-sm mt-3 p-3 border border-primary/40 rounded-lg bg-primary/5 flex flex-wrap gap-x-4 gap-y-2 items-center">
            <span>{{ t('purchaseOrderList.records.paymentType') }}：{{ t(`purchaseOrderDrawer.paymentTypes.${payment.paymentType}`) }}</span>
            <span class="inline-flex flex-wrap gap-1 items-center">
              {{ t('purchaseOrderList.records.paymentAmount') }}：
              <AmountDisplay :value="payment.amount" :currency="detail.currencyCode" :currencies="currencies" class="text-primary" />
            </span>
            <span>{{ t('purchaseOrderList.records.paidAt') }}：<DateTimeDisplay :value="payment.paidAt" /></span>
            <FaTag variant="outline" class="qs-type-status-tag" :class="payment.voidedAt === null ? 'border-primary/30 bg-primary/10 text-primary' : 'border-destructive/30 bg-destructive/10 text-destructive'">
              {{ t(payment.voidedAt === null ? 'purchaseOrderDrawer.valid' : 'purchaseOrderDrawer.voided') }}
            </FaTag>
          </div>
          <div class="qs-type-meta mt-3 flex flex-wrap gap-x-4 gap-y-2 items-center">
            <span class="inline-flex gap-2 items-center">
              {{ t('purchaseOrderDrawer.uploadedBy') }}：<QsPersonDisplay :display-name="document.createdBy.displayName" size="sm" :avatar-url="document.createdBy.avatarUrl" />
            </span>
            <span>{{ t('purchaseOrderDrawer.uploadedAt') }}：<DateTimeDisplay :value="document.createdAt" /></span>
            <span>{{ t(document.paymentId === null ? 'purchaseOrderList.records.orderDocument' : 'purchaseOrderList.records.paymentDocument') }}</span>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
