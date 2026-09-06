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
  <section :aria-label="t('salesOrderDrawer.payments')" class="pt-5 border-t border-border">
    <h3 class="qs-type-section-title m-0 mb-3">
      {{ t('salesOrderDrawer.payments') }}（{{ detail.payments.length }}）
    </h3>
    <FaEmpty v-if="!detail.payments.length" :title="t('salesOrderDrawer.noPayments')" class="py-6" />
    <div v-else class="space-y-3">
      <FaCollapsible
        v-for="payment in detail.payments" :key="payment.id"
        :model-value="expandedPayment === payment.id"
        class="border border-border rounded-xl overflow-hidden [&_[data-slot=collapsible-trigger]]:w-full"
        @update:model-value="expandedPayment = $event ? payment.id : null"
      >
        <template #trigger="{ open }">
          <span class="p-3 text-start flex gap-3 min-w-0 items-center hover:bg-muted/30">
            <img v-if="payment.voucher.mediaType === 'IMAGE' && payment.voucher.detachedAt === null" :src="payment.voucher.contentUrl" :alt="t('salesOrderDesc.documentTypes.PAYMENT_VOUCHER')" class="border border-border rounded-lg shrink-0 size-12 object-contain">
            <FaIcon v-else name="i-lucide:receipt-text" class="text-muted-foreground shrink-0 size-8" />
            <span class="flex-1 min-w-0">
              <span class="flex flex-wrap gap-2 items-center">
                <span class="font-medium">{{ t(`salesOrderDrawer.paymentTypes.${payment.paymentType}`) }}</span>
                <FaTag variant="outline" :class="payment.voidedAt ? 'text-destructive' : 'text-primary'">{{ t(payment.voidedAt ? 'salesOrderDrawer.voided' : 'salesOrderDrawer.valid') }}</FaTag>
              </span>
              <span class="text-xs text-muted-foreground mt-1 block"><DateTimeDisplay :value="payment.receivedAt" /></span>
              <AmountDisplay :value="payment.amount" :currency="detail.currencyCode" :currencies="currencies" class="mt-2 max-w-full overflow-x-auto" />
            </span>
            <FaIcon :name="open ? 'i-lucide:chevron-up' : 'i-lucide:chevron-down'" class="text-muted-foreground shrink-0 size-4" />
          </span>
        </template>
        <div class="p-4 border-t border-border bg-muted/15 space-y-4">
          <dl class="text-sm m-0 gap-2 grid grid-cols-[auto_minmax(0,1fr)]">
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
          <OrderDocument :document="payment.voucher" />
        </div>
      </FaCollapsible>
    </div>
  </section>

  <section :aria-label="t('salesOrderDrawer.documents')" class="pt-5 border-t border-border">
    <h3 class="qs-type-section-title m-0 mb-3">
      {{ t('salesOrderDrawer.documents') }}（{{ documents.length }}）
    </h3>
    <FaEmpty v-if="!documents.length" :title="t('salesOrderDesc.empty.documents')" class="py-6" />
    <div v-else class="space-y-3">
      <FaCollapsible
        v-for="document in documents" :key="document.id"
        :model-value="expandedDocument === document.id"
        class="border border-border rounded-xl overflow-hidden [&_[data-slot=collapsible-trigger]]:w-full"
        @update:model-value="expandedDocument = $event ? document.id : null"
      >
        <template #trigger="{ open }">
          <span class="p-3 text-start flex gap-3 min-w-0 items-center hover:bg-muted/30">
            <img v-if="document.mediaType === 'IMAGE'" :src="document.contentUrl" :alt="document.originalFilename" class="border border-border rounded-lg shrink-0 size-12 object-contain">
            <FaIcon v-else name="i-lucide:file-text" class="text-muted-foreground shrink-0 size-8" />
            <span class="flex-1 min-w-0">
              <FaTag variant="outline" :class="document.documentType === 'DELIVERY_RECEIPT' ? 'text-amber-700 dark:text-amber-300' : 'text-sky-700 dark:text-sky-300'">{{ t(`salesOrderDesc.documentTypes.${document.documentType}`) }}</FaTag>
              <span class="text-sm font-medium mt-1 block truncate">{{ document.title || document.originalFilename }}</span>
              <span class="text-xs text-muted-foreground mt-1 block"><DateTimeDisplay :value="document.createdAt" /></span>
            </span>
            <FaIcon :name="open ? 'i-lucide:chevron-up' : 'i-lucide:chevron-down'" class="text-muted-foreground shrink-0 size-4" />
          </span>
        </template>
        <div class="p-4 border-t border-border bg-muted/15">
          <OrderDocument :document="document" />
        </div>
      </FaCollapsible>
    </div>
  </section>
</template>
