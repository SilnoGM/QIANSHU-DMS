<script setup lang="ts">
import type {
  QsSalesOrderDescDocumentViewModel,
  QsSalesOrderDescLineType,
  QsSalesOrderDescProps,
} from './types'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'

defineOptions({ name: 'QsSalesOrderDesc' })

const props = defineProps<QsSalesOrderDescProps>()

defineSlots<{
  actions?: () => unknown
}>()

const { t } = useI18n()
const model = computed(() => props.model)
const currencies = computed(() => props.currencies)
const componentId = useId()
const titleId = `${componentId}-title`
const sectionIds = Object.freeze({
  basic: `${componentId}-basic`,
  customer: `${componentId}-customer`,
  documents: `${componentId}-documents`,
  lines: `${componentId}-lines`,
  sales: `${componentId}-sales`,
})

function displayText(value: null | string): string {
  return value?.trim() || t('salesOrderDesc.empty.text')
}

function displayRegion(regionNames: readonly string[]): string {
  const visibleNames = regionNames
    .map(name => name.trim())
    .filter(Boolean)
  return visibleNames.length > 0
    ? visibleNames.join(' / ')
    : t('salesOrderDesc.empty.region')
}

function lineTypeLabel(lineType: QsSalesOrderDescLineType): string {
  return t(`salesOrderDesc.lineTypes.${lineType}`)
}

function documentTypeLabel(
  document: QsSalesOrderDescDocumentViewModel,
): string {
  return t(`salesOrderDesc.documentTypes.${document.documentType}`)
}

function documentDisplayTitle(
  document: QsSalesOrderDescDocumentViewModel,
): string {
  return document.title?.trim()
    || document.originalFilename.trim()
    || t('salesOrderDesc.empty.text')
}

function documentIcon(
  document: QsSalesOrderDescDocumentViewModel,
): string {
  if (document.mediaType === 'VIDEO') {
    return 'i-lucide:video'
  }
  if (document.mediaType === 'IMAGE') {
    return 'i-lucide:image-off'
  }
  return 'i-lucide:file-text'
}

function documentImageItems(
  document: QsSalesOrderDescDocumentViewModel,
): readonly ImageGroupItem[] {
  const thumbnailSrc = document.thumbnailSrc?.trim()
  if (document.mediaType !== 'IMAGE' || !thumbnailSrc) {
    return []
  }

  const item: ImageGroupItem = {
    alt: documentDisplayTitle(document),
    key: document.key,
    src: thumbnailSrc,
    tooltip: documentDisplayTitle(document),
  }
  const previewSrc = document.previewSrc?.trim()
  if (previewSrc) {
    item.previewSrc = previewSrc
  }
  return [item]
}
</script>

