<script setup lang="ts">
import type {
  QsPurchaseOrderDescLineType,
  QsPurchaseOrderDescLineViewModel,
  QsPurchaseOrderDescProps,
  QsPurchaseOrderDescStatusTone,
} from './types'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'

defineOptions({ name: 'QsPurchaseOrderDesc' })

const props = defineProps<QsPurchaseOrderDescProps>()

defineSlots<{
  'actions'?: () => unknown
  'shipping-mark'?: () => unknown
}>()

const { t } = useI18n()
const model = computed(() => props.model)
const currencies = computed(() => props.currencies)
const componentId = useId()
const titleId = `${componentId}-title`
const sectionIds = Object.freeze({
  basic: `${componentId}-basic`,
  lines: `${componentId}-lines`,
  notes: `${componentId}-notes`,
  purchase: `${componentId}-purchase`,
  source: `${componentId}-source`,
})
const hasPaymentProgress = computed(() => (
  model.value.amounts.paidAmount !== null
  || model.value.amounts.outstandingAmount !== null
))

function displayText(value: null | string): string {
  return value?.trim() || t('purchaseOrderDesc.empty.text')
}

function lineTypeLabel(lineType: QsPurchaseOrderDescLineType): string {
  return t(`purchaseOrderDesc.lineTypes.${lineType}`)
}

function statusToneClass(tone: QsPurchaseOrderDescStatusTone): string {
  return {
    danger: 'border-destructive/35 bg-destructive/10 text-destructive',
    info: 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    neutral: 'border-border bg-muted/60 text-muted-foreground',
    success: 'border-primary/35 bg-primary/10 text-primary',
    warning: 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  }[tone]
}

function lineImageItems(
  line: QsPurchaseOrderDescLineViewModel,
): readonly ImageGroupItem[] {
  const source = line.mainImage?.src.trim()
  if (!source) {
    return []
  }
  return [{
    alt: line.mainImage?.alt.trim() || displayText(line.productName),
    key: `${line.key}-main-image`,
    previewSrc: source,
    src: source,
    tooltip: line.mainImage?.alt.trim() || displayText(line.productName),
  }]
}
</script>

