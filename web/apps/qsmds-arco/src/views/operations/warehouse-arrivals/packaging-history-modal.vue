<script setup lang="ts">
import type { PackagingCostContext } from './packaging-cost.logic'
import type { PackagingCostRequestSummaryDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

defineProps<{
  modelValue: boolean
  context: PackagingCostContext
  records: PackagingCostRequestSummaryDto[]
  loading: boolean
  error: string | null
  continueDisabled: boolean
  unavailableHint: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean], 'reload': [], 'continue': [] }>()
const { t } = useI18n()
const { currencies } = useCurrencyCatalog()
</script>

<template>
  <QsGenericModal
    :model-value="modelValue" :title="t(loading ? 'warehousePackagingCost.history.checking' : error ? 'warehousePackagingCost.history.checkFailed' : 'warehousePackagingCost.history.title')"
    :description="!loading && !error ? t('warehousePackagingCost.history.description', { count: records.length }) : undefined"
    size="lg" :loading="loading" :error="error" @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:clipboard-list" class="size-5" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" @click="emit('reload')">
        {{ t('warehousePackagingCost.retry') }}
      </FaButton>
    </template>
    <div class="gap-4 grid">
      <dl class="m-0 p-4 border border-border rounded-lg bg-muted/25 gap-4 grid sm:grid-cols-[1fr_2fr]">
        <div v-for="field in (['shipmentNo', 'shippingMarkText'] as const)" :key="field" class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t(`warehousePackagingCost.${field}`) }}
          </dt>
          <dd class="qs-type-data-emphasis m-0 mt-1 break-all">
            {{ context[field] || t('warehousePackagingCost.notRecorded') }}
          </dd>
        </div>
      </dl>
      <FaAlert v-if="unavailableHint" :title="unavailableHint" variant="destructive" />
      <ol class="m-0 p-0 list-none space-y-3">
        <li v-for="(record, index) in records" :key="record.id" class="p-4 border border-border rounded-lg min-w-0 space-y-3">
          <div class="flex flex-wrap gap-2 items-center justify-between">
            <h3 class="qs-type-label m-0">
              {{ t('warehousePackagingCost.history.record', { index: index + 1 }) }}
            </h3>
            <FaTag variant="outline" class="shrink-0" :class="record.status === 'PAID' ? 'text-primary border-primary/30 bg-primary/10 dark:text-emerald-300' : 'text-amber-700 border-amber-500/30 bg-amber-500/10 dark:text-amber-300'">
              {{ t(`warehousePackagingCost.history.status.${record.status}`) }}
            </FaTag>
          </div>
          <div class="p-3 rounded-md bg-muted/25 flex flex-wrap gap-3 items-center justify-between">
            <div class="min-w-0">
              <p class="qs-type-body-medium m-0 break-words">
                {{ record.packagingTypeName }}
              </p>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                {{ t(`packagingPayment.vendor.${record.packagingVendor}`) }}
              </p>
            </div>
            <div class="max-w-full overflow-x-auto">
              <AmountDisplay :value="record.amount" :currency="record.currencyCode" :currencies="currencies" />
            </div>
          </div>
          <dl class="m-0 gap-x-6 gap-y-3 grid sm:grid-cols-2">
            <div>
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('warehousePackagingCost.history.submittedBy') }}
              </dt>
              <dd class="m-0 mt-1">
                <QsPersonDisplay :display-name="record.submittedBy.name" size="sm" />
              </dd>
            </div>
            <div>
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('warehousePackagingCost.history.submittedAt') }}
              </dt>
              <dd class="m-0 mt-1">
                <DateTimeDisplay :value="record.submittedAt" />
              </dd>
            </div>
            <template v-if="record.status === 'PAID'">
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('warehousePackagingCost.history.paidBy') }}
                </dt>
                <dd class="m-0 mt-1">
                  <QsPersonDisplay v-if="record.paidBy" :display-name="record.paidBy.name" size="sm" /><span v-else>—</span>
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta text-muted-foreground">
                  {{ t('warehousePackagingCost.history.paidAt') }}
                </dt>
                <dd class="m-0 mt-1">
                  <DateTimeDisplay :value="record.paidAt" />
                </dd>
              </div>
            </template>
            <div v-if="record.remark" class="sm:col-span-2">
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('packagingPayment.remark') }}
              </dt>
              <dd class="qs-type-body m-0 mt-1 whitespace-pre-wrap break-words">
                {{ record.remark }}
              </dd>
            </div>
          </dl>
        </li>
      </ol>
    </div>
    <template #footer>
      <FaButton variant="outline" @click="emit('update:modelValue', false)">
        {{ t('warehousePackagingCost.cancel') }}
      </FaButton>
      <FaButton v-if="!loading && !error && records.length" :disabled="continueDisabled" @click="emit('continue')">
        {{ t('warehousePackagingCost.history.continue') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
