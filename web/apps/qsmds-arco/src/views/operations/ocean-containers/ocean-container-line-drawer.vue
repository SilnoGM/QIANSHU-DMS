<script setup lang="ts">
import type { OperationsOceanContainerLineDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import { formatContainerMeasurement } from '../../workbenches/containers/display.logic'

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
const weight = computed(() => formatContainerMeasurement(props.line?.grossWeightKg ?? null, 0))
const volume = computed(() => formatContainerMeasurement(props.line?.volumeCai ?? null, 2))
const dimensions = computed(() => {
  if (!props.line) {
    return null
  }
  const values = [props.line.lengthCm, props.line.widthCm, props.line.heightCm]
  return values.every(value => value !== null) ? values.map(value => formatContainerMeasurement(value, 0)).join(' × ') : null
})
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
    <div v-if="line" class="min-w-0 space-y-6">
      <section>
        <h3 class="qs-type-compact-title m-0 break-words">
          {{ line.goodsName }}
        </h3>
        <div class="mt-3 flex gap-2 items-center">
          <span class="qs-type-data text-primary min-w-0 break-all dark:text-primary-foreground">{{ line.oceanShippingMarkText || '—' }}</span>
          <CopyCellButton v-if="line.oceanShippingMarkText" :text="line.oceanShippingMarkText" :label="t('qsOceanContainer.mark')" always-visible />
        </div>
        <dl class="m-0 mt-4 gap-4 grid sm:grid-cols-2">
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
              {{ t('operationsOcean.salesOrder') }}
            </dt>
            <dd class="qs-type-data m-0 mt-1 break-all">
              {{ line.salesOrderNo || '—' }}
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('operationsOcean.warehouseReceiptReference') }}
            </dt>
            <dd class="qs-type-data m-0 mt-1 break-all">
              {{ line.warehouseReceiptReference || '—' }}
            </dd>
          </div>
        </dl>
      </section>
      <section class="pt-5 border-t border-border">
        <h3 class="qs-type-compact-title m-0 mb-4">
          {{ t('operationsOcean.recipient') }}
        </h3>
        <div class="qs-type-body-medium flex flex-wrap gap-x-4 gap-y-1">
          <span>{{ line.recipientName || '—' }}</span>
          <span class="qs-type-data">{{ line.recipientPhone || '—' }}</span>
        </div>
        <p class="qs-type-description m-0 mt-2 break-words">
          {{ line.recipientAddress || '—' }}
        </p>
      </section>
      <dl class="m-0 pt-5 border-t border-border gap-4 grid sm:grid-cols-2">
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
        <div class="sm:col-span-2">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('qsOceanContainer.cod') }}
          </dt>
          <dd class="m-0 mt-1">
            <AmountDisplay :value="line.codAmountTwd" currency="TWD" :currencies="currencies" class="text-primary dark:text-primary-foreground" />
          </dd>
        </div>
      </dl>
      <section class="pt-5 border-t border-border">
        <h3 class="qs-type-compact-title m-0 mb-3">
          {{ t('operationsOcean.remark') }}
        </h3>
        <p class="qs-type-description m-0 whitespace-pre-wrap break-words">
          {{ line.remark || '—' }}
        </p>
      </section>
    </div>
    <template #footer>
      <FaButton variant="outline" @click="visible = false">
        {{ t('operationsOcean.close') }}
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
