<script setup lang="ts">
import type { OperationsOceanContainerLineDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import { formatContainerMeasurement } from '../../workbenches/containers/display.logic'
import { calculateFreightEstimate, HEAVY_CARGO_THRESHOLD_KG, OCEAN_FREIGHT_VOLUME_RATE_CNY, OCEAN_FREIGHT_WEIGHT_RATE_CNY } from './freight-estimate.logic'
import { buildOceanContainerRecipientText } from './recipient-copy.logic'

const props = defineProps<{
  line: OperationsOceanContainerLineDto | null
  containerName: string
  currencies: readonly CurrencyDescriptor[]
  loading: boolean
  error: string
}>()
defineEmits<{ retry: [] }>()
const visible = defineModel<boolean>({ required: true })
const { t } = useI18n()
const toast = useQsToast()
const copying = ref(false)
const weight = computed(() => formatContainerMeasurement(props.line?.grossWeightKg ?? null, 0))
const volume = computed(() => formatContainerMeasurement(props.line?.volumeCai ?? null, 2))
const dimensions = computed(() => {
  if (!props.line) {
    return null
  }
  const values = [props.line.lengthCm, props.line.widthCm, props.line.heightCm]
  return values.every(value => value !== null) ? values.map(value => formatContainerMeasurement(value, 0)).join(' × ') : null
})
const estimate = computed(() => props.line
  ? calculateFreightEstimate({
      grossWeightKg: props.line.grossWeightKg,
      lengthCm: props.line.lengthCm,
      widthCm: props.line.widthCm,
      heightCm: props.line.heightCm,
      packageCount: props.line.packageCount,
      codAmountTwd: props.line.codAmountTwd,
    })
  : null)
const volumeFormula = computed(() => {
  const current = estimate.value
  const line = props.line
  if (!current || current.volumeCai === null || !line) {
    return ''
  }
  if (line.lengthCm === null || line.widthCm === null || line.heightCm === null) {
    return ''
  }
  const base = `${line.lengthCm}×${line.widthCm}×${line.heightCm}×${line.packageCount} ÷ 28316`
  return line.volumeCai === null ? base : `${base} = ${line.volumeCai}`
})
const freightLabel = computed(() => {
  if (estimate.value?.freightBasis === 'BOTH') {
    return t('operationsOcean.freightEstimate.freightBoth')
  }
  if (estimate.value?.freightBasis === 'VOLUME') {
    return t('operationsOcean.freightEstimate.freightOnlyVolume')
  }
  if (estimate.value?.freightBasis === 'WEIGHT') {
    return t('operationsOcean.freightEstimate.freightOnlyWeight')
  }
  return ''
})
const surchargeLabel = computed(() => t('operationsOcean.freightEstimate.surcharge', { threshold: HEAVY_CARGO_THRESHOLD_KG }))
const volumeRateLabel = `¥${OCEAN_FREIGHT_VOLUME_RATE_CNY}`
const weightRateLabel = `¥${OCEAN_FREIGHT_WEIGHT_RATE_CNY}`

async function copyRecipient() {
  if (!props.line || copying.value) {
    return
  }
  copying.value = true
  try {
    await navigator.clipboard.writeText(buildOceanContainerRecipientText(props.line))
    toast.success(t('operationsOcean.recipientCopied'))
  }
  catch {
    toast.error(t('operationsOcean.recipientCopyFailed'))
  }
  finally {
    copying.value = false
  }
}
</script>

<template>
  <QsGenericDrawer v-model="visible" :title="t('operationsOcean.detailTitle')" :description="containerName" size="lg" :loading="loading" :error="error">
    <template #header-leading>
      <FaIcon name="i-lucide:package" class="size-4" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" @click="$emit('retry')">
        {{ t('operationsOcean.retry') }}
      </FaButton>
    </template>
    <div v-if="line" class="ocean-line-detail min-w-0 space-y-5">
      <section class="p-4 border border-primary/20 rounded-lg bg-primary/5">
        <dl class="m-0 gap-4 grid sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('qsOceanContainer.mark') }}
            </dt>
            <dd class="m-0 mt-1 flex gap-1 items-start">
              <span class="ocean-accent ocean-mark qs-type-data min-w-0 break-all">{{ line.oceanShippingMarkText || '—' }}</span>
              <CopyCellButton v-if="line.oceanShippingMarkText" :text="line.oceanShippingMarkText" :label="t('qsOceanContainer.mark')" always-visible />
            </dd>
          </div>
          <div class="min-w-0 sm:text-right">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('qsOceanContainer.cod') }}
            </dt>
            <dd class="m-0 mt-1">
              <AmountDisplay :value="line.codAmountTwd" currency="TWD" :currencies="currencies" class="ocean-accent ocean-cod max-w-full break-all" />
            </dd>
          </div>
        </dl>
        <dl class="m-0 mt-4 pt-3 border-t border-primary/15 space-y-3">
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.shippingMark') }}
            </dt>
            <dd class="qs-type-data m-0 mt-1 break-all">
              {{ line.shippingMark || '—' }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('qsOceanContainer.goods') }}
            </dt>
            <dd class="qs-type-body-medium m-0 mt-1 break-words">
              {{ line.goodsName }}
            </dd>
          </div>
        </dl>
      </section>
      <section>
        <div class="mb-3 flex flex-wrap gap-2 items-center justify-between">
          <h3 class="qs-type-compact-title m-0">
            {{ t('operationsOcean.recipient') }}
          </h3>
          <FaButton type="button" variant="outline" size="sm" class="min-h-11 sm:min-h-9" :disabled="copying" @click="copyRecipient">
            <FaIcon name="i-lucide:copy" class="size-3.5" aria-hidden="true" />
            {{ t('operationsOcean.copyRecipient') }}
          </FaButton>
        </div>
        <dl class="m-0 gap-x-5 gap-y-3 grid grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.recipientName') }}
            </dt>
            <dd class="qs-type-body-medium m-0 mt-1 break-words">
              {{ line.recipientName || '—' }}
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.recipientPhone') }}
            </dt>
            <dd class="qs-type-data m-0 mt-1 break-all">
              {{ line.recipientPhone || '—' }}
            </dd>
          </div>
          <div class="col-span-2">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.recipientAddress') }}
            </dt>
            <dd class="qs-type-body m-0 mt-1 whitespace-pre-wrap break-words">
              {{ line.recipientAddress || '—' }}
            </dd>
          </div>
          <div class="col-span-2">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.remark') }}
            </dt>
            <dd class="qs-type-body m-0 mt-1 whitespace-pre-wrap break-words">
              {{ line.remark || '—' }}
            </dd>
          </div>
        </dl>
      </section>
      <section class="pt-5 border-t border-border">
        <h3 class="qs-type-compact-title m-0 mb-4">
          {{ t('operationsOcean.loadingInfo') }}
        </h3>
        <dl class="m-0 gap-4 grid sm:grid-cols-2">
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.salesOrder') }}
            </dt>
            <dd class="qs-type-data m-0 mt-1 break-all">
              {{ line.salesOrderNo || '—' }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.warehouseReceiptReference') }}
            </dt>
            <dd class="qs-type-data m-0 mt-1 break-all">
              {{ line.warehouseReceiptReference || '—' }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.weight') }}
            </dt>
            <dd class="qs-type-data m-0 mt-1">
              {{ weight === null ? '—' : `${weight} kg` }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.dimensions') }}
            </dt>
            <dd class="qs-type-data m-0 mt-1">
              {{ dimensions === null ? '—' : `${dimensions} cm` }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.packages') }}
            </dt>
            <dd class="qs-type-data m-0 mt-1">
              {{ line.packageCount }} {{ line.packageUnit || t('operationsOcean.packageUnit') }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.volume') }}
            </dt>
            <dd class="qs-type-data m-0 mt-1">
              {{ volume === null ? '—' : `${volume} ${t('qsOceanContainer.volumeUnit')}` }}
            </dd>
          </div>
        </dl>
      </section>
      <section v-if="estimate && estimate.total" class="pt-5 border-t border-border min-w-0" :aria-label="t('operationsOcean.freightEstimate.title')">
        <div class="p-3.5 rounded-lg bg-muted/35 flex flex-wrap gap-3 items-center justify-between">
          <div class="flex gap-1.5 min-w-0 items-center">
            <span class="qs-type-body-medium">{{ t('operationsOcean.freightEstimate.total') }}</span>
            <FaTooltip side="top" align="start">
              <button
                type="button"
                class="text-muted-foreground p-0 rounded-full inline-flex size-6 items-center justify-center hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary/50 focus-visible:outline-offset-2"
                :aria-label="t('operationsOcean.freightEstimate.tooltipLabel')"
              >
                <FaIcon name="i-lucide:info" class="size-3.5" aria-hidden="true" />
              </button>
              <template #content>
                <div class="gap-1.5 grid max-w-96" role="group" :aria-label="t('operationsOcean.freightEstimate.tooltipTitle')">
                  <div v-if="estimate.volumeCai !== null" class="gap-x-2 grid grid-cols-[auto_1fr]">
                    <span class="text-muted-foreground">{{ t('operationsOcean.freightEstimate.chargeableVolume') }}</span>
                    <span>{{ t('operationsOcean.freightEstimate.volumeFormula', { formula: volumeFormula, volume: estimate.volumeCai }) }}</span>
                  </div>
                  <div v-if="estimate.weightKg !== null" class="gap-x-2 grid grid-cols-[auto_1fr]">
                    <span class="text-muted-foreground">{{ t('operationsOcean.freightEstimate.chargeableWeight') }}</span>
                    <span>{{ t('operationsOcean.freightEstimate.weightFormula', { weight: estimate.weightKg }) }}</span>
                  </div>
                  <div v-if="estimate.byVolume !== null" class="flex gap-4 items-baseline justify-between">
                    <span class="text-muted-foreground">{{ t('operationsOcean.freightEstimate.byVolume', { volume: estimate.volumeCai, rate: volumeRateLabel }) }}</span>
                    <AmountDisplay :value="estimate.byVolume" currency="CNY" :currencies="currencies" class="text-xs" />
                  </div>
                  <div v-if="estimate.byWeight !== null" class="flex gap-4 items-baseline justify-between">
                    <span class="text-muted-foreground">{{ t('operationsOcean.freightEstimate.byWeight', { weight: estimate.weightKg, rate: weightRateLabel }) }}</span>
                    <AmountDisplay :value="estimate.byWeight" currency="CNY" :currencies="currencies" class="text-xs" />
                  </div>
                  <div v-if="estimate.freight !== null" class="flex gap-4 items-baseline justify-between">
                    <span class="text-muted-foreground">{{ freightLabel }}</span>
                    <AmountDisplay :value="estimate.freight" currency="CNY" :currencies="currencies" class="text-xs" />
                  </div>
                  <div v-if="estimate.surcharge !== null" class="flex gap-4 items-baseline justify-between">
                    <span class="text-muted-foreground">{{ surchargeLabel }}</span>
                    <AmountDisplay :value="estimate.surcharge" currency="CNY" :currencies="currencies" class="text-xs" />
                  </div>
                  <div v-if="estimate.codHandling !== null" class="flex gap-4 items-baseline justify-between">
                    <span class="text-muted-foreground">{{ t('operationsOcean.freightEstimate.codHandling') }}</span>
                    <AmountDisplay :value="estimate.codHandling" currency="CNY" :currencies="currencies" class="text-xs" />
                  </div>
                  <div class="pt-1.5 border-t border-border flex gap-4 items-baseline justify-between">
                    <span class="font-semibold">{{ t('operationsOcean.freightEstimate.totalRow') }}</span>
                    <AmountDisplay :value="estimate.total" currency="CNY" :currencies="currencies" class="text-xs font-semibold" />
                  </div>
                  <p class="text-muted-foreground m-0 mt-1">
                    {{ t('operationsOcean.freightEstimate.note') }}
                  </p>
                </div>
              </template>
            </FaTooltip>
          </div>
          <AmountDisplay :value="estimate.total" currency="CNY" :currencies="currencies" class="text-lg font-bold" />
        </div>
      </section>
    </div>
    <template #footer>
      <FaButton variant="outline" @click="visible = false">
        {{ t('operationsOcean.close') }}
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>

<style scoped>
.ocean-line-detail {
  --ocean-accent: oklch(var(--primary));
}

:global(.dark .ocean-line-detail) {
  --ocean-accent: color-mix(in oklab, oklch(var(--primary)), oklch(var(--foreground)) 45%);
}

.ocean-accent {
  font-weight: var(--qs-type-weight-bold, 700);
  color: var(--ocean-accent);
}

.ocean-mark {
  font-size: var(--qs-type-size-xl);
  line-height: var(--qs-type-leading-lg);
}

.ocean-cod {
  font-size: var(--qs-type-size-2xl);
  line-height: var(--qs-type-leading-xl);
  text-align: inherit;
  white-space: normal;
}
</style>
