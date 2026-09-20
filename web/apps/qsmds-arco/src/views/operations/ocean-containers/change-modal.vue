<script setup lang="ts">
import type { OceanChangeKind } from './change-logic'
import type { OperationsOceanContainerLineDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import operationsOceanApi from '@/api/modules/operations-ocean-containers'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { OCEAN_COD_MAX, RECIPIENT_FIELDS } from './change-logic'
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
const { line, draft, step, loading, loadError, error, intent, diff, copying, saving, pending, needsReload, undoing, undoPending, countdown, busy, locked, canSave, canUndo } = state
const steps = computed(() => ['editStep', 'compareStep', 'confirmStep', 'successStep'].map(id => ({ id, title: t(`operationsOcean.change.${id}`) })))
const currencyReady = computed(() => props.currencies.some(currency => currency.code === 'TWD' && currency.enabled && currency.minorUnit === 2))
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
  <QsGenericModal v-model="visible" :title="title" :description="containerName" size="lg" :loading="loading" :error="message(loadError) || null" :submitting="busy" :before-close="canClose" :closable="!pending && !undoPending" :dismiss-on-overlay="false">
    <template #header-leading>
      <FaIcon :name="kind === 'RECIPIENT' ? 'i-lucide:contact-round' : 'i-lucide:hand-coins'" class="size-5" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" @click="state.load">
        {{ t('operationsOcean.retry') }}
      </FaButton>
    </template>
    <div v-if="line" class="ocean-change-content space-y-5">
      <FaSteps :model-value="step" :steps="steps" :status="step === 3 ? 'finish' : 'process'" class="w-full" />
      <div class="px-4 py-3 border border-primary/20 rounded-lg bg-primary/5 flex flex-wrap gap-x-3 gap-y-1 items-baseline">
        <span class="qs-type-meta text-muted-foreground">{{ t('qsOceanContainer.mark') }}</span>
        <strong class="ocean-change-accent qs-type-data min-w-0 break-all">{{ line.oceanShippingMarkText || '—' }}</strong>
      </div>
      <template v-if="step === 0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('operationsOcean.change.editHint') }}
        </p>
        <div v-if="kind === 'RECIPIENT'" class="gap-x-4 gap-y-4 grid sm:grid-cols-2">
          <div v-for="field in RECIPIENT_FIELDS" :key="field" class="min-w-0 space-y-2" :class="['recipientAddress', 'remark'].includes(field) && 'sm:col-span-2'">
            <label :for="`${fieldId}-${field}`" class="qs-type-label block">{{ t(`operationsOcean.${field}`) }}</label>
            <FaTextarea
              v-if="['recipientAddress', 'remark'].includes(field)" :id="`${fieldId}-${field}`" :aria-label="t(`operationsOcean.${field}`)" :model-value="draft[field] || ''" :rows="3" :disabled="locked"
              @update:model-value="draft[field] = $event ?? ''"
            />
            <FaInput v-else :id="`${fieldId}-${field}`" :model-value="draft[field] || ''" :disabled="locked" @update:model-value="draft[field] = String($event ?? '')" />
          </div>
        </div>
        <div v-else class="space-y-4">
          <div class="flex flex-wrap gap-x-3 gap-y-1 items-baseline">
            <span class="qs-type-meta text-muted-foreground">{{ t('operationsOcean.change.currentCod') }}</span>
            <AmountDisplay v-if="line.codAmountTwd !== null" :value="line.codAmountTwd" currency="TWD" :currencies="currencies" />
            <span v-else class="qs-type-body">{{ t('operationsOcean.change.noCod') }}</span>
          </div>
          <div class="space-y-2">
            <label :for="`${fieldId}-amount`" class="qs-type-label block">{{ t('operationsOcean.change.newCod') }}</label>
            <MoneyInput :id="`${fieldId}-amount`" v-model="draft.codAmountTwd" currency="TWD" :currencies="currencies" :currency-selectable="false" :disabled="locked || !currencyReady" min="0" :max="OCEAN_COD_MAX" />
            <p class="qs-type-meta text-muted-foreground m-0">
              {{ t('operationsOcean.change.clearCodHint') }}
            </p>
          </div>
          <FaAlert v-if="!currencyReady" :title="t('operationsOcean.change.currencyUnavailable')" variant="destructive" />
        </div>
      </template>
      <template v-else-if="step === 1 && intent">
        <FaAlert :title="t('operationsOcean.change.sendHint')" :description="t('operationsOcean.change.compareHint')" />
        <div class="border border-border rounded-lg overflow-hidden">
          <div class="qs-type-meta text-muted-foreground px-4 py-2 bg-muted/30 gap-4 hidden sm:grid sm:grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)]">
            <span>{{ t('operationsOcean.change.field') }}</span><span>{{ t('operationsOcean.change.before') }}</span><span>{{ t('operationsOcean.change.after') }}</span>
          </div>
          <div v-for="row in diff" :key="row.key" class="px-4 py-3 border-t border-border gap-x-4 gap-y-2 grid grid-cols-2 sm:grid-cols-[96px_minmax(0,1fr)_minmax(0,1fr)]" :class="row.before !== row.after && 'bg-primary/5'">
            <span class="qs-type-label col-span-2 sm:col-span-1">{{ t(row.key === 'codAmountTwd' ? 'qsOceanContainer.cod' : `operationsOcean.${row.key}`) }}</span>
            <div class="min-w-0">
              <span class="qs-type-meta text-muted-foreground mb-1 block sm:hidden">{{ t('operationsOcean.change.before') }}</span>
              <AmountDisplay v-if="row.key === 'codAmountTwd' && row.before !== null" :value="row.before" currency="TWD" :currencies="currencies" class="ocean-change-amount" />
              <p v-else class="qs-type-body text-muted-foreground m-0 whitespace-pre-wrap break-words">
                {{ row.before || (row.key === 'codAmountTwd' ? t('operationsOcean.change.noCod') : '—') }}
              </p>
            </div>
            <div class="min-w-0">
              <span class="qs-type-meta text-muted-foreground mb-1 block sm:hidden">{{ t('operationsOcean.change.after') }}</span>
              <AmountDisplay v-if="row.key === 'codAmountTwd' && row.after !== null" :value="row.after" currency="TWD" :currencies="currencies" class="ocean-change-accent ocean-change-amount" />
              <p v-else class="qs-type-body-medium m-0 whitespace-pre-wrap break-words">
                {{ row.after || (row.key === 'codAmountTwd' ? t('operationsOcean.change.cancelCod') : row.before ? t('operationsOcean.change.cleared') : '—') }}
              </p>
            </div>
          </div>
        </div>
      </template>
      <section v-else-if="step === 2" class="px-2 py-6 text-center flex flex-col gap-3 items-center">
        <span class="ocean-change-accent rounded-full bg-primary/10 flex size-14 items-center justify-center">
          <FaIcon name="i-lucide:send" class="size-6" aria-hidden="true" />
        </span>
        <h3 class="qs-type-section-title m-0">
          {{ t('operationsOcean.change.confirmSent') }}
        </h3>
        <p class="qs-type-description text-muted-foreground m-0 max-w-sm">
          {{ t('operationsOcean.change.confirmSentHint') }}
        </p>
      </section>
      <section v-else-if="step === 3" class="px-2 py-6 text-center flex flex-col gap-3 items-center" role="status">
        <span class="ocean-change-accent rounded-full bg-primary/10 flex size-14 items-center justify-center">
          <FaIcon name="i-lucide:check" class="size-7" aria-hidden="true" />
        </span>
        <h3 class="qs-type-section-title m-0">
          {{ t('operationsOcean.change.saved') }}
        </h3>
        <p class="qs-type-description text-muted-foreground m-0 max-w-sm">
          {{ t(countdown === null ? 'operationsOcean.change.undoPausedHint' : 'operationsOcean.change.successHint') }}
        </p>
      </section>
      <FaAlert v-if="error" :title="message(error)" variant="destructive">
        <template v-if="needsReload" #description>
          <FaButton variant="outline" size="sm" :disabled="busy" @click="state.load">
            {{ t('operationsOcean.change.reload') }}
          </FaButton>
        </template>
      </FaAlert>
    </div>
    <template #footer>
      <div class="flex flex-wrap gap-2 w-full justify-end">
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
  max-width: 100%;
  text-align: left;
  overflow-wrap: anywhere;
  white-space: normal;
}
</style>
