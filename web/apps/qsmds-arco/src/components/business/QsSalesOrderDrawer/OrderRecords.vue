<script setup lang="ts">
import type { SalesOrderDetailDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import { getOrderDocuments } from './logic'
import OrderDocument from './OrderDocument.vue'

const props = defineProps<{ detail: SalesOrderDetailDto, currencies: readonly CurrencyDescriptor[] }>()
const { t } = useI18n()
const methodCatalog = useDictionaryCatalog('payment.method')
const documents = computed(() => getOrderDocuments(props.detail.documents))
const expandedPayment = ref<string | null>(null)
const expandedDocument = ref<string | null>(null)
// 每次换单都清空展开状态，避免同一抽屉实例残留上一单的卡片状态。
watch(() => props.detail.id, () => {
  expandedPayment.value = null
  expandedDocument.value = null
})
</script>

<template>
  <section :aria-label="t('salesOrderDrawer.payments')" class="pt-5 border-t border-border/70">
    <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
      <FaIcon name="i-lucide:receipt" class="text-muted-foreground size-4" aria-hidden="true" />
      {{ t('salesOrderDrawer.payments') }}
      <span class="qs-type-meta px-2 py-0.5 rounded-md bg-muted tabular-nums">{{ detail.payments.length }}</span>
    </h3>
    <FaEmpty v-if="!detail.payments.length" :title="t('salesOrderDrawer.noPayments')" class="py-6" />
    <div v-else class="space-y-2.5">
      <FaCollapsible
        v-for="payment in detail.payments" :key="payment.id"
        :model-value="expandedPayment === payment.id"
        class="border border-border rounded-xl transition-colors duration-150 overflow-hidden [&_[data-slot=collapsible-trigger]]:w-full motion-reduce:transition-none"
        :class="expandedPayment === payment.id ? 'border-primary/35' : ''"
        @update:model-value="expandedPayment = $event ? payment.id : null"
      >
        <template #trigger="{ open }">
          <span class="p-4 text-start flex gap-3 min-w-0 items-center hover:bg-muted/25 sm:gap-4">
            <span class="border border-border/70 rounded-lg bg-muted/20 flex shrink-0 size-14 items-center justify-center overflow-hidden">
              <img v-if="payment.voucher.mediaType === 'IMAGE' && payment.voucher.detachedAt === null" :src="payment.voucher.contentUrl" :alt="t('salesOrderDesc.documentTypes.PAYMENT_VOUCHER')" class="size-full object-cover">
              <FaIcon v-else name="i-lucide:receipt-text" class="text-muted-foreground size-6" aria-hidden="true" />
            </span>
            <span class="flex flex-1 flex-wrap gap-x-4 gap-y-2 min-w-0 items-center justify-between">
              <span class="min-w-0">
                <span class="flex flex-wrap gap-2 items-center">
                  <span class="qs-type-body-medium">{{ t(`salesOrderDrawer.paymentTypes.${payment.paymentType}`) }}</span>
                  <FaTag variant="outline" :class="payment.voidedAt ? 'border-destructive/25 bg-destructive/5 text-destructive' : 'border-primary/20 bg-primary/5 text-primary dark:text-foreground'">{{ t(payment.voidedAt ? 'salesOrderDrawer.voided' : 'salesOrderDrawer.valid') }}</FaTag>
                </span>
                <span class="qs-type-meta mt-1.5 block"><DateTimeDisplay :value="payment.receivedAt" /></span>
              </span>
              <AmountDisplay :value="payment.amount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto !text-base !font-semibold" :class="payment.voidedAt ? 'text-muted-foreground! line-through' : ''" />
            </span>
            <span class="text-muted-foreground rounded-full bg-muted/50 flex shrink-0 size-7 items-center justify-center">
              <FaIcon name="i-lucide:chevron-down" class="size-4 transition-transform duration-150 motion-reduce:transition-none" :class="open ? 'rotate-180' : ''" aria-hidden="true" />
            </span>
          </span>
        </template>
        <div class="p-4 border-t border-border/70 bg-muted/15 space-y-4">
          <dl class="text-sm m-0 gap-x-3 gap-y-2.5 grid grid-cols-[4.5rem_minmax(0,1fr)] sm:grid-cols-[4.5rem_minmax(0,1fr)_4.5rem_minmax(0,1fr)]">
            <dt class="text-muted-foreground">
              {{ t('salesOrderDrawer.paymentMethod') }}
            </dt><dd class="m-0">
              {{ methodCatalog.resolve(payment.paymentMethod)?.label ?? payment.paymentMethod ?? '-' }}
            </dd>
            <dt class="text-muted-foreground">
              {{ t('salesOrderDrawer.recordedBy') }}
            </dt><dd class="m-0">
              <QsPersonDisplay :display-name="payment.createdBy.displayName" size="sm" />
            </dd>
            <dt class="text-muted-foreground">
              {{ t('salesOrderDrawer.recordedAt') }}
            </dt><dd class="m-0">
              <DateTimeDisplay :value="payment.createdAt" />
            </dd>
            <dt class="text-muted-foreground">
              {{ t('salesOrderDrawer.remark') }}
            </dt><dd class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {{ payment.remark || '-' }}
            </dd>
          </dl>
          <p v-if="payment.voidedAt" class="text-sm text-destructive m-0">
            {{ t('salesOrderDrawer.voidReason') }}：{{ payment.voidReason || '-' }} · <DateTimeDisplay :value="payment.voidedAt" />
          </p>
          <div class="pt-4 border-t border-border/70">
            <OrderDocument :document="payment.voucher" />
          </div>
        </div>
      </FaCollapsible>
    </div>
  </section>

  <section :aria-label="t('salesOrderDrawer.documents')" class="pt-5 border-t border-border/70">
    <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
      <FaIcon name="i-lucide:files" class="text-muted-foreground size-4" aria-hidden="true" />
      {{ t('salesOrderDrawer.documents') }}
      <span class="qs-type-meta px-2 py-0.5 rounded-md bg-muted tabular-nums">{{ documents.length }}</span>
    </h3>
    <FaEmpty v-if="!documents.length" :title="t('salesOrderDesc.empty.documents')" class="py-6" />
    <div v-else class="space-y-2.5">
      <FaCollapsible
        v-for="document in documents" :key="document.id"
        :model-value="expandedDocument === document.id"
        class="border border-border rounded-xl transition-colors duration-150 overflow-hidden [&_[data-slot=collapsible-trigger]]:w-full motion-reduce:transition-none"
        :class="expandedDocument === document.id ? 'border-primary/35' : ''"
        @update:model-value="expandedDocument = $event ? document.id : null"
      >
        <template #trigger="{ open }">
          <span class="p-4 text-start flex gap-3 min-w-0 items-center hover:bg-muted/25 sm:gap-4">
            <span class="border border-border/70 rounded-lg bg-muted/20 flex shrink-0 size-14 items-center justify-center overflow-hidden">
              <img v-if="document.mediaType === 'IMAGE'" :src="document.contentUrl" :alt="document.originalFilename" class="size-full object-cover">
              <FaIcon v-else name="i-lucide:file-text" class="text-muted-foreground size-6" aria-hidden="true" />
            </span>
            <span class="flex-1 min-w-0">
              <span class="flex flex-wrap gap-x-3 gap-y-1 items-center">
                <FaTag variant="outline" :class="document.documentType === 'DELIVERY_RECEIPT' ? 'border-amber-500/25 bg-amber-500/8 text-amber-700 dark:text-amber-300' : 'border-sky-500/25 bg-sky-500/8 text-sky-700 dark:text-sky-300'">{{ t(`salesOrderDesc.documentTypes.${document.documentType}`) }}</FaTag>
                <span class="qs-type-meta"><DateTimeDisplay :value="document.createdAt" /></span>
              </span>
              <span class="qs-type-body-medium mt-1.5 block truncate" :title="document.title || document.originalFilename">{{ document.title || document.originalFilename }}</span>
            </span>
            <span class="text-muted-foreground rounded-full bg-muted/50 flex shrink-0 size-7 items-center justify-center">
              <FaIcon name="i-lucide:chevron-down" class="size-4 transition-transform duration-150 motion-reduce:transition-none" :class="open ? 'rotate-180' : ''" aria-hidden="true" />
            </span>
          </span>
        </template>
        <div class="p-4 border-t border-border/70 bg-muted/15">
          <OrderDocument :document="document" />
        </div>
      </FaCollapsible>
    </div>
  </section>
</template>
