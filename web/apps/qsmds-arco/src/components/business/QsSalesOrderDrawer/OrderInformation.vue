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
  <div class="space-y-6">
    <section :aria-label="t('salesOrderDesc.sections.basic')">
      <h3 class="qs-type-section-title m-0 mb-3">
        {{ t('salesOrderDesc.sections.basic') }}
      </h3>
      <dl class="text-sm m-0 gap-x-6 gap-y-4 grid grid-cols-1 sm:grid-cols-2">
        <div>
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.orderNo') }}
          </dt><dd class="font-qs-data-mono m-0 mt-1 [overflow-wrap:anywhere]">
            {{ detail.orderNo }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.orderDate') }}
          </dt><dd class="m-0 mt-1">
            {{ detail.orderDate }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.issuer') }}
          </dt><dd class="m-0 mt-1">
            <QsPersonDisplay :display-name="detail.issuer.displayName" size="sm" />
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.currency') }}
          </dt><dd class="m-0 mt-1">
            {{ detail.currencyCode }}
          </dd>
        </div>
      </dl>
    </section>
    <section :aria-label="t('salesOrderDesc.sections.customer')" class="pt-5 border-t border-border">
      <h3 class="qs-type-section-title m-0 mb-3">
        {{ t('salesOrderDesc.sections.customer') }}
      </h3>
      <dl class="text-sm m-0 gap-x-6 gap-y-4 grid grid-cols-1 sm:grid-cols-2">
        <div>
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.customerName') }}
          </dt><dd class="m-0 mt-1 break-words">
            {{ detail.customer.name || '-' }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.customerPhone') }}
          </dt><dd class="font-qs-data-mono m-0 mt-1 break-words">
            {{ detail.customer.phone || '-' }}
          </dd>
        </div>
        <div class="sm:col-span-2">
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.region') }}
          </dt><dd class="m-0 mt-1 break-words">
            {{ region }}
          </dd>
        </div>
        <div class="sm:col-span-2">
          <dt class="text-muted-foreground">
            {{ t('salesOrderDesc.fields.fullAddress') }}
          </dt><dd class="m-0 mt-1 [overflow-wrap:anywhere]">
            {{ detail.customer.fullAddress || '-' }}
          </dd>
        </div>
      </dl>
    </section>
    <section :aria-label="t('salesOrderDrawer.products')" class="pt-5 border-t border-border">
      <h3 class="qs-type-section-title m-0 mb-3">
        {{ t('salesOrderDrawer.products') }}（{{ detail.lines.length }}）
      </h3>
      <FaEmpty v-if="!detail.lines.length" :title="t('salesOrderDesc.empty.lines')" class="py-6" />
      <ol v-else class="m-0 p-0 list-none space-y-3">
        <li v-for="line in detail.lines" :key="line.id" class="p-3 border border-border rounded-xl min-w-0">
          <div class="flex gap-3 items-start">
            <ImageGroup v-if="imagesByLine.get(line.id)" :items="[{ src: imagesByLine.get(line.id)!, alt: line.productName }]" :size="56" :max-count="1" class="shrink-0" />
            <span v-else class="text-muted-foreground border border-border rounded-lg bg-muted/30 flex shrink-0 size-14 items-center justify-center"><FaIcon name="i-lucide:image-off" class="size-5" /></span>
            <div class="text-sm flex-1 min-w-0">
              <p class="font-medium m-0 [overflow-wrap:anywhere]">
                <span class="text-muted-foreground">{{ line.productNo || t('salesOrderDesc.lineTypes.CUSTOM') }} · </span>{{ line.productName }}
              </p>
              <p class="text-muted-foreground m-0 mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {{ t('salesOrderDesc.fields.lineRemark') }}{{ line.description || '-' }}
              </p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-3 items-end justify-between">
            <div class="text-xs text-muted-foreground flex flex-wrap gap-1 min-w-0 items-baseline">
              <span>{{ t('salesOrderDesc.fields.actualUnitPrice') }}</span>
              <AmountDisplay :value="line.actualUnitPriceAmount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto !text-xs" />
              <span>× {{ line.quantity }}</span>
            </div>
            <div class="text-right max-w-full min-w-0">
              <p class="text-xs text-muted-foreground m-0 mb-1">
                {{ t('salesOrderDesc.fields.lineSubtotal') }}
              </p>
              <AmountDisplay :value="line.lineTotalAmount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto" />
            </div>
          </div>
        </li>
      </ol>
      <div class="mt-3 pt-3 border-t border-border flex flex-wrap gap-2 items-center justify-between">
        <span class="text-sm text-muted-foreground">{{ t('salesOrderDesc.fields.lineSubtotalAmount') }}</span>
        <AmountDisplay :value="detail.amounts.lineSubtotalAmount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto" />
      </div>
    </section>
    <section :aria-label="t('salesOrderDesc.sections.sales')" class="pt-5 border-t border-border">
      <h3 class="qs-type-section-title m-0 mb-3">
        {{ t('salesOrderDesc.sections.sales') }}
      </h3>
      <dl class="m-0 gap-3 grid grid-cols-1 sm:grid-cols-2">
        <div v-for="(amount, index) in amountItems" :key="amount.label" class="p-3 border border-border rounded-xl min-w-0" :class="index === 0 ? 'sm:col-span-2 bg-primary/5 border-primary/25' : ''">
          <dt class="text-sm text-muted-foreground">
            {{ t(`salesOrderDesc.fields.${amount.label}`) }}
          </dt>
          <dd class="m-0 mt-2 overflow-x-auto">
            <AmountDisplay :value="amount.value" :currency="detail.currencyCode" :currencies="currencies" :class="index === 0 ? '!text-xl' : '!text-sm'" />
          </dd>
        </div>
      </dl>
    </section>
    <OrderRecords :detail="detail" :currencies="currencies" />
  </div>
</template>
