<script setup lang="ts">
import type { OperationsOceanContainerLineDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import { formatContainerMeasurement } from '../../workbenches/containers/display.logic'
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
