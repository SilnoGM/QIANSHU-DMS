<script setup lang="ts">
import type { ImportDisplayRow } from './use-container-import'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { formatContainerMeasurement } from '../display.logic'

defineOptions({ name: 'ShipmentSourceSummary' })

const props = defineProps<{ row: ImportDisplayRow }>()
const { t } = useI18n()
const { currencies } = useCurrencyCatalog()
const expanded = ref(false)

const measurement = (value: string | null, places: 0 | 2 = 0) => formatContainerMeasurement(value, places) ?? '—'
const dimensions = computed(() => `${[props.row.lengthCm, props.row.widthCm, props.row.heightCm].map(value => measurement(value)).join(' × ')} cm`)
const packageText = computed(() => `${props.row.packageCount} ${props.row.packageUnit || ''}`.trim())
const recipientText = computed(() => [props.row.recipientName, props.row.recipientPhone].filter(Boolean).join(' · ') || '—')
</script>

<template>
  <section class="p-3 border border-border rounded-lg bg-background/95 min-w-0 top-0 sticky z-10 backdrop-blur space-y-2">
    <div class="flex flex-wrap gap-x-4 gap-y-1 min-w-0 items-start justify-between">
      <div class="flex-1 min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerImport.source.title') }}
        </p>
        <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 min-w-0 items-baseline">
          <span class="qs-type-body-medium [overflow-wrap:anywhere]">{{ row.goodsName || '—' }}</span>
          <span class="qs-type-meta text-muted-foreground">
            {{ t('containerPage.receipt') }}
            <span class="qs-type-data font-mono [overflow-wrap:anywhere]">{{ row.warehouseReceiptReference || '—' }}</span>
          </span>
          <span class="qs-type-meta text-muted-foreground">
            {{ t('containerImport.oceanMark') }}
            <span class="qs-type-data [overflow-wrap:anywhere]">{{ row.oceanShippingMarkText || '—' }}</span>
          </span>
        </div>
      </div>
      <FaButton variant="ghost" size="sm" class="shrink-0" @click="expanded = !expanded">
        <FaIcon :name="expanded ? 'i-lucide:chevron-up' : 'i-lucide:chevron-down'" class="size-4" aria-hidden="true" />
        {{ t(expanded ? 'containerImport.source.collapse' : 'containerImport.source.expand') }}
      </FaButton>
    </div>

    <div v-if="expanded" class="text-sm gap-x-5 gap-y-2 grid min-w-0 sm:grid-cols-2">
      <div class="min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerPage.packageCount') }}
        </p>
        <p class="qs-type-data m-0 mt-0.5">
          {{ packageText || '—' }}
        </p>
      </div>
      <div class="min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerPage.weightLabel') }}
        </p>
        <p class="qs-type-data m-0 mt-0.5">
          {{ measurement(row.grossWeightKg) }} kg
        </p>
      </div>
      <div class="min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerPage.dimensionsLabel') }}
        </p>
        <p class="qs-type-data m-0 mt-0.5">
          {{ dimensions }}
        </p>
      </div>
      <div class="min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerImport.systemVolume') }}
        </p>
        <p class="qs-type-data m-0 mt-0.5">
          {{ measurement(row.volumeCai, 2) }} {{ t('containerManagement.volumeUnit') }}
        </p>
      </div>
      <div class="min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerPage.recipientInfo') }}
        </p>
        <p class="qs-type-data m-0 mt-0.5 [overflow-wrap:anywhere]">
          {{ recipientText }}
        </p>
        <p class="qs-type-meta text-muted-foreground m-0 mt-0.5 [overflow-wrap:anywhere]">
          {{ row.recipientAddress || '—' }}
        </p>
      </div>
      <div class="min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerPage.cod') }}
        </p>
        <p class="qs-type-data m-0 mt-0.5">
          <AmountDisplay v-if="row.codAmountTwd !== null" :value="row.codAmountTwd" currency="TWD" :currencies="currencies" class="text-primary" />
          <span v-else class="text-muted-foreground">{{ t('containerPage.none') }}</span>
        </p>
      </div>
      <div v-if="row.remark" class="min-w-0 sm:col-span-2">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerPage.remark') }}
        </p>
        <p class="qs-type-body m-0 mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {{ row.remark }}
        </p>
      </div>
      <p class="qs-type-meta text-muted-foreground m-0 sm:col-span-2">
        {{ t('containerImport.sheetRow', { sheet: row.sourceSheetName, row: row.sourceRowNumber }) }}
      </p>
    </div>
  </section>
</template>
