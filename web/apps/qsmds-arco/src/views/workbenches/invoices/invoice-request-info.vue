<script setup lang="ts">
import type { InvoiceRequestDto, InvoiceRequestLineDto } from '@/api/generated/types.gen'
import { useI18n } from 'vue-i18n'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

/**
 * 「发票信息 + 收件信息」只读展示块：只读详情抽屉与发票审批弹窗第一步共用，
 * 保证两处的分组、字段与展示组件完全同源。
 */
defineProps<{ readonly detail: InvoiceRequestDto }>()

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()

// 发票金额固定为台币：域内没有第二个币种，入账成本另按人民币展示。
const invoiceCurrency = 'TWD'

function lineAmount(line: InvoiceRequestLineDto): string {
  return line.amount
}
</script>

<template>
  <div class="min-w-0 space-y-5">
    <section class="p-4 border border-border rounded-xl bg-background min-w-0 space-y-4 sm:p-5">
      <header class="flex gap-2.5 items-center">
        <span class="text-muted-foreground rounded-lg bg-muted/60 flex shrink-0 size-8 items-center justify-center">
          <FaIcon name="i-lucide:file-text" class="size-4" aria-hidden="true" />
        </span>
        <h3 class="qs-type-component-title m-0">
          {{ t('invoiceRequest.detail.sectionInvoice') }}
        </h3>
      </header>
      <div class="gap-4 grid min-w-0 sm:grid-cols-2">
        <div class="p-4 border border-border rounded-xl bg-muted/40 flex flex-col gap-2 min-w-0">
          <p class="qs-type-compact-label m-0">
            {{ t('invoiceRequest.field.buyerName') }}
          </p>
          <div class="flex gap-3 min-w-0 items-center justify-between">
            <span class="qs-type-section-title min-w-0 break-words">{{ detail.buyerName }}</span>
            <CopyCellButton :always-visible="true" :label="t('invoiceRequest.field.buyerName')" :text="detail.buyerName" />
          </div>
        </div>
        <div class="p-4 border border-border rounded-xl bg-muted/40 flex flex-col gap-2 min-w-0">
          <p class="qs-type-compact-label m-0">
            {{ t('invoiceRequest.field.buyerTaxId') }}
          </p>
          <div class="flex gap-3 min-w-0 items-center justify-between">
            <span class="text-lg qs-type-data-emphasis font-semibold min-w-0 break-words">{{ detail.buyerTaxId }}</span>
            <CopyCellButton :always-visible="true" :label="t('invoiceRequest.field.buyerTaxId')" :text="detail.buyerTaxId" />
          </div>
        </div>
      </div>
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
              <td class="qs-type-data p-3 text-right">
                {{ line.quantity }}
              </td>
              <td class="qs-type-data p-3 text-right">
                {{ line.unitPrice }}
              </td>
              <td class="qs-type-data-emphasis p-3 text-right">
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
      <div class="gap-4 grid min-w-0 sm:grid-cols-2">
        <div class="p-4 border border-border rounded-xl bg-background flex flex-col gap-2 min-w-0">
          <div class="flex gap-2 items-center justify-between">
            <p class="qs-type-compact-label m-0">
              {{ t('invoiceRequest.field.invoiceRemark') }}
            </p>
            <span class="text-xs text-primary font-medium px-1.5 py-0.5 rounded bg-primary/10 whitespace-nowrap">
              {{ t('invoiceRequest.detail.mergeIntoCopyText') }}
            </span>
          </div>
          <p class="qs-type-body m-0 break-words">
            {{ detail.invoiceRemark ?? '—' }}
          </p>
        </div>
        <div class="p-4 border border-amber-500/30 rounded-xl bg-amber-500/10 flex flex-col gap-2 min-w-0">
          <div class="flex gap-2 items-center justify-between">
            <p class="text-xs text-amber-700 font-medium m-0 dark:text-amber-300">
              {{ t('invoiceRequest.field.internalRemark') }}
            </p>
            <span class="text-xs text-amber-700 font-medium px-1.5 py-0.5 rounded bg-amber-500/15 whitespace-nowrap dark:text-amber-300">
              {{ t('invoiceRequest.detail.internalOnlyTag') }}
            </span>
          </div>
          <p class="qs-type-body m-0 break-words">
            {{ detail.internalRemark ?? '—' }}
          </p>
        </div>
      </div>
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
  </div>
</template>
