<script setup lang="ts">
import type { OceanChangeKind } from './change-logic'
import type { OperationsOceanContainerLineDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import operationsOceanApi from '@/api/modules/operations-ocean-containers'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { OCEAN_COD_MAX, oceanChangeDiff, RECIPIENT_FIELDS } from './change-logic'
import { useOceanLineChange } from './change-session'

const props = defineProps<{
  containerId: string
  lineId: string
  containerName: string
  kind: OceanChangeKind
  currencies: readonly CurrencyDescriptor[]
}>()
const emit = defineEmits<{ close: [], saved: [line: OperationsOceanContainerLineDto] }>()
const { t } = useI18n()
const toast = useQsToast()
const visible = ref(true)
const fieldId = useId()
const state = useOceanLineChange({
  ...props,
  api: operationsOceanApi,
  copyText: text => navigator.clipboard.writeText(text),
  onClose: (latestLine) => {
    if (latestLine) {
      emit('saved', latestLine)
    }
    emit('close')
  },
})
const { line, draft, step, loading, loadError, error, intent, diff, copying, saving, pending, needsReload, result, undoing, undoPending, countdown, busy, locked, canSave, canUndo } = state
const steps = computed(() => ['editStep', 'compareStep', 'confirmStep', 'successStep'].map(id => ({ id, title: t(`operationsOcean.change.${id}`) })))
const currencyReady = computed(() => props.currencies.some(currency => currency.code === 'TWD' && currency.enabled && currency.minorUnit === 2))
const changedFields = computed(() => line.value ? oceanChangeDiff(line.value, { ...draft.value, kind: 'RECIPIENT' }).map(row => row.key) : [])
const displayDiff = computed(() => diff.value.map(row => ({ ...row, after: step.value === 3 && result.value ? result.value.line[row.key] : row.after })))
const title = computed(() => t(`operationsOcean.change.${props.kind === 'RECIPIENT' ? 'recipientTitle' : 'codTitle'}`))
function message(value: { key?: string, message?: string } | null) {
  return value?.message || (value?.key ? t(`operationsOcean.change.${value.key}`) : '')
}
function close() {
  state.close()
}
async function copy() {
  if (await state.copy()) {
    toast.success(t('operationsOcean.change.copied'))
  }
  else if (error.value?.key === 'copyFailed') {
    toast.error(t('operationsOcean.change.copyFailed'))
  }
}
async function undo() {
  if (await state.undo()) {
    toast.success(t('operationsOcean.change.undone'))
    state.close()
  }
}
function canClose() {
  return !pending.value && !undoPending.value
}
watch(visible, value => !value && close())
onMounted(() => {
  void state.load()
})
</script>

<template>
  <QsGenericModal v-model="visible" :title="title" :size="kind === 'RECIPIENT' ? 'lg' : 'md'" :loading="loading" :error="message(loadError) || null" :submitting="busy" :before-close="canClose" :closable="!pending && !undoPending" :dismiss-on-overlay="false">
    <template #header-leading>
      <FaIcon :name="kind === 'RECIPIENT' ? 'i-lucide:contact-round' : 'i-lucide:hand-coins'" class="size-5" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" @click="state.load">
        {{ t('operationsOcean.retry') }}
      </FaButton>
    </template>
    <div v-if="line" class="ocean-change-content space-y-5">
      <div class="pb-4 border-b border-border/70 flex flex-wrap gap-x-5 gap-y-2 items-baseline">
        <span class="qs-type-body-medium">{{ containerName }}</span>
        <div class="flex flex-wrap gap-x-2 gap-y-1 min-w-0 items-baseline">
          <span class="qs-type-meta text-muted-foreground">{{ t('qsOceanContainer.mark') }}</span>
          <strong class="ocean-change-accent qs-type-data-emphasis min-w-0 break-all">{{ line.oceanShippingMarkText || '—' }}</strong>
        </div>
      </div>
      <FaSteps :model-value="step" :steps="steps" :status="step === 3 ? 'finish' : 'process'" class="ocean-change-steps w-full" />
      <template v-if="step === 0">
        <div v-if="kind === 'RECIPIENT'" class="gap-4 grid sm:grid-cols-2">
          <div v-for="field in RECIPIENT_FIELDS" :key="field" class="min-w-0 space-y-2" :class="['recipientAddress', 'remark'].includes(field) && 'sm:col-span-2'">
            <div class="flex gap-2 min-h-5 items-center justify-between">
              <label :for="`${fieldId}-${field}`" class="qs-type-label">{{ t(`operationsOcean.${field}`) }}</label>
              <span v-if="changedFields.includes(field)" class="ocean-change-accent qs-type-meta">{{ t('operationsOcean.change.modified') }}</span>
            </div>
            <FaTextarea
              v-if="['recipientAddress', 'remark'].includes(field)" :id="`${fieldId}-${field}`" :aria-label="t(`operationsOcean.${field}`)" :model-value="draft[field] || ''" :rows="2" :disabled="locked"
              input-class="min-h-20 max-h-48 resize-y"
              @update:model-value="draft[field] = $event ?? ''"
            />
            <FaInput v-else :id="`${fieldId}-${field}`" :model-value="draft[field] || ''" :disabled="locked" class="w-full" @update:model-value="draft[field] = String($event ?? '')" />
          </div>
        </div>
        <div v-else class="space-y-5">
          <div class="px-4 py-3 rounded-lg bg-muted/40 flex flex-wrap gap-x-4 gap-y-2 items-baseline justify-between">
            <span class="qs-type-body text-muted-foreground">{{ t('operationsOcean.change.currentCod') }}</span>
            <AmountDisplay v-if="line.codAmountTwd !== null" :value="line.codAmountTwd" currency="TWD" :currencies="currencies" class="ocean-change-amount" />
            <span v-else class="qs-type-body-medium">{{ t('operationsOcean.change.noCod') }}</span>
          </div>
          <div class="space-y-2">
            <label :for="`${fieldId}-amount`" class="qs-type-label block">{{ t('operationsOcean.change.newCod') }}</label>
            <MoneyInput :id="`${fieldId}-amount`" v-model="draft.codAmountTwd" currency="TWD" :currencies="currencies" :currency-selectable="false" :disabled="locked || !currencyReady" :aria-describedby="`${fieldId}-amount-hint`" min="0" :max="OCEAN_COD_MAX" />
            <p :id="`${fieldId}-amount-hint`" class="qs-type-meta text-muted-foreground m-0">
              {{ t('operationsOcean.change.clearCodHint') }}
            </p>
          </div>
          <FaAlert v-if="!currencyReady" :title="t('operationsOcean.change.currencyUnavailable')" variant="destructive" />
        </div>
      </template>
      <template v-else-if="intent">
        <div v-if="step === 1" class="qs-type-description text-muted-foreground flex gap-2 items-start">
          <FaIcon name="i-lucide:info" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />
          <span>{{ t('operationsOcean.change.sendHint') }}</span>
        </div>
        <div v-else class="flex gap-3 items-start" :role="step === 3 ? 'status' : undefined">
          <span class="ocean-change-accent rounded-lg bg-primary/10 flex shrink-0 size-9 items-center justify-center">
            <FaIcon :name="step === 3 ? 'i-lucide:check' : 'i-lucide:send'" class="size-5" aria-hidden="true" />
          </span>
          <div class="min-w-0 space-y-1">
            <h3 class="qs-type-component-title m-0">
              {{ t(step === 3 ? 'operationsOcean.change.saved' : 'operationsOcean.change.confirmSent') }}
            </h3>
            <p class="qs-type-description text-muted-foreground m-0">
              {{ t(step === 3 ? 'operationsOcean.change.savedSummary' : 'operationsOcean.change.confirmSentHint') }}
            </p>
          </div>
        </div>
        <div v-if="kind === 'RECIPIENT'" class="border border-border rounded-lg overflow-hidden">
          <div class="qs-type-meta text-muted-foreground px-4 py-2 bg-muted/30 gap-4 hidden sm:grid" :class="step === 3 ? 'sm:grid-cols-[96px_minmax(0,1fr)]' : 'sm:grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)]'">
            <span>{{ t('operationsOcean.change.field') }}</span>
            <span v-if="step !== 3">{{ t('operationsOcean.change.before') }}</span>
            <span>{{ t('operationsOcean.change.after') }}</span>
          </div>
          <div v-for="row in displayDiff" :key="row.key" class="ocean-change-recipient-row px-4 py-3 border-border gap-x-4 gap-y-2 grid sm:border-t" :class="step === 3 ? 'sm:grid-cols-[96px_minmax(0,1fr)]' : 'sm:grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)]'">
            <span class="qs-type-label">{{ t(`operationsOcean.${row.key}`) }}</span>
            <div v-if="step !== 3" class="min-w-0">
              <span class="qs-type-meta text-muted-foreground mb-1 block sm:hidden">{{ t('operationsOcean.change.before') }}</span>
              <p class="qs-type-body text-muted-foreground m-0 whitespace-pre-wrap break-words">
                {{ row.before || '—' }}
              </p>
            </div>
            <div class="min-w-0">
              <span class="qs-type-meta text-muted-foreground mb-1 block sm:hidden">{{ t('operationsOcean.change.after') }}</span>
              <p class="qs-type-body-medium m-0 whitespace-pre-wrap break-words">
                {{ row.after || t('operationsOcean.change.cleared') }}
              </p>
            </div>
          </div>
        </div>
        <div v-for="row in displayDiff" v-else :key="row.key" class="ocean-change-cod-comparison gap-3 grid items-center" :class="step !== 3 && 'sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'">
          <div v-if="step !== 3" class="px-4 py-3 rounded-lg bg-muted/40 min-w-0 space-y-2">
            <span class="qs-type-meta text-muted-foreground block">{{ t('operationsOcean.change.before') }}</span>
            <AmountDisplay v-if="row.before !== null" :value="row.before" currency="TWD" :currencies="currencies" class="ocean-change-amount" />
            <span v-else class="qs-type-body-medium">{{ t('operationsOcean.change.noCod') }}</span>
          </div>
          <FaIcon v-if="step !== 3" name="i-lucide:arrow-right" class="text-muted-foreground size-4 hidden sm:block" aria-hidden="true" />
          <div class="px-4 py-3 rounded-lg bg-primary/5 min-w-0 space-y-2">
            <span class="qs-type-meta text-muted-foreground block">{{ t('operationsOcean.change.after') }}</span>
            <AmountDisplay v-if="row.after !== null" :value="row.after" currency="TWD" :currencies="currencies" class="ocean-change-accent ocean-change-amount" />
            <span v-else class="ocean-change-accent qs-type-body-medium">{{ t('operationsOcean.change.cancelCod') }}</span>
          </div>
        </div>
        <p v-if="step === 3" class="qs-type-meta text-muted-foreground m-0" aria-live="off">
          {{ countdown === null ? t('operationsOcean.change.undoPausedHint') : t('operationsOcean.change.successHint', { seconds: countdown }) }}
        </p>
      </template>
      <FaAlert v-if="error" :title="message(error)" variant="destructive">
        <template v-if="needsReload" #description>
          <FaButton variant="outline" size="sm" :disabled="busy" @click="state.load">
            {{ t('operationsOcean.change.reload') }}
          </FaButton>
        </template>
      </FaAlert>
    </div>
    <template #footer>
      <div class="ocean-change-footer flex flex-wrap gap-2 w-full justify-end">
        <template v-if="step === 3">
          <FaButton type="button" variant="outline" :loading="undoing" :disabled="!canUndo" @click="undo">
            {{ t('operationsOcean.change.undo') }}
          </FaButton>
          <FaButton type="button" :disabled="busy || undoPending" @click="close">
            {{ countdown === null ? t('operationsOcean.close') : t('operationsOcean.change.closeCountdown', { seconds: countdown }) }}
          </FaButton>
        </template>
        <template v-else-if="step === 2">
          <FaButton type="button" variant="outline" :disabled="busy || pending" @click="close">
            {{ t('operationsOcean.change.cancelUnsent') }}
          </FaButton>
          <FaButton type="button" :loading="saving" :disabled="!canSave" @click="state.save">
            {{ t('operationsOcean.change.confirmSave') }}
          </FaButton>
        </template>
        <template v-else>
          <FaButton type="button" variant="outline" :disabled="busy" @click="close">
            {{ t('operationsOcean.close') }}
          </FaButton>
          <template v-if="line && !loading && !loadError">
            <FaButton v-if="step === 1" type="button" variant="outline" :disabled="locked" @click="state.edit">
              {{ t('operationsOcean.change.back') }}
            </FaButton>
            <FaButton v-if="step === 0" type="button" :disabled="locked || (kind === 'COD' && !currencyReady)" @click="state.review">
              {{ t('operationsOcean.change.next') }}
            </FaButton>
            <FaButton v-else type="button" :loading="copying" :disabled="locked" @click="copy">
              <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />{{ t('operationsOcean.change.copy') }}
            </FaButton>
          </template>
        </template>
      </div>
    </template>
  </QsGenericModal>
</template>

<style scoped>
.ocean-change-content {
  --ocean-accent: oklch(var(--primary));
}

:global(.dark .ocean-change-content) {
  --ocean-accent: color-mix(in oklab, oklch(var(--primary)), oklch(var(--foreground)) 45%);
}

.ocean-change-accent {
  color: var(--ocean-accent);
}

.ocean-change-amount {
  display: block;
  max-width: 100%;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.5;
  text-align: left;
  overflow-wrap: anywhere;
  white-space: normal;
}

.ocean-change-recipient-row:nth-child(2n) {
  background-color: oklch(var(--primary) / 3%);
}

.ocean-change-recipient-row + .ocean-change-recipient-row {
  border-top-width: 1px;
}

.ocean-change-steps :deep(h4) {
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
}

@media (width < 640px) {
  .ocean-change-footer > :deep(button) {
    flex: 1 1 auto;
    min-height: 44px;
  }
}
</style>
