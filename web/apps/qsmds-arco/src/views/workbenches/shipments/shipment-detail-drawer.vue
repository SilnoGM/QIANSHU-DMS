<script setup lang="ts">
import type { PurchaseShipmentDetailDto } from '@/api/generated/types.gen'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGoodTooltipContent from '@/components/business/QsGoodTooltip/QsGoodTooltipContent.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { formatShipmentNumber, shipmentStatusClass } from './logic'
import { buildShipmentDetailProducts, getShipmentMarkEmptyKey, getShipmentSourceEmptyKey } from './shipment-detail.logic'

defineOptions({ name: 'PurchaseShipmentDetailDrawer' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  detail: PurchaseShipmentDetailDto | null
  loading?: boolean
  error?: string | null
}>(), { loading: false, error: null })

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'reload': []
  'viewOrder': [orderId: string]
  'closed': []
}>()

const { t } = useI18n()
const products = computed(() => buildShipmentDetailProducts(props.detail?.items ?? []))
const title = computed(() => props.detail
  ? `${formatShipmentNumber(props.detail.partNumber)} · ${t('purchaseShipmentDetail.title')}`
  : t('purchaseShipmentDetail.title'))
const hasShipmentInformation = computed(() => props.detail && (
  props.detail.shippedAt || props.detail.shippedBy || props.detail.shipmentRecordedAt || props.detail.shipmentRemark || props.detail.trackingNo
))
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue"
    :title="title"
    :description="detail?.purchaseOrder.orderNo ?? t('purchaseShipmentDetail.description')"
    :loading="loading"
    :error="error"
    size="xl"
    @update:model-value="emit('update:modelValue', $event)"
    @closed="emit('closed')"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:package-search" class="size-5" aria-hidden="true" />
    </template>
    <template v-if="detail && !loading && !error" #header-extra>
      <FaTag variant="outline" :class="shipmentStatusClass(detail.viewStatus)" class="whitespace-nowrap">
        {{ t(`purchaseShipmentDetail.statuses.${detail.viewStatus}`) }}
      </FaTag>
    </template>
    <template #error-actions>
      <FaButton variant="outline" size="sm" @click="emit('reload')">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
        {{ t('purchaseShipmentDetail.reload') }}
      </FaButton>
    </template>

    <div v-if="detail && !error" class="pb-2 flex flex-col gap-6 min-w-0">
      <section :aria-label="t('purchaseShipmentDetail.shippingMarks')">
        <div class="gap-3 grid sm:grid-cols-2">
          <div
            v-for="mark in [
              { label: 'shippingMark', value: detail.shippingMarkText },
              { label: 'baseShippingMark', value: detail.purchaseOrder.shippingMarkText },
            ]"
            :key="mark.label"
            class="p-4 border border-primary/25 rounded-lg bg-primary/5 min-w-0"
          >
            <h3 class="qs-type-meta text-muted-foreground m-0">
              {{ t(`purchaseShipmentDetail.${mark.label}`) }}
            </h3>
            <div class="mt-2 flex gap-2 items-start justify-between">
              <p class="qs-type-data-emphasis m-0 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]" :class="!mark.value && 'text-muted-foreground'">
                {{ mark.value || t(getShipmentMarkEmptyKey(detail.status)) }}
              </p>
              <CopyCellButton v-if="mark.value" always-visible :text="mark.value" :label="t(`purchaseShipmentDetail.${mark.label}`)" />
            </div>
          </div>
        </div>
      </section>

      <section :aria-label="t('purchaseShipmentDetail.identity')">
        <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
          <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
          {{ t('purchaseShipmentDetail.identity') }}
        </h3>
        <dl class="m-0 p-4 border border-border/70 rounded-lg bg-muted/20 gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <div class="min-w-0 sm:col-span-2">
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.shipmentNo') }}
            </dt>
            <dd class="m-0 flex gap-2 min-w-0 items-start">
              <span class="qs-type-data-emphasis min-w-0 [overflow-wrap:anywhere]" :class="!detail.shipmentNo && 'text-muted-foreground'">{{ detail.shipmentNo || t('purchaseShipmentDetail.unnumbered') }}</span>
              <CopyCellButton v-if="detail.shipmentNo" always-visible :text="detail.shipmentNo" :label="t('purchaseShipmentDetail.shipmentNo')" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.orderNo') }}
            </dt>
            <dd class="m-0 flex gap-2 min-w-0 items-start">
              <span class="qs-type-data min-w-0 [overflow-wrap:anywhere]">{{ detail.purchaseOrder.orderNo }}</span>
              <CopyCellButton always-visible :text="detail.purchaseOrder.orderNo" :label="t('purchaseShipmentDetail.orderNo')" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.supplier') }}
            </dt>
            <dd class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
              {{ detail.supplier.label }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.orderDate') }}
            </dt>
            <dd class="qs-type-data m-0">
              {{ detail.purchaseOrder.orderDate }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.purchaser') }}
            </dt>
            <dd class="m-0">
              <QsPersonDisplay :display-name="detail.purchaseOrder.createdBy.displayName" size="sm" :avatar-url="detail.purchaseOrder.createdBy.avatarUrl" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.purchaseType') }}
            </dt>
            <dd class="m-0">
              {{ t(`purchaseOrderDrawer.purchaseTypes.${detail.purchaseOrder.purchaseType}`) }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.productMode') }}
            </dt>
            <dd class="m-0">
              {{ t(`purchaseOrderDrawer.productModes.${detail.purchaseOrder.productMode}`) }}
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.createdAt') }}
            </dt>
            <dd class="m-0">
              <DateTimeDisplay :value="detail.createdAt" />
            </dd>
          </div>
        </dl>
        <div class="mt-4 px-1">
          <h4 class="qs-type-meta text-muted-foreground m-0 mb-2">
            {{ t('purchaseShipmentDetail.source') }}
          </h4>
          <div v-if="detail.salesSource" class="flex flex-wrap gap-x-4 gap-y-2 items-center">
            <div class="flex gap-2 min-w-0 items-start">
              <span class="qs-type-data min-w-0 [overflow-wrap:anywhere]">{{ detail.salesSource.orderNo }}</span>
              <CopyCellButton always-visible :text="detail.salesSource.orderNo" :label="t('purchaseShipmentDetail.sourceOrderNo')" />
            </div>
            <span class="qs-type-body-medium min-w-0 [overflow-wrap:anywhere]">{{ detail.salesSource.customerName }}</span>
          </div>
          <p v-else class="qs-type-meta text-muted-foreground m-0">
            {{ t(getShipmentSourceEmptyKey(detail.purchaseOrder.purchaseType)) }}
          </p>
        </div>
      </section>

      <section :aria-label="t('purchaseShipmentDetail.products')">
        <header class="mb-3 flex flex-wrap gap-2 items-center justify-between">
          <h3 class="qs-type-component-title m-0 flex gap-2 items-center">
            <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
            {{ t('purchaseShipmentDetail.products') }}
          </h3>
          <span class="qs-type-meta text-muted-foreground">{{ t('purchaseShipmentDetail.productSummary', { lines: detail.lineSummary.lineCount, quantity: detail.lineSummary.totalQuantity }) }}</span>
        </header>
        <FaEmpty v-if="products.length === 0" icon="i-lucide:package-open" :title="t('purchaseShipmentDetail.noProducts')" />
        <ul v-else class="m-0 p-0 list-none flex flex-col gap-3">
          <li v-for="product in products" :key="product.purchaseOrderLineId" class="p-4 border border-border/70 rounded-lg flex gap-3 min-w-0 items-start">
            <ImageGroup v-if="product.images.length" :items="product.images" :size="64" :max-count="1" fit="contain" class="shrink-0">
              <template #tooltip="{ item }">
                <QsGoodTooltipContent :image-src="item.src" :image-alt="product.productName" image-fit="contain">
                  <div class="space-y-1">
                    <p class="font-medium m-0 break-words">
                      {{ product.productName }}
                    </p>
                    <p v-if="product.productNo" class="font-mono m-0 opacity-70 break-all">
                      {{ product.productNo }}
                    </p>
                    <p class="m-0">
                      {{ t('purchaseShipmentDetail.productQuantity') }}：{{ product.quantity }}
                    </p>
                  </div>
                </QsGoodTooltipContent>
              </template>
            </ImageGroup>
            <div v-else role="img" :aria-label="t('purchaseShipmentDetail.noImage')" class="text-muted-foreground border border-border/70 rounded-md bg-muted/30 flex shrink-0 size-16 items-center justify-center">
              <FaIcon name="i-lucide:image-off" class="size-6" aria-hidden="true" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex flex-col gap-2 sm:flex-row sm:gap-4 sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <p class="qs-type-meta text-muted-foreground m-0 [overflow-wrap:anywhere]">
                    {{ product.productNo || t('purchaseShipmentDetail.productNoMissing') }}
                  </p>
                  <h4 class="qs-type-body-medium m-0 mt-1 [overflow-wrap:anywhere]">
                    {{ product.productName }}
                  </h4>
                  <FaTag v-if="product.lineType === 'CUSTOM'" variant="outline" class="text-muted-foreground mt-1">
                    {{ t('purchaseShipmentDetail.customProduct') }}
                  </FaTag>
                </div>
                <div class="shrink-0 sm:text-right">
                  <span class="qs-type-meta text-muted-foreground">{{ t('purchaseShipmentDetail.productQuantity') }}</span>
                  <strong class="qs-type-data-emphasis ml-2 sm:ml-0 sm:block">{{ product.quantity }}</strong>
                </div>
              </div>
              <dl v-if="product.attributes.length" class="qs-type-meta m-0 mt-3 flex flex-wrap gap-x-4 gap-y-1" :aria-label="t('purchaseShipmentDetail.attributes')">
                <div v-for="(attribute, index) in product.attributes" :key="index" class="flex gap-1 min-w-0">
                  <dt class="text-muted-foreground [overflow-wrap:anywhere]">
                    {{ attribute.title }}：
                  </dt>
                  <dd class="m-0 min-w-0 [overflow-wrap:anywhere]">
                    {{ attribute.value }}
                  </dd>
                </div>
              </dl>
              <p v-else class="qs-type-meta text-muted-foreground m-0 mt-3">
                {{ t('purchaseShipmentDetail.attributesMissing') }}
              </p>
              <p v-if="product.description" class="qs-type-meta m-0 mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
                <span class="text-muted-foreground">{{ t('purchaseShipmentDetail.descriptionLabel') }}：</span>{{ product.description }}
              </p>
            </div>
          </li>
        </ul>
      </section>

      <section :aria-label="t('purchaseShipmentDetail.shipment')">
        <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
          <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
          {{ t('purchaseShipmentDetail.shipment') }}
        </h3>
        <dl v-if="hasShipmentInformation" class="m-0 p-4 border border-border/70 rounded-lg bg-muted/20 gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <div class="min-w-0 sm:col-span-2">
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.trackingNo') }}
            </dt>
            <dd class="m-0 flex gap-2 min-w-0 items-start">
              <span class="qs-type-data min-w-0 [overflow-wrap:anywhere]" :class="!detail.trackingNo && 'text-muted-foreground'">{{ detail.trackingNo || t('purchaseShipmentDetail.trackingNoMissing') }}</span>
              <CopyCellButton v-if="detail.trackingNo" always-visible :text="detail.trackingNo" :label="t('purchaseShipmentDetail.trackingNo')" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.shippedAt') }}
            </dt>
            <dd class="m-0">
              <DateTimeDisplay :value="detail.shippedAt" />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.shippedBy') }}
            </dt>
            <dd class="m-0">
              <QsPersonDisplay v-if="detail.shippedBy" :display-name="detail.shippedBy.displayName" size="sm" :avatar-url="detail.shippedBy.avatarUrl" /><span v-else>—</span>
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.shipmentRecordedAt') }}
            </dt>
            <dd class="m-0">
              <DateTimeDisplay :value="detail.shipmentRecordedAt" />
            </dd>
          </div>
          <div v-if="detail.shipmentRemark" class="min-w-0 sm:col-span-2">
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.shipmentRemark') }}
            </dt>
            <dd class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {{ detail.shipmentRemark }}
            </dd>
          </div>
        </dl>
        <div v-else class="qs-type-meta text-muted-foreground px-4 py-5 border border-border/70 rounded-lg bg-muted/20 flex gap-2 items-center">
          <FaIcon name="i-lucide:truck" class="shrink-0 size-4" aria-hidden="true" />
          {{ t('purchaseShipmentDetail.notShipped') }}
        </div>
      </section>
      <section :aria-label="t('purchaseWarehouseReceipt.received')">
        <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
          <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />{{ t('purchaseShipmentDetail.warehouse') }}
        </h3>
        <dl v-if="detail.warehouseReceivedAt" class="m-0 p-4 border border-border/70 rounded-lg bg-muted/20 gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseWarehouseReceipt.receivedAt') }}
            </dt><dd class="m-0">
              <DateTimeDisplay :value="detail.warehouseReceivedAt" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseWarehouseReceipt.operator') }}
            </dt><dd class="m-0">
              <QsPersonDisplay v-if="detail.warehouseReceivedBy" :display-name="detail.warehouseReceivedBy.displayName" size="sm" :avatar-url="detail.warehouseReceivedBy.avatarUrl" /><span v-else>—</span>
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseWarehouseReceipt.recordedAt') }}
            </dt><dd class="m-0">
              <DateTimeDisplay :value="detail.warehouseRecordedAt" />
            </dd>
          </div>
          <div v-if="detail.warehouseRemark" class="min-w-0 sm:col-span-2">
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseWarehouseReceipt.remarkLabel') }}
            </dt><dd class="m-0 whitespace-pre-wrap break-all">
              {{ detail.warehouseRemark }}
            </dd>
          </div>
        </dl>
        <p v-else class="qs-type-meta text-muted-foreground m-0 p-4 border border-border/70 rounded-lg bg-muted/20">
          {{ t('purchaseShipmentDetail.notReceived') }}
        </p>
      </section>
      <section :aria-label="t('purchaseShipmentDetail.containerLoading')">
        <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
          <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />{{ t('purchaseShipmentDetail.containerLoading') }}
        </h3>
        <dl v-if="detail.loadedAt" class="m-0 p-4 border border-border/70 rounded-lg bg-muted/20 gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.loadedAt') }}
            </dt><dd class="m-0">
              <DateTimeDisplay :value="detail.loadedAt" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.loadedBy') }}
            </dt><dd class="m-0">
              <QsPersonDisplay v-if="detail.loadedBy" :display-name="detail.loadedBy.displayName" size="sm" :avatar-url="detail.loadedBy.avatarUrl" /><span v-else>—</span>
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.loadedRecordedAt') }}
            </dt><dd class="m-0">
              <DateTimeDisplay :value="detail.loadedRecordedAt" />
            </dd>
          </div>
        </dl>
        <p v-else class="qs-type-meta text-muted-foreground m-0 p-4 border border-border/70 rounded-lg bg-muted/20">
          {{ t('purchaseShipmentDetail.notLoaded') }}
        </p>
      </section>
      <section :aria-label="t('purchaseShipmentDetail.delivery')">
        <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
          <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />{{ t('purchaseShipmentDetail.delivery') }}
        </h3>
        <dl v-if="detail.deliveredAt" class="m-0 p-4 border border-border/70 rounded-lg bg-muted/20 gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.deliveredAt') }}
            </dt><dd class="m-0">
              <DateTimeDisplay :value="detail.deliveredAt" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.deliveredBy') }}
            </dt><dd class="m-0">
              <QsPersonDisplay v-if="detail.deliveredBy" :display-name="detail.deliveredBy.displayName" size="sm" :avatar-url="detail.deliveredBy.avatarUrl" /><span v-else>—</span>
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.deliveredRecordedAt') }}
            </dt><dd class="m-0">
              <DateTimeDisplay :value="detail.deliveredRecordedAt" />
            </dd>
          </div>
          <div v-if="detail.deliveryRemark" class="min-w-0 sm:col-span-2">
            <dt class="qs-type-meta text-muted-foreground mb-1">
              {{ t('purchaseShipmentDetail.deliveryRemark') }}
            </dt><dd class="m-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {{ detail.deliveryRemark }}
            </dd>
          </div>
        </dl>
        <p v-else class="qs-type-meta text-muted-foreground m-0 p-4 border border-border/70 rounded-lg bg-muted/20">
          {{ t('purchaseShipmentDetail.notDelivered') }}
        </p>
      </section>
    </div>
    <FaEmpty v-else-if="!loading && !error" icon="i-lucide:package-search" :title="t('purchaseShipmentDetail.empty')" :description="t('purchaseShipmentDetail.emptyDescription')" />

    <template #footer>
      <div class="flex gap-2 items-center justify-between">
        <FaButton v-if="detail && !loading && !error" variant="ghost" @click="emit('viewOrder', detail.purchaseOrder.id)">
          <FaIcon name="i-lucide:file-search" class="size-4" aria-hidden="true" />
          {{ t('purchaseShipmentDetail.viewOrder') }}
        </FaButton>
        <FaButton variant="outline" class="ml-auto" @click="emit('update:modelValue', false)">
          {{ t('purchaseShipmentDetail.close') }}
        </FaButton>
      </div>
    </template>
  </QsGenericDrawer>
</template>
