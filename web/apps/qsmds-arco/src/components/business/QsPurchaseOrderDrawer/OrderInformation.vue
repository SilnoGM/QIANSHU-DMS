<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { getPurchaseProductImages } from './logic'

const props = defineProps<{
  detail: PurchaseOrderDetailDto
  currencies: readonly CurrencyDescriptor[]
}>()
const { t } = useI18n()
const imagesByLine = computed(() => getPurchaseProductImages(props.detail))
// 保留采购三维状态的语义色，不把未付款、备货中误显示为成功态。
const statusClasses: Record<string, string> = {
  CANCELLED: 'text-destructive border-destructive/25 bg-destructive/5',
  UNPAID: 'text-destructive border-destructive/25 bg-destructive/5',
  PARTIALLY_PAID: 'text-amber-700 border-amber-500/25 bg-amber-500/8 dark:text-amber-300',
  PREPARING: 'text-amber-700 border-amber-500/25 bg-amber-500/8 dark:text-amber-300',
  PENDING_REVIEW: 'text-amber-700 border-amber-500/25 bg-amber-500/8 dark:text-amber-300',
  ORDERED: 'text-sky-700 border-sky-500/25 bg-sky-500/8 dark:text-sky-300',
  SHIPPED: 'text-sky-700 border-sky-500/25 bg-sky-500/8 dark:text-sky-300',
}
const statuses = computed(() => [
  { label: 'orderStatus', value: props.detail.orderStatus },
  { label: 'fulfillmentStatus', value: props.detail.fulfillmentStatus },
  { label: 'paymentStatus', value: props.detail.paymentStatus },
])
const amountItems = computed(() => [
  { label: 'purchaseTotal', value: props.detail.amounts.purchaseTotalAmount },
  { label: 'deposit', value: props.detail.amounts.depositDueAmount },
  { label: 'balance', value: props.detail.amounts.balanceDueAmount },
  { label: 'paid', value: props.detail.amounts.paidAmount },
  { label: 'outstanding', value: props.detail.amounts.outstandingAmount },
])
</script>

