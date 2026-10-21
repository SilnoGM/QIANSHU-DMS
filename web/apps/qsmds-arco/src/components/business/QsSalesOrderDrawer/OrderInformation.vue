<script setup lang="ts">
import type { SalesOrderDetailDto, SalesOrderLinePreviewDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import OrderRecords from './OrderRecords.vue'

const props = defineProps<{
  detail: SalesOrderDetailDto
  currencies: readonly CurrencyDescriptor[]
  linePreviews: readonly SalesOrderLinePreviewDto[]
}>()
const { t } = useI18n()
const imagesByLine = computed(() => new Map(props.linePreviews.map(item => [item.lineId, item.mainImage?.contentUrl])))
const region = computed(() => [
  props.detail.customer.countryRegion.name,
  props.detail.customer.provinceState.name,
  props.detail.customer.city.name,
].filter(Boolean).join(' / ') || '-')
const amountItems = computed(() => [
  { label: 'salesTotal', value: props.detail.amounts.agreedTotalAmount },
  { label: 'deposit', value: props.detail.amounts.depositDueAmount },
  { label: 'balance', value: props.detail.amounts.balanceDueAmount },
])
</script>

<template>
  <div class="pb-2 space-y-6">
    <section data-slot="sales-order-drawer-basic" :aria-label="t('salesOrderDesc.sections.basic')">
      <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
        {{ t('salesOrderDesc.sections.basic') }}
      </h3>
      <dl class="text-sm m-0 px-4 py-3 border border-border/70 rounded-xl bg-muted/25 gap-x-6 gap-y-3 grid grid-cols-1 sm:grid-cols-2">
        <div class="gap-3 grid grid-cols-[4.25rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.orderNo') }}
          </dt><dd class="qs-type-data m-0 [overflow-wrap:anywhere]">
            {{ detail.orderNo }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[4.25rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.orderDate') }}
          </dt><dd class="m-0">
            {{ detail.orderDate }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[4.25rem_minmax(0,1fr)] items-center">
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.issuer') }}
          </dt><dd class="m-0 min-w-0">
            <QsPersonDisplay :display-name="detail.issuer.displayName" size="sm" :avatar-url="detail.issuer.avatarUrl" />
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[4.25rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.currency') }}
          </dt><dd class="qs-type-data m-0">
            {{ detail.currencyCode }}
          </dd>
        </div>
      </dl>
    </section>
    <section data-slot="sales-order-drawer-customer" :aria-label="t('salesOrderDesc.sections.customer')">
      <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
        {{ t('salesOrderDesc.sections.customer') }}
      </h3>
      <dl class="text-sm m-0 px-4 gap-x-6 gap-y-3 grid grid-cols-1 sm:grid-cols-2">
        <div class="gap-3 grid grid-cols-[4.25rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.customerName') }}
          </dt><dd class="qs-type-body-medium m-0 break-words">
            {{ detail.customer.name || '-' }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[4.25rem_minmax(0,1fr)] items-baseline">
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.customerPhone') }}
          </dt><dd class="qs-type-data m-0 break-words">
            {{ detail.customer.phone || '-' }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[4.25rem_minmax(0,1fr)] items-baseline sm:col-span-2">
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.region') }}
          </dt><dd class="m-0 break-words">
            {{ region }}
          </dd>
        </div>
        <div class="gap-3 grid grid-cols-[4.25rem_minmax(0,1fr)] items-baseline sm:col-span-2">
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.fullAddress') }}
          </dt><dd class="m-0 [overflow-wrap:anywhere]">
            {{ detail.customer.fullAddress || '-' }}
          </dd>
        </div>
      </dl>
    </section>
    <section :aria-label="t('salesOrderDrawer.products')" class="pt-5 border-t border-border/70">
      <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
        {{ t('salesOrderDrawer.products') }}
        <span class="qs-type-meta px-2 py-0.5 rounded-md bg-muted tabular-nums">{{ detail.lines.length }}</span>
      </h3>
      <FaEmpty v-if="!detail.lines.length" :title="t('salesOrderDesc.empty.lines')" class="py-6" />
      <div v-else class="border border-border rounded-xl overflow-hidden">
        <ol class="m-0 p-0 list-none divide-border/70 divide-y">
          <li v-for="line in detail.lines" :key="line.id" class="p-4 min-w-0">
            <div class="flex gap-4 items-start">
              <ImageGroup v-if="imagesByLine.get(line.id)" :items="[{ src: imagesByLine.get(line.id)!, alt: line.productName }]" :size="72" :max-count="1" class="shrink-0" />
              <span v-else class="text-muted-foreground border border-border rounded-lg bg-muted/25 flex shrink-0 size-18 items-center justify-center"><FaIcon name="i-lucide:image-off" class="size-6" aria-hidden="true" /></span>
              <div class="flex-1 min-w-0">
                <p class="qs-type-meta m-0 [overflow-wrap:anywhere]" :class="line.productNo ? 'font-mono' : ''">
                  {{ line.productNo || t('salesOrderDesc.lineTypes.CUSTOM') }}
                </p>
                <p class="qs-type-component-title m-0 mt-1 [overflow-wrap:anywhere]">
                  {{ line.productName }}
                </p>
                <p class="qs-type-meta m-0 mt-1.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {{ t('salesOrderDesc.fields.lineRemark') }}{{ line.description || '-' }}
                </p>
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-x-4 gap-y-2 items-end justify-between">
              <div class="text-sm flex flex-wrap gap-1.5 min-w-0 items-baseline">
                <span class="qs-type-meta">{{ t('salesOrderDesc.fields.actualUnitPrice') }}</span>
                <AmountDisplay :value="line.actualUnitPriceAmount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto" />
                <span class="text-muted-foreground">× {{ line.quantity }}</span>
              </div>
              <div class="text-right flex flex-wrap gap-x-2 gap-y-1 max-w-full min-w-0 items-baseline justify-end">
                <span class="qs-type-meta">{{ t('salesOrderDesc.fields.lineSubtotal') }}</span>
                <AmountDisplay :value="line.lineTotalAmount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto !text-base !font-semibold" />
              </div>
            </div>
          </li>
        </ol>
        <div class="px-4 py-3 border-t border-border bg-muted/25 flex flex-wrap gap-2 items-center justify-between">
          <span class="qs-type-body-medium">{{ t('salesOrderDesc.fields.lineSubtotalAmount') }}</span>
          <AmountDisplay :value="detail.amounts.lineSubtotalAmount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto !text-base !font-semibold" />
        </div>
      </div>
    </section>
    <section :aria-label="t('salesOrderDesc.sections.sales')">
      <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
        {{ t('salesOrderDesc.sections.sales') }}
      </h3>
      <dl class="m-0 border border-border rounded-xl grid grid-cols-1 overflow-hidden sm:grid-cols-2">
        <div v-for="(amount, index) in amountItems" :key="amount.label" class="px-4 py-3 flex flex-wrap gap-x-3 gap-y-1 min-w-0 items-baseline justify-between" :class="index === 0 ? 'sm:col-span-2 bg-primary/5 border-b border-border' : index === 1 ? 'border-b border-border sm:border-b-0 sm:border-r' : ''">
          <dt class="text-sm text-muted-foreground">
            {{ t(`salesOrderDesc.fields.${amount.label}`) }}
          </dt>
          <dd class="m-0 max-w-full overflow-x-auto">
            <AmountDisplay :value="amount.value" :currency="detail.currencyCode" :currencies="currencies" :class="index === 0 ? '!text-xl !font-semibold' : '!text-sm'" />
          </dd>
        </div>
      </dl>
    </section>
    <OrderRecords :detail="detail" :currencies="currencies" />
  </div>
</template>