<template>
  <article
    data-slot="qs-purchase-order-desc"
    :aria-labelledby="titleId"
    class="text-foreground p-4 border border-border rounded-xl bg-background min-w-0 w-full shadow-sm sm:p-6"
  >
    <header class="pb-4 border-b border-border/70">
      <h2 :id="titleId" class="qs-type-page-title m-0">
        {{ t('purchaseOrderDesc.title') }}
      </h2>
      <p class="qs-type-body text-muted-foreground m-0 mt-1.5">
        {{ t('purchaseOrderDesc.description') }}
      </p>
    </header>

    <section
      data-slot="purchase-order-desc-basic"
      :aria-labelledby="sectionIds.basic"
      class="pt-4"
    >
      <div class="mb-3 flex flex-wrap gap-2.5 items-center justify-between">
        <div class="flex gap-2.5 items-center">
          <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
          <h3 :id="sectionIds.basic" class="qs-type-section-title m-0">
            {{ t('purchaseOrderDesc.sections.basic') }}
          </h3>
        </div>
        <div v-if="model.statuses.length > 0" class="flex flex-wrap gap-2">
          <FaTag
            v-for="status in model.statuses"
            :key="status.key"
            variant="outline"
            :class="statusToneClass(status.tone)"
            :aria-label="`${status.label}：${status.value}`"
          >
            {{ status.value }}
          </FaTag>
        </div>
      </div>
      <dl class="m-0 gap-x-3 gap-y-2.5 grid grid-cols-[5rem_minmax(0,1fr)] sm:grid-cols-[5.75rem_minmax(0,1fr)]">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('purchaseOrderDesc.fields.orderNo') }}
        </dt>
        <dd class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
          {{ model.orderNo?.trim() || t('purchaseOrderDesc.empty.orderNo') }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('purchaseOrderDesc.fields.orderDate') }}
        </dt>
        <dd class="qs-type-body-medium m-0 break-words">
          {{ displayText(model.orderDate) }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('purchaseOrderDesc.fields.purchaseType') }}
        </dt>
        <dd class="qs-type-body-medium m-0 break-words">
          {{ displayText(model.purchaseTypeLabel) }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('purchaseOrderDesc.fields.issuer') }}
        </dt>
        <dd class="qs-type-body-medium m-0 break-words">
          {{ displayText(model.issuerName) }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('purchaseOrderDesc.fields.currency') }}
        </dt>
        <dd class="qs-type-data-emphasis m-0 break-words">
          {{ displayText(model.currencyCode) }}
        </dd>
        <template v-if="model.createdAt !== null || model.updatedAt !== null">
          <dt class="qs-type-compact-label text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.createdAt') }}
          </dt>
          <dd class="qs-type-body-medium m-0 break-words">
            <DateTimeDisplay :value="model.createdAt" />
          </dd>
          <dt class="qs-type-compact-label text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.updatedAt') }}
          </dt>
          <dd class="qs-type-body-medium m-0 break-words">
            <DateTimeDisplay :value="model.updatedAt" />
          </dd>
        </template>
      </dl>
    </section>

    <section
      data-slot="purchase-order-desc-source"
      :aria-labelledby="sectionIds.source"
      class="mt-4 pt-4 border-t border-border/70"
    >
      <div class="mb-3 flex gap-2.5 items-center">
        <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
        <h3 :id="sectionIds.source" class="qs-type-section-title m-0">
          {{ t('purchaseOrderDesc.sections.source') }}
        </h3>
      </div>
      <dl class="m-0 gap-x-3 gap-y-2.5 grid grid-cols-[5rem_minmax(0,1fr)] sm:grid-cols-[5.75rem_minmax(0,1fr)]">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('purchaseOrderDesc.fields.supplier') }}
        </dt>
        <dd class="qs-type-body-medium m-0 break-words">
          {{ displayText(model.supplierLabel) }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('purchaseOrderDesc.fields.salesOrderNo') }}
        </dt>
        <dd class="qs-type-data-emphasis m-0 [overflow-wrap:anywhere]">
          {{ model.source.salesOrderNo?.trim() || t('purchaseOrderDesc.empty.independentStock') }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('purchaseOrderDesc.fields.customerName') }}
        </dt>
        <dd class="qs-type-body-medium m-0 break-words">
          {{ model.source.customerName?.trim() || t('purchaseOrderDesc.empty.unlinkedCustomer') }}
        </dd>
      </dl>
    </section>

    <section
      data-slot="purchase-order-desc-lines"
      :aria-labelledby="sectionIds.lines"
      class="mt-4 pt-4 border-t border-border/70 min-w-0"
    >
      <div class="mb-3 flex gap-2.5 items-center">
        <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
        <h3 :id="sectionIds.lines" class="qs-type-section-title m-0">
          {{ t('purchaseOrderDesc.sections.lines', { count: model.lines.length }) }}
        </h3>
      </div>

      <FaEmpty
        v-if="model.lines.length === 0"
        icon="i-lucide:package-open"
        :title="t('purchaseOrderDesc.empty.lines')"
        class="py-4"
      />
      <ol v-else class="m-0 p-0 list-none gap-2.5 grid">
        <li
          v-for="(line, index) in model.lines"
          :key="line.key"
          data-slot="purchase-order-desc-line"
          class="p-3 border border-border rounded-xl bg-muted/15 min-w-0"
        >
          <div class="flex gap-3 min-w-0 items-start">
            <ImageGroup
              v-if="lineImageItems(line).length > 0"
              :items="lineImageItems(line)"
              :max-count="1"
              :size="56"
              :tooltip="true"
              radius="lg"
              class="shrink-0"
            />
            <span
              v-else
              class="text-muted-foreground border border-border rounded-lg bg-muted/50 flex-center shrink-0 size-14"
            >
              <FaIcon name="i-lucide:image-off" class="size-5" aria-hidden="true" />
            </span>

            <div class="flex-1 min-w-0">
              <p class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
                <span class="text-muted-foreground">
                  {{ line.productNo?.trim() || lineTypeLabel(line.lineType) }} ·
                </span>
                {{ displayText(line.productName) }}
              </p>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1 flex flex-wrap gap-x-1 [overflow-wrap:anywhere]">
                <span class="text-foreground/80 font-medium">
                  {{ t('purchaseOrderDesc.fields.lineRemark') }}
                </span>
                <span>{{ displayText(line.description) }}</span>
              </p>
            </div>
          </div>

          <dl class="m-0 mt-3 gap-x-4 gap-y-1 grid grid-cols-[minmax(0,1fr)_auto] items-end">
            <div class="min-w-0">
              <dt class="sr-only">
                {{ t('purchaseOrderDesc.fields.actualPurchaseUnitPrice') }}
              </dt>
              <dd class="qs-type-meta text-muted-foreground m-0 flex flex-wrap gap-x-1 items-baseline">
                <span>{{ t('purchaseOrderDesc.fields.actualPurchaseUnitPrice') }}</span>
                <AmountDisplay
                  :value="line.actualPurchaseUnitPriceAmount"
                  :currency="model.currencyCode"
                  :currencies="currencies"
                  class="!text-xs !leading-4"
                />
                <span>× {{ line.quantity?.trim() || t('purchaseOrderDesc.empty.text') }}</span>
              </dd>
            </div>
            <div class="text-right min-w-0">
              <dt class="qs-type-compact-label text-muted-foreground">
                {{ t('purchaseOrderDesc.fields.lineSubtotal') }}
              </dt>
              <dd class="m-0 mt-0.5 overflow-x-auto">
                <AmountDisplay
                  :value="line.lineSubtotalAmount"
                  :currency="model.currencyCode"
                  :currencies="currencies"
                />
              </dd>
            </div>
          </dl>
          <span class="sr-only">
            {{ t('purchaseOrderDesc.fields.lineIndex', { index: index + 1 }) }}
          </span>
        </li>
      </ol>

      <div class="mt-3 pt-3 border-t border-border flex gap-4 items-baseline justify-between">
        <span class="qs-type-compact-label text-muted-foreground">
          {{ t('purchaseOrderDesc.fields.lineSubtotalAmount') }}
        </span>
        <AmountDisplay
          :value="model.amounts.lineSubtotalAmount"
          :currency="model.currencyCode"
          :currencies="currencies"
        />
      </div>
    </section>

    <section
      data-slot="purchase-order-desc-purchase"
      :aria-labelledby="sectionIds.purchase"
      class="mt-4 pt-4 border-t border-border/70"
    >
      <div class="mb-3 flex gap-2.5 items-center">
        <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
        <h3 :id="sectionIds.purchase" class="qs-type-section-title m-0">
          {{ t('purchaseOrderDesc.sections.purchase') }}
        </h3>
      </div>

      <dl class="m-0 gap-3 grid grid-cols-2">
        <div
          data-slot="purchase-order-desc-total"
          class="p-4 border border-primary/30 rounded-xl bg-primary/8 col-span-2"
        >
          <dt class="qs-type-compact-label text-primary">
            {{ t('purchaseOrderDesc.fields.purchaseTotal') }}
          </dt>
          <dd class="text-primary m-0 mt-1 overflow-x-auto">
            <AmountDisplay
              :value="model.amounts.purchaseTotalAmount"
              :currency="model.currencyCode"
              :currencies="currencies"
              class="!text-2xl !leading-8"
            />
          </dd>
        </div>
        <div data-slot="purchase-order-desc-deposit" class="p-3 border border-border rounded-xl bg-muted/20 min-w-0">
          <dt class="qs-type-compact-label text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.deposit') }}
          </dt>
          <dd class="m-0 mt-1 overflow-x-auto">
            <AmountDisplay
              :value="model.amounts.depositDueAmount"
              :currency="model.currencyCode"
              :currencies="currencies"
              class="!text-xs sm:!text-base"
            />
          </dd>
        </div>
        <div data-slot="purchase-order-desc-balance" class="p-3 border border-border rounded-xl bg-muted/20 min-w-0">
          <dt class="qs-type-compact-label text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.balance') }}
          </dt>
          <dd class="m-0 mt-1 overflow-x-auto">
            <AmountDisplay
              :value="model.amounts.balanceDueAmount"
              :currency="model.currencyCode"
              :currencies="currencies"
              class="!text-xs sm:!text-base"
            />
          </dd>
        </div>
        <template v-if="hasPaymentProgress">
          <div data-slot="purchase-order-desc-paid" class="p-3 border border-border rounded-xl min-w-0">
            <dt class="qs-type-compact-label text-muted-foreground">
              {{ t('purchaseOrderDesc.fields.paid') }}
            </dt>
            <dd class="m-0 mt-1 overflow-x-auto">
              <AmountDisplay :value="model.amounts.paidAmount" :currency="model.currencyCode" :currencies="currencies" />
            </dd>
          </div>
          <div data-slot="purchase-order-desc-outstanding" class="p-3 border border-border rounded-xl min-w-0">
            <dt class="qs-type-compact-label text-muted-foreground">
              {{ t('purchaseOrderDesc.fields.outstanding') }}
            </dt>
            <dd class="m-0 mt-1 overflow-x-auto">
              <AmountDisplay :value="model.amounts.outstandingAmount" :currency="model.currencyCode" :currencies="currencies" />
            </dd>
          </div>
        </template>
      </dl>
    </section>

    <section
      data-slot="purchase-order-desc-notes"
      :aria-labelledby="sectionIds.notes"
      class="mt-4 pt-4 border-t border-border/70"
    >
      <div class="mb-3 flex gap-2.5 items-center">
        <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
        <h3 :id="sectionIds.notes" class="qs-type-section-title m-0">
          {{ t('purchaseOrderDesc.sections.notes') }}
        </h3>
      </div>
      <dl class="m-0 gap-3 grid grid-cols-1 sm:grid-cols-2">
        <div class="p-3 border border-border rounded-xl bg-muted/15 min-w-0">
          <dt class="qs-type-compact-label text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.shippingMark') }}
          </dt>
          <dd class="qs-type-body m-0 mt-2 min-w-0">
            <slot name="shipping-mark">
              <span class="whitespace-pre-wrap [overflow-wrap:anywhere]">{{ displayText(model.shippingMarkText) }}</span>
            </slot>
          </dd>
        </div>
        <div class="p-3 border border-border rounded-xl bg-muted/15 min-w-0">
          <dt class="qs-type-compact-label text-muted-foreground">
            {{ t('purchaseOrderDesc.fields.remark') }}
          </dt>
          <dd class="qs-type-body m-0 mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {{ displayText(model.remark) }}
          </dd>
        </div>
      </dl>
    </section>

    <footer
      v-if="$slots.actions"
      data-slot="purchase-order-desc-actions"
      class="mt-4 pt-4 border-t border-border/70"
    >
      <slot name="actions" />
    </footer>
  </article>
</template>
