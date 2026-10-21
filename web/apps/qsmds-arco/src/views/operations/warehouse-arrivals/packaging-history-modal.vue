<script setup lang="ts">
import type { PackagingCostContext } from './packaging-cost.logic'
import type { PackagingCostRequestSummaryDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { usePackagingAmountEditor } from './use-packaging-amount-editor'

const props = defineProps<{
  modelValue: boolean
  context: PackagingCostContext
  records: PackagingCostRequestSummaryDto[]
  loading: boolean
  error: string | null
  continueDisabled: boolean
  unavailableHint: string
  canModify: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean], 'reload': [], 'continue': [], 'updated': [] }>()
const { t } = useI18n()
const { currencies } = useCurrencyCatalog()
const account = useAppAccountStore()
const toast = useQsToast()
const { selectedId, selected, editing, amount, busy, error: saveError, invalidAmount, needsReload, canEdit, start, cancel, save } = usePackagingAmountEditor(
  computed(() => props.records),
  computed(() => props.modelValue && props.canModify && !props.loading && !props.error),
  computed(() => account.authEpoch),
)
const currencyReady = computed(() => currencies.value.some(currency => currency.code === 'CNY' && currency.minorUnit === 2))
async function saveAmount() {
  if (!currencyReady.value) {
    return
  }
  if (await save()) {
    toast.success(t('warehousePackagingCost.history.amountUpdated'))
    emit('updated')
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue" :title="t(loading ? 'warehousePackagingCost.history.checking' : error ? 'warehousePackagingCost.history.checkFailed' : 'warehousePackagingCost.history.title')"
    :description="!loading && !error ? t('warehousePackagingCost.history.description', { count: records.length }) : undefined"
    size="lg" :loading="loading" :error="error" :submitting="busy" @update:model-value="emit('update:modelValue', $event)"
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
        <li v-for="(record, index) in records" :key="record.id" class="p-4 border rounded-lg min-w-0 space-y-3" :class="selectedId === record.id ? 'border-primary/50 bg-primary/5' : 'border-border'">
          <div class="flex flex-wrap gap-2 items-center justify-between">
            <FaButton variant="ghost" size="sm" :aria-pressed="selectedId === record.id" :disabled="busy || editing" @click="selectedId = record.id">
              <FaIcon :name="selectedId === record.id ? 'i-lucide:circle-check' : 'i-lucide:circle'" class="size-4" :class="selectedId === record.id ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
              {{ t('warehousePackagingCost.history.record', { index: index + 1 }) }}
            </FaButton>
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
                <QsPersonDisplay :display-name="record.submittedBy.name" size="sm" :avatar-url="record.submittedBy.avatarUrl" />
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
                  <QsPersonDisplay v-if="record.paidBy" :display-name="record.paidBy.name" size="sm" :avatar-url="record.paidBy.avatarUrl" /><span v-else>—</span>
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
      <div class="w-full space-y-4">
        <div v-if="editing" class="space-y-2">
          <label for="packaging-history-amount" class="qs-type-label">{{ t('warehousePackagingCost.history.newAmount') }}</label>
          <MoneyInput id="packaging-history-amount" v-model="amount" currency="CNY" :currencies="currencies" :currency-selectable="false" :disabled="busy || needsReload || !currencyReady" min="0.01" :aria-invalid="invalidAmount" />
          <p v-if="invalidAmount" class="qs-type-meta text-destructive m-0" role="alert">
            {{ t('warehousePackagingCost.errors.invalidAmount') }}
          </p>
          <p v-if="!currencyReady" class="qs-type-meta text-muted-foreground m-0">
            {{ t('warehousePackagingCost.currencyUnavailable') }}
          </p>
        </div>
        <FaAlert v-if="needsReload && saveError" :title="saveError" :description="t('warehousePackagingCost.history.reloadBeforeEdit')" variant="destructive" />
        <p v-if="!editing && !loading && !error && records.length" class="qs-type-meta text-muted-foreground m-0">
          {{ t(selected?.status === 'PAID' ? 'warehousePackagingCost.history.paidLocked' : 'warehousePackagingCost.history.selectHint') }}
        </p>
        <div class="flex flex-wrap gap-2 justify-end">
          <FaButton variant="outline" :disabled="busy" @click="emit('update:modelValue', false)">
            {{ t('warehousePackagingCost.cancel') }}
          </FaButton>
          <template v-if="!loading && !error && records.length">
            <FaButton v-if="needsReload" variant="outline" :disabled="busy" @click="emit('reload')">
              {{ t('warehousePackagingCost.retry') }}
            </FaButton>
            <template v-else-if="editing">
              <FaButton variant="outline" :disabled="busy" @click="cancel">
                {{ t('warehousePackagingCost.history.cancelEdit') }}
              </FaButton>
              <FaButton :disabled="!canEdit || !currencyReady" :loading="busy" @click="saveAmount">
                {{ t('warehousePackagingCost.history.saveAmount') }}
              </FaButton>
            </template>
            <template v-else>
              <FaButton variant="outline" :disabled="!canEdit" @click="start">
                <FaIcon name="i-lucide:pencil" class="size-4" aria-hidden="true" />
                {{ t('warehousePackagingCost.history.editAmount') }}
              </FaButton>
              <FaButton :disabled="continueDisabled" @click="emit('continue')">
                {{ t('warehousePackagingCost.history.continue') }}
              </FaButton>
            </template>
          </template>
        </div>
      </div>
    </template>
  </QsGenericModal>
</template>
