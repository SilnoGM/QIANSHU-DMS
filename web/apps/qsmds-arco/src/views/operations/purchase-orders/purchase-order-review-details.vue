<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { getPurchaseProductImages } from '@/components/business/QsPurchaseOrderDrawer/logic'

const props = defineProps<{
  detail: PurchaseOrderDetailDto
  currencies: readonly CurrencyDescriptor[]
}>()

const { t } = useI18n()
const imagesByLine = computed(() => getPurchaseProductImages(props.detail))
const salesOrderNo = computed(() => props.detail.sourceSalesOrder?.orderNo || props.detail.salesOrderNo)
const customerName = computed(() => props.detail.sourceSalesOrder?.customerName || props.detail.customerName)
const amounts = computed(() => [
  { label: 'amount', value: props.detail.amounts.purchaseTotalAmount },
  { label: 'deposit', value: props.detail.amounts.depositDueAmount },
  { label: 'balance', value: props.detail.amounts.balanceDueAmount },
])
</script>

<template>
  <div class="flex flex-col gap-5 min-w-0">
    <FaCard
      data-slot="purchase-review-details"
      :title="t('purchaseReview.detail.title')"
      class="py-0 border-border/70 rounded-xl bg-muted/15 gap-0 shadow-none"
      header-class="p-4 pb-3"
      content-class="p-4 pt-0"
    >
      <dl class="qs-type-body m-0 gap-x-6 gap-y-4 grid grid-cols-1 sm:grid-cols-3">
        <div class="min-w-0">
          <dt class="qs-type-meta">
            {{ t('purchaseReview.orderNo') }}
          </dt>
          <dd class="qs-type-data m-0 mt-1 [overflow-wrap:anywhere]">
            {{ detail.orderNo }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta">
            {{ t('purchaseReview.detail.purchaseType') }}
          </dt>
          <dd class="m-0 mt-1">
            {{ t(`purchaseOrderDrawer.purchaseTypes.${detail.purchaseType}`) }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta">
            {{ t('purchaseReview.supplier') }}
          </dt>
          <dd class="qs-type-body-medium m-0 mt-1 [overflow-wrap:anywhere]">
            {{ detail.supplier.label }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta">
            {{ t('purchaseReview.buyer') }}
          </dt>
          <dd class="m-0 mt-1 min-w-0">
            <QsPersonDisplay :display-name="detail.createdBy.displayName" size="sm" />
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta">
            {{ t('purchaseReview.source') }}
          </dt>
          <dd class="m-0 mt-1 flex gap-2 min-w-0 items-start">
            <span class="min-w-0 [overflow-wrap:anywhere]" :class="salesOrderNo ? 'qs-type-data' : ''">{{ salesOrderNo || t('purchaseReview.stock') }}</span>
            <CopyCellButton v-if="salesOrderNo" always-visible :text="salesOrderNo" :label="t('purchaseReview.source')" />
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta">
            {{ t('purchaseReview.detail.customer') }}
          </dt>
          <dd class="m-0 mt-1 [overflow-wrap:anywhere]">
            {{ customerName || t('purchaseReview.detail.noCustomer') }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta">
            {{ t('purchaseReview.detail.orderDate') }}
          </dt>
          <dd class="qs-type-data m-0 mt-1">
            {{ detail.orderDate }}
          </dd>
        </div>
        <div class="min-w-0 sm:col-span-2">
          <dt class="qs-type-meta">
            {{ t('purchaseReview.detail.remark') }}
          </dt>
          <dd class="m-0 mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {{ detail.remark?.trim() || t('purchaseReview.detail.noRemark') }}
          </dd>
        </div>
      </dl>
    </FaCard>

    <section data-slot="purchase-review-products" :aria-label="t('purchaseReview.detail.products')" class="min-w-0">
      <div class="mb-3 flex flex-wrap gap-x-3 gap-y-1 items-center justify-between">
        <h3 class="qs-type-component-title m-0 flex gap-2 items-center">
          <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
          {{ t('purchaseReview.detail.products') }}
        </h3>
        <span class="qs-type-meta">{{ t('purchaseReview.lineSummary', { lines: detail.lines.length, quantity: detail.lineSummary.totalQuantity }) }}</span>
      </div>
      <FaCard class="py-0 border-border rounded-xl gap-0 shadow-none overflow-hidden" content-class="p-0">
        <p v-if="!detail.lines.length" class="qs-type-meta m-0 p-4">
          {{ t('purchaseReview.detail.noProducts') }}
        </p>
        <ol v-else class="m-0 p-0 list-none divide-border/70 divide-y">
          <li v-for="line in detail.lines" :key="line.id" class="p-4 min-w-0">
            <div class="flex gap-3 min-w-0 items-start">
              <ImageGroup
                v-if="imagesByLine.get(line.id)"
                :items="[{ src: imagesByLine.get(line.id)!, alt: line.productName, tooltip: line.productName }]"
                :size="56" :max-count="1" fit="contain" class="shrink-0"
              />
              <span v-else role="img" :aria-label="t('purchaseReview.noImage')" class="text-muted-foreground border border-border rounded-lg bg-muted/25 flex shrink-0 size-14 items-center justify-center">
                <FaIcon name="i-lucide:image-off" class="size-5" aria-hidden="true" />
              </span>
              <div class="flex-1 min-w-0">
                <p class="qs-type-meta m-0 [overflow-wrap:anywhere]" :class="line.productNo ? 'font-mono' : ''">
                  {{ line.productNo || t('purchaseOrderDesc.lineTypes.CUSTOM') }}
                </p>
                <p class="qs-type-body-medium m-0 mt-1 [overflow-wrap:anywhere]">
                  {{ line.productName }}
                </p>
                <p class="qs-type-meta m-0 mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {{ t('purchaseReview.detail.lineRemark') }}：{{ line.description?.trim() || t('purchaseReview.detail.noRemark') }}
                </p>
              </div>
            </div>
            <dl class="m-0 mt-3 gap-x-4 gap-y-2 grid grid-cols-1 sm:grid-cols-3">
              <div class="flex flex-wrap gap-x-2 gap-y-1 min-w-0 items-baseline justify-between sm:justify-end">
                <dt class="qs-type-meta">
                  {{ t('purchaseReview.detail.unitPrice') }}
                </dt>
                <dd class="m-0 max-w-full overflow-x-auto">
                  <AmountDisplay :value="line.actualPurchaseUnitPriceAmount" :currency="detail.currencyCode" :currencies="currencies" />
                </dd>
              </div>
              <div class="flex gap-2 min-w-0 items-baseline justify-between sm:justify-end">
                <dt class="qs-type-meta">
                  {{ t('purchaseReview.detail.quantity') }}
                </dt>
                <dd class="qs-type-data m-0">
                  {{ line.quantity }}
                </dd>
              </div>
              <div class="flex flex-wrap gap-x-2 gap-y-1 min-w-0 items-baseline justify-between sm:justify-end">
                <dt class="qs-type-meta">
                  {{ t('purchaseReview.detail.lineTotal') }}
                </dt>
                <dd class="m-0 max-w-full overflow-x-auto">
                  <AmountDisplay :value="line.lineTotalAmount" :currency="detail.currencyCode" :currencies="currencies" class="font-semibold!" />
                </dd>
              </div>
            </dl>
          </li>
        </ol>
        <div class="px-4 py-3 border-t border-border bg-muted/25 flex flex-wrap gap-x-3 gap-y-1 min-w-0 items-baseline justify-between">
          <span class="qs-type-body-medium">{{ t('purchaseReview.detail.lineSubtotal') }}</span>
          <AmountDisplay :value="detail.amounts.lineSubtotalAmount" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto font-semibold!" />
        </div>
      </FaCard>
    </section>

    <section data-slot="purchase-review-amounts" :aria-label="t('purchaseReview.detail.paymentTerms')" class="min-w-0">
      <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
        <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
        {{ t('purchaseReview.detail.paymentTerms') }}
      </h3>
      <dl class="m-0 border border-border rounded-xl grid grid-cols-1 overflow-hidden sm:grid-cols-2">
        <div
          v-for="(amount, index) in amounts" :key="amount.label"
          class="px-4 py-3 flex flex-wrap gap-x-3 gap-y-1 min-w-0 items-baseline justify-between"
          :class="index === 0 ? 'sm:col-span-2 bg-primary/5 border-b border-border' : index === 1 ? 'border-b border-border sm:border-b-0 sm:border-r' : ''"
        >
          <dt class="qs-type-meta">
            {{ t(`purchaseReview.${amount.label}`) }}
          </dt>
          <dd class="m-0 max-w-full overflow-x-auto">
            <AmountDisplay :value="amount.value" :currency="detail.currencyCode" :currencies="currencies" :class="index === 0 ? 'text-xl! font-semibold!' : ''" />
          </dd>
        </div>
      </dl>
    </section>
  </div>
</template>