<template>
  <div class="pb-2 space-y-6">
    <section data-slot="purchase-order-drawer-basic" :aria-label="t('purchaseOrderDesc.sections.basic')">
      <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
        {{ t('purchaseOrderDesc.sections.basic') }}
      </h3>
      <dl class="text-sm m-0 px-4 py-3 border border-border/70 rounded-xl bg-muted/25 gap-x-6 gap-y-3 grid grid-cols-1 sm:grid-cols-2">
        <div class="gap-3 grid grid-cols-[5rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.orderNo') }}
          </dt><dd class="qs-type-data m-0 [overflow-wrap:anywhere]">
            {{ detail.orderNo }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[5rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.orderDate') }}
          </dt><dd class="m-0">
            {{ detail.orderDate }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[5rem_minmax(0,1fr)] items-center">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.issuer') }}
          </dt><dd class="m-0 min-w-0">
            <QsPersonDisplay :display-name="detail.createdBy.displayName" size="sm" />
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[5rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.currency') }}
          </dt><dd class="qs-type-data m-0">
            {{ detail.currencyCode }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[5rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.purchaseType') }}
          </dt><dd class="m-0">
            {{ t(`purchaseOrderDrawer.purchaseTypes.${detail.purchaseType}`) }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[5rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDrawer.productMode') }}
          </dt><dd class="m-0">
            {{ t(`purchaseOrderDrawer.productModes.${detail.productMode}`) }}
          </dd>
        </div>
      </dl>
      <dl class="text-sm m-0 mt-3 px-4 flex flex-wrap gap-x-5 gap-y-2">
        <div v-for="status in statuses" :key="status.label" class="flex gap-2 items-center">
          <dt class="text-muted-foreground">
            {{ t(`purchaseOrderDrawer.${status.label}`) }}
          </dt><dd class="m-0">
            <FaTag variant="outline" :class="statusClasses[status.value] ?? 'text-primary border-primary/20 bg-primary/5 dark:text-foreground'">
              {{ t(`purchaseOrderDrawer.statuses.${status.value}`) }}
            </FaTag>
          </dd>
        </div>
      </dl>
    </section>
    <section data-slot="purchase-order-drawer-source" :aria-label="t('purchaseOrderDesc.sections.source')">
      <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />{{ t('purchaseOrderDesc.sections.source') }}
      </h3>
      <dl class="text-sm m-0 px-4 gap-x-6 gap-y-3 grid grid-cols-1 sm:grid-cols-2">
        <div class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline sm:col-span-2">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.supplier') }}
          </dt><dd class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
            {{ detail.supplier.label }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.salesOrderNo') }}
          </dt><dd class="qs-type-data m-0 [overflow-wrap:anywhere]">
            {{ detail.sourceSalesOrder?.orderNo || detail.salesOrderNo || t('purchaseOrderDesc.empty.independentStock') }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.customerName') }}
          </dt><dd class="m-0 [overflow-wrap:anywhere]">
            {{ detail.sourceSalesOrder?.customerName || detail.customerName || t('purchaseOrderDesc.empty.unlinkedCustomer') }}
          </dd>
        </div>
      </dl>
    </section>
    <section :aria-label="t('purchaseOrderDrawer.products')" class="pt-5 border-t border-border/70">
      <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
        {{ t('purchaseOrderDrawer.products') }}
        <span class="qs-type-meta px-2 py-0.5 rounded-md bg-muted tabular-nums">{{ detail.lines.length }}</span>
      </h3>
      <FaEmpty v-if="!detail.lines.length" :title="t('purchaseOrderDesc.empty.lines')" class="py-6" />
      <div v-else class="border border-border rounded-xl overflow-hidden">
        <ol class="m-0 p-0 list-none divide-border/70 divide-y">
          <li v-for="line in detail.lines" :key="line.id" class="p-4 min-w-0">
            <div class="flex gap-4 items-start">
              <ImageGroup v-if="imagesByLine.get(line.id)" :items="[{ src: imagesByLine.get(line.id)!, alt: line.productName }]" :size="72" :max-count="1" class="shrink-0" />
              <span v-else class="text-muted-foreground border border-border rounded-lg bg-muted/25 flex shrink-0 size-18 items-center justify-center"><FaIcon name="i-lucide:image-off" class="size-6" aria-hidden="true" /></span>
              <div class="flex-1 min-w-0">
                <p class="qs-type-meta m-0 [overflow-wrap:anywhere]" :class="line.productNo ? 'font-mono' : ''">
                  {{ line.productNo || t('purchaseOrderDesc.lineTypes.CUSTOM') }}
                </p>
                <p class="qs-type-component-title m-0 mt-1 [overflow-wrap:anywhere]">
                  {{ line.productName }}
                </p>
                <p class="qs-type-meta m-0 mt-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {{ t('purchaseOrderDesc.fields.lineRemark') }}{{ line.description || '-' }}
                </p>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2 items-end justify-between">
              <div class="text-sm flex flex-wrap gap-1.5 min-w-0 items-baseline">
                <span class="qs-type-meta">{{ t('purchaseOrderDesc.fields.actualPurchaseUnitPrice') }}</span>
                <AmountDisplay :value="line.actualPurchaseUnitPriceAmount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto" />
                <span class="text-muted-foreground">× {{ line.quantity }}</span>
              </div>
              <div class="text-right flex flex-wrap gap-x-2 gap-y-1 max-w-full min-w-0 items-baseline justify-end">
                <span class="qs-type-meta">{{ t('purchaseOrderDesc.fields.lineSubtotal') }}</span>
                <AmountDisplay :value="line.lineTotalAmount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto !text-base !font-semibold" />
              </div>
            </div>
          </li>
        </ol>
        <div class="px-4 py-3 border-t border-border bg-muted/25 flex flex-wrap gap-2 items-center justify-between">
          <span class="qs-type-body-medium">{{ t('purchaseOrderDesc.fields.lineSubtotalAmount') }}</span>
          <AmountDisplay :value="detail.amounts.lineSubtotalAmount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto !text-base !font-semibold" />
        </div>
      </div>
    </section>
    <section :aria-label="t('purchaseOrderDesc.sections.purchase')">
      <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
        {{ t('purchaseOrderDesc.sections.purchase') }}
      </h3>
      <dl class="m-0 border border-border rounded-xl grid grid-cols-1 overflow-hidden sm:grid-cols-2">
        <div v-for="(amount, index) in amountItems" :key="amount.label" class="px-4 py-3 flex flex-wrap gap-x-3 gap-y-1 min-w-0 items-baseline justify-between" :class="index === 0 ? 'sm:col-span-2 bg-primary/5 border-b border-border' : index % 2 === 1 ? 'border-b border-border sm:border-r' : 'border-b border-border'">
          <dt class="text-sm text-muted-foreground">
            {{ t(`purchaseOrderDesc.fields.${amount.label}`) }}
          </dt>
          <dd class="m-0 max-w-full overflow-x-auto">
            <AmountDisplay :value="amount.value" :currency="detail.currencyCode" :currencies="currencies" :class="index === 0 ? '!text-xl !font-semibold' : '!text-sm'" />
          </dd>
        </div>
      </dl>
    </section>
    <section :aria-label="t('purchaseOrderDesc.sections.notes')" class="pt-5 border-t border-border/70">
      <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />{{ t('purchaseOrderDesc.sections.notes') }}
      </h3>
      <dl class="text-sm m-0 px-4 flex flex-col gap-4">
        <div class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)]">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.shippingMark') }}
          </dt><dd class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {{ detail.shippingMarkText || '-' }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)]">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.remark') }}
          </dt><dd class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {{ detail.remark || '-' }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)]">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.createdAt') }}
          </dt><dd class="m-0 min-w-0">
            <DateTimeDisplay :value="detail.createdAt" class="whitespace-normal!" />
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[4.5rem_minmax(0,1fr)]">
          <dt class="text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.updatedAt') }}
          </dt><dd class="m-0 min-w-0">
            <DateTimeDisplay :value="detail.updatedAt" class="whitespace-normal!" />
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>
