<script setup lang="ts">
import type { PackagingCostRequestDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { usePackagingAmountEditor } from '../warehouse-arrivals/use-packaging-amount-editor'

const props = defineProps<{ modelValue: boolean, record: PackagingCostRequestDto | null, enabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean], 'updated': [], 'reload': [] }>()
const { t } = useI18n()
const { currencies } = useCurrencyCatalog()
const account = useAppAccountStore()
const toast = useQsToast()
const records = computed(() => (props.record ? [props.record] : []))
const editorEnabled = computed(() => props.modelValue && props.enabled && props.record !== null)
const { editing, amount, busy, error: saveError, invalidAmount, needsReload, canEdit, start, save } = usePackagingAmountEditor(
  records,
  editorEnabled,
  computed(() => account.authEpoch),
)
const currencyReady = computed(() => currencies.value.some(currency => currency.code === 'CNY' && currency.minorUnit === 2))
// 打开弹窗、重新读取到新版本后回到可编辑态；保存成功后由父级关闭并刷新列表。
// 编辑中不重填，避免刷新把用户正在输入的值覆盖回服务端金额。
watch([() => props.modelValue, () => props.record?.id, () => props.record?.version, editorEnabled, needsReload], () => {
  if (editorEnabled.value && !needsReload.value && !editing.value) {
    start()
  }
}, { immediate: true, flush: 'sync' })
async function submit(): Promise<void> {
  if (!currencyReady.value) {
    return
  }
  if (await save()) {
    toast.success(t('packagingPayment.amountModal.saved'))
    emit('updated')
    emit('update:modelValue', false)
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue" :title="t('packagingPayment.amountModal.title')" :description="t('packagingPayment.amountModal.description')"
    size="md" :submitting="busy" @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:pencil-line" class="size-5" aria-hidden="true" />
    </template>
    <div class="gap-4 grid">
      <dl class="m-0 p-4 border border-border rounded-lg bg-muted/25 gap-4 grid sm:grid-cols-[1fr_2fr]">
        <div v-for="field in (['shipmentNo', 'shippingMarkText'] as const)" :key="field" class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t(`packagingPayment.${field}`) }}
          </dt>
          <dd class="qs-type-data-emphasis m-0 mt-1 break-all">
            {{ record?.[field] || '—' }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('packagingPayment.packagingInfo') }}
          </dt>
          <dd class="qs-type-data m-0 mt-1 break-words">
            {{ record?.packagingTypeName ?? '—' }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('packagingPayment.amountModal.original') }}
          </dt>
          <dd class="m-0 mt-1">
            <AmountDisplay v-if="record" :value="record.amount" :currency="record.currencyCode" :currencies="currencies" />
            <span v-else>—</span>
          </dd>
        </div>
      </dl>
      <div class="space-y-2">
        <label for="packaging-amount-change" class="qs-type-label">{{ t('packagingPayment.amountModal.newAmount') }}</label>
        <MoneyInput
          id="packaging-amount-change" v-model="amount" currency="CNY" :currencies="currencies"
          :currency-selectable="false" :disabled="busy || needsReload || !currencyReady" min="0.01" :aria-invalid="invalidAmount"
        />
        <p v-if="invalidAmount" class="qs-type-meta text-destructive m-0" role="alert">
          {{ t('packagingPayment.amountModal.invalidAmount') }}
        </p>
      </div>
      <FaAlert v-if="needsReload && saveError" :title="saveError" :description="t('packagingPayment.amountModal.reloadHint')" variant="destructive" />
    </div>
    <template #footer>
      <div class="flex flex-wrap gap-2 justify-end">
        <FaButton variant="outline" :disabled="busy" @click="emit('update:modelValue', false)">
          {{ t('packagingPayment.cancel') }}
        </FaButton>
        <FaButton v-if="needsReload" variant="outline" :disabled="busy" @click="emit('reload')">
          {{ t('packagingPayment.amountModal.reload') }}
        </FaButton>
        <FaButton v-else :disabled="!canEdit || !currencyReady" :loading="busy" @click="submit">
          {{ t('packagingPayment.amountModal.save') }}
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
