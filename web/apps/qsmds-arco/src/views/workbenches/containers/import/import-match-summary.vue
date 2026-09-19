<script setup lang="ts">
import type { ImportDisplayRow } from './use-container-import'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'

defineProps<{ row: ImportDisplayRow }>()
const { t } = useI18n()
const tones = {
  MATCHED: 'text-primary border-primary/25 bg-primary/5',
  AMBIGUOUS: 'text-amber-700 dark:text-amber-400 border-amber-500/25 bg-amber-500/5',
  UNMATCHED: 'text-muted-foreground border-border bg-muted/40',
  INVALID: 'text-destructive border-destructive/25 bg-destructive/5',
  SKIPPED: 'text-muted-foreground border-border bg-muted/40',
}
</script>

<template>
  <QsTableStackedCell class="min-w-0 w-full whitespace-normal">
    <QsTableStackedLine>
      <FaTag variant="outline" class="qs-type-status-tag whitespace-nowrap" :class="tones[row.displayStatus]">
        {{ t(`containerImport.status.${row.displayStatus}`) }}
      </FaTag>
    </QsTableStackedLine>
    <QsTableStackedLine v-if="row.displayStatus === 'INVALID' && row.errors[0]" content-class="text-destructive [overflow-wrap:anywhere]">
      {{ row.errors[0] }}
    </QsTableStackedLine>
    <QsTableStackedLine v-if="row.selectedShipment" content-class="qs-type-data-emphasis [overflow-wrap:anywhere]">
      {{ row.selectedShipment.shippingMarkText || row.selectedShipment.shipmentNo || '—' }}
    </QsTableStackedLine>
    <QsTableStackedLine v-if="row.selectedShipment?.shippingMarkText && row.selectedShipment.shipmentNo" tone="muted" content-class="qs-type-data [overflow-wrap:anywhere]">
      {{ row.selectedShipment.shipmentNo }}
    </QsTableStackedLine>
    <QsTableStackedLine v-if="row.displayStatus !== 'INVALID' && (row.matchReason || row.manuallySelected)" tone="muted" content-class="qs-type-meta [overflow-wrap:anywhere]">
      {{ row.manuallySelected && row.selectedShipment ? t('containerImport.manual') : row.manuallySelected ? t('containerImport.status.UNMATCHED') : row.matchReason }}
    </QsTableStackedLine>
  </QsTableStackedCell>
</template>
