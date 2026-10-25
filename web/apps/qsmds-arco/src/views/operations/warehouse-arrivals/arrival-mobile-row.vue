<script setup lang="ts">
import type { WarehouseArrivalView } from './logic'
import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { formatDestinationWarehouse, shipmentStatusClass } from '../../workbenches/shipments/logic'
import { getShipmentSourceEmptyKey } from '../../workbenches/shipments/shipment-detail.logic'
import ShipmentProducts from '../../workbenches/shipments/shipment-products.vue'

defineProps<{ row: PurchaseShipmentListItemDto, view: WarehouseArrivalView }>()
const { t } = useI18n()
</script>

<template>
  <div class="min-w-0 space-y-3">
    <div class="flex gap-2 items-start justify-between">
      <div class="qs-type-data-emphasis flex gap-2 min-w-0 items-start">
        <QsCopyableText v-if="row.shipmentNo" :text="row.shipmentNo" :label="t('purchaseShipments.shipmentNo')" />
        <strong v-else class="min-w-0 [overflow-wrap:anywhere]">{{ t('purchaseShipments.unnumbered') }}</strong>
      </div>
      <FaTag variant="outline" class="qs-type-status-tag shrink-0" :class="shipmentStatusClass(view)">
        {{ t(`warehouseArrivals.${view}`) }}
      </FaTag>
    </div>
    <div>
      <p class="qs-type-meta text-muted-foreground m-0 mb-1">
        {{ t('purchaseShipments.mark') }}
      </p>
      <div class="flex gap-2 items-start">
        <span class="qs-type-data min-w-0 [overflow-wrap:anywhere]">{{ row.shippingMarkText || t('purchaseShipments.missingMark') }}</span>
        <CopyCellButton v-if="row.shippingMarkText" always-visible :text="row.shippingMarkText" :label="t('purchaseShipments.mark')" />
      </div>
    </div>
    <p class="qs-type-meta m-0 [overflow-wrap:anywhere]">
      <span class="text-muted-foreground">{{ t('purchaseShipments.destinationWarehouse') }}：</span>{{ formatDestinationWarehouse(row, t) }}
    </p>
    <div class="space-y-1.5">
      <ShipmentProducts :summary="row.lineSummary" />
      <span class="qs-type-meta text-muted-foreground">{{ t('purchaseShipments.quantitySummary', { count: row.lineSummary.lineCount, quantity: row.lineSummary.totalQuantity }) }}</span>
    </div>
    <div v-if="row.salesSource" class="space-y-1">
      <p class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
        {{ row.salesSource.customerName }}
      </p>
      <p class="qs-type-data text-muted-foreground m-0 [overflow-wrap:anywhere]">
        {{ row.salesSource.orderNo }}
      </p>
    </div>
    <p v-else class="qs-type-meta text-muted-foreground m-0">
      {{ t(getShipmentSourceEmptyKey(row.purchaseOrder.purchaseType)) }}
    </p>
    <div>
      <p class="qs-type-meta text-muted-foreground m-0 mb-1">
        {{ t('factoryShipment.tracking.label') }}
      </p>
      <div class="flex gap-2 items-start">
        <span class="qs-type-data min-w-0 [overflow-wrap:anywhere]">{{ row.trackingNo || t('factoryShipment.tracking.empty') }}</span>
        <CopyCellButton v-if="row.trackingNo" always-visible :text="row.trackingNo" :label="t('factoryShipment.tracking.label')" />
      </div>
    </div>
    <div class="flex flex-wrap gap-x-2 gap-y-1 items-center">
      <span class="qs-type-meta text-muted-foreground">{{ t(view === 'SHIPPED' ? 'warehouseArrivals.shippedAt' : 'warehouseArrivals.receivedAt') }}</span>
      <DateTimeDisplay :value="view === 'SHIPPED' ? row.shippedAt : row.warehouseReceivedAt" />
    </div>
    <div v-if="view === 'WAREHOUSE_RECEIVED'" class="flex gap-2 items-center">
      <span class="qs-type-meta text-muted-foreground">{{ t('warehouseArrivals.receivedBy') }}</span>
      <QsPersonDisplay v-if="row.warehouseReceivedBy" :display-name="row.warehouseReceivedBy.displayName" size="md" :avatar-url="row.warehouseReceivedBy.avatarUrl" /><span v-else>—</span>
    </div>
  </div>
</template>