<template>
  <article
    data-slot="qs-sales-order-desc"
    :aria-labelledby="titleId"
    class="text-foreground p-4 border border-border rounded-2xl bg-background min-w-0 w-full shadow-sm sm:p-6"
  >
    <header class="pb-4 border-b border-border/70">
      <h2 :id="titleId" class="qs-type-page-title m-0">
        {{ t('salesOrderDesc.title') }}
      </h2>
      <p class="qs-type-body text-muted-foreground m-0 mt-1.5">
        {{ t('salesOrderDesc.description') }}
      </p>
    </header>

    <section
      data-slot="sales-order-desc-basic"
      :aria-labelledby="sectionIds.basic"
      class="pt-4"
    >
      <div class="mb-3 flex gap-2.5 items-center">
        <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
        <h3 :id="sectionIds.basic" class="qs-type-section-title m-0">
          {{ t('salesOrderDesc.sections.basic') }}
        </h3>
      </div>
      <dl class="m-0 gap-x-3 gap-y-2.5 grid grid-cols-[5rem_minmax(0,1fr)] sm:grid-cols-[5.75rem_minmax(0,1fr)]">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('salesOrderDesc.fields.orderNo') }}
        </dt>
        <dd class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
          {{ model.orderNo?.trim() || t('salesOrderDesc.empty.orderNo') }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('salesOrderDesc.fields.orderDate') }}
        </dt>
        <dd class="qs-type-body-medium m-0 break-words">
          {{ displayText(model.orderDate) }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('salesOrderDesc.fields.issuer') }}
        </dt>
        <dd class="qs-type-body-medium m-0 break-words">
          {{ displayText(model.issuerName) }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('salesOrderDesc.fields.currency') }}
        </dt>
        <dd class="qs-type-data-emphasis m-0 break-words">
          {{ displayText(model.currencyCode) }}
        </dd>
      </dl>
    </section>

    <section
      data-slot="sales-order-desc-customer"
      :aria-labelledby="sectionIds.customer"
      class="mt-4 pt-4 border-t border-border/70"
    >
      <div class="mb-3 flex gap-2.5 items-center">
        <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
        <h3 :id="sectionIds.customer" class="qs-type-section-title m-0">
          {{ t('salesOrderDesc.sections.customer') }}
        </h3>
      </div>
      <dl class="m-0 gap-x-3 gap-y-2.5 grid grid-cols-[5rem_minmax(0,1fr)] sm:grid-cols-[5.75rem_minmax(0,1fr)]">
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('salesOrderDesc.fields.customerName') }}
        </dt>
        <dd class="qs-type-body-medium m-0 break-words">
          {{ displayText(model.customer.name) }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('salesOrderDesc.fields.customerPhone') }}
        </dt>
        <dd class="qs-type-data-emphasis m-0 break-all">
          {{ displayText(model.customer.phone) }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('salesOrderDesc.fields.region') }}
        </dt>
        <dd class="qs-type-body-medium m-0 break-words">
          {{ displayRegion(model.customer.regionNames) }}
        </dd>
        <dt class="qs-type-compact-label text-muted-foreground">
          {{ t('salesOrderDesc.fields.fullAddress') }}
        </dt>
        <dd class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
          {{ displayText(model.customer.fullAddress) }}
        </dd>
      </dl>
    </section>

    <section
      data-slot="sales-order-desc-lines"
      :aria-labelledby="sectionIds.lines"
      class="mt-4 pt-4 border-t border-border/70"
    >
      <div class="mb-3 flex gap-2.5 items-center">
        <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
        <h3 :id="sectionIds.lines" class="qs-type-section-title m-0">
          {{ t('salesOrderDesc.sections.lines', { count: model.lines.length }) }}
        </h3>
      </div>

      <FaEmpty
        v-if="model.lines.length === 0"
        icon="i-lucide:package-open"
        :title="t('salesOrderDesc.empty.lines')"
        class="py-4"
      />
      <ol v-else class="m-0 p-0 list-none gap-2.5 grid">
        <li
          v-for="(line, index) in model.lines"
          :key="line.key"
          data-slot="sales-order-desc-line"
          class="p-3 border border-border rounded-xl bg-muted/15 min-w-0"
        >
          <p class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
            <span class="text-muted-foreground">
              {{ line.productNo?.trim() || lineTypeLabel(line.lineType) }} ·
            </span>
            {{ displayText(line.productName) }}
          </p>

          <dl class="m-0 mt-2 gap-x-4 gap-y-1 grid grid-cols-[minmax(0,1fr)_auto] items-end">
            <div class="min-w-0">
              <dt class="sr-only">
                {{ t('salesOrderDesc.fields.actualUnitPrice') }}
              </dt>
              <dd class="qs-type-meta text-muted-foreground m-0 flex flex-wrap gap-x-1 items-baseline">
                <span>{{ t('salesOrderDesc.fields.actualUnitPrice') }}</span>
                <AmountDisplay
                  :value="line.actualUnitPriceAmount"
                  :currency="model.currencyCode"
                  :currencies="currencies"
                  class="!text-xs !leading-4"
                />
                <span>× {{ line.quantity?.trim() || t('salesOrderDesc.empty.text') }}</span>
              </dd>
            </div>
            <div class="text-right min-w-0">
              <dt class="qs-type-compact-label text-muted-foreground">
                {{ t('salesOrderDesc.fields.lineSubtotal') }}
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
            {{ t('salesOrderDesc.fields.lineIndex', { index: index + 1 }) }}
          </span>
        </li>
      </ol>

      <div class="mt-3 pt-3 border-t border-border flex gap-4 items-baseline justify-between">
        <span class="qs-type-compact-label text-muted-foreground">
          {{ t('salesOrderDesc.fields.lineSubtotalAmount') }}
        </span>
        <AmountDisplay
          :value="model.amounts.lineSubtotalAmount"
          :currency="model.currencyCode"
          :currencies="currencies"
        />
      </div>
    </section>

    <section
      data-slot="sales-order-desc-sales"
      :aria-labelledby="sectionIds.sales"
      class="mt-4 pt-4 border-t border-border/70"
    >
      <div class="mb-3 flex gap-2.5 items-center">
        <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
        <h3 :id="sectionIds.sales" class="qs-type-section-title m-0">
          {{ t('salesOrderDesc.sections.sales') }}
        </h3>
      </div>

      <dl class="m-0 gap-3 grid grid-cols-2">
        <div
          data-slot="sales-order-desc-total"
          class="p-4 border border-primary/30 rounded-xl bg-primary/8 col-span-2"
        >
          <dt class="qs-type-compact-label text-primary">
            {{ t('salesOrderDesc.fields.salesTotal') }}
          </dt>
          <dd class="text-primary m-0 mt-1 overflow-x-auto">
            <AmountDisplay
              :value="model.amounts.agreedTotalAmount"
              :currency="model.currencyCode"
              :currencies="currencies"
              class="!text-2xl !leading-8"
            />
          </dd>
        </div>
        <div
          data-slot="sales-order-desc-deposit"
          class="p-3 border border-border rounded-xl bg-muted/20 min-w-0"
        >
          <dt class="qs-type-compact-label text-muted-foreground">
            {{ t('salesOrderDesc.fields.deposit') }}
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
        <div
          data-slot="sales-order-desc-balance"
          class="p-3 border border-border rounded-xl bg-muted/20 min-w-0"
        >
          <dt class="qs-type-compact-label text-muted-foreground">
            {{ t('salesOrderDesc.fields.balance') }}
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
      </dl>
    </section>

    <section
      data-slot="sales-order-desc-documents"
      :aria-labelledby="sectionIds.documents"
      class="mt-4 pt-4 border-t border-border/70"
    >
      <div class="mb-3 flex gap-2.5 items-center">
        <span class="rounded-full bg-primary h-4.5 w-1" aria-hidden="true" />
        <h3 :id="sectionIds.documents" class="qs-type-section-title m-0">
          {{ t('salesOrderDesc.sections.documents', { count: model.documents.length }) }}
        </h3>
      </div>

      <FaEmpty
        v-if="model.documents.length === 0"
        icon="i-lucide:paperclip"
        :title="t('salesOrderDesc.empty.documents')"
        class="py-4"
      />
      <ul v-else class="m-0 p-0 list-none gap-2.5 grid sm:grid-cols-2">
        <li
          v-for="document in model.documents"
          :key="document.key"
          class="p-2.5 border border-border rounded-xl bg-muted/15 flex gap-3 min-w-0 items-center"
        >
          <ImageGroup
            v-if="documentImageItems(document).length > 0"
            :items="documentImageItems(document)"
            :max-count="2"
            :size="56"
            :tooltip="true"
            radius="lg"
            class="shrink-0"
          />
          <span
            v-else
            class="text-muted-foreground border border-border rounded-lg bg-muted/50 flex-center shrink-0 size-14"
          >
            <FaIcon :name="documentIcon(document)" class="size-5" aria-hidden="true" />
          </span>

          <div class="min-w-0">
            <FaTag variant="outline" class="qs-type-status-tag mb-1">
              {{ documentTypeLabel(document) }}
            </FaTag>
            <p class="qs-type-body-medium m-0 [overflow-wrap:anywhere] line-clamp-2" :title="documentDisplayTitle(document)">
              {{ documentDisplayTitle(document) }}
            </p>
            <p
              v-if="document.originalFilename.trim() && documentDisplayTitle(document) !== document.originalFilename.trim()"
              class="qs-type-meta text-muted-foreground m-0 mt-0.5 [overflow-wrap:anywhere]"
            >
              {{ document.originalFilename }}
            </p>
          </div>
        </li>
      </ul>
    </section>

    <footer
      v-if="$slots.actions"
      data-slot="sales-order-desc-actions"
      class="mt-4 pt-4 border-t border-border/70"
    >
      <slot name="actions" />
    </footer>
  </article>
</template>
