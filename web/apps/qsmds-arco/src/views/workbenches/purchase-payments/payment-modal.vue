<script setup lang="ts">
import type { PurchasePayableSelection } from './purchase-payments.logic'
import type { PurchasePayableOrderDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { usePurchasePayablePayment } from './use-purchase-payable-payment'

const props = defineProps<{ selection: PurchasePayableSelection, enabled: boolean }>()
const emit = defineEmits<{ close: [], changed: [order: PurchasePayableOrderDto], refresh: [] }>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const { paymentMethod, remark, busy, unknown, stale, error, fieldError, canSubmit, submit } = usePurchasePayablePayment(
  computed(() => props.enabled && auth('purchase-orders:payment')),
  computed(() => account.authEpoch),
  computed(() => props.selection),
)

async function confirm() {
  const updated = await submit()
  if (updated) {
    toast.success(t('purchasePayment.paySuccess'))
    emit('changed', updated)
    emit('close')
  }
  else if (error.value) {
    emit('refresh')
  }
}
</script>

<template>
  <QsGenericModal :model-value="true" :title="t('purchasePayment.payTitle')" size="md" :submitting="busy" @update:model-value="!$event && emit('close')">
    <template #header-leading>
      <FaIcon name="i-lucide:wallet" class="size-5" aria-hidden="true" />
    </template>
    <div class="space-y-5">
      <FaAlert v-if="error" :title="t(unknown ? 'purchasePayment.unknownTitle' : 'purchasePayment.payFailed')" :description="error" variant="destructive" />
      <FaAlert v-if="unknown" :title="t('purchasePayment.retryPay')" :description="t('purchasePayment.unknown')" />
      <FaAlert v-if="stale" :title="t('purchasePayment.staleTitle')" :description="t('purchasePayment.stale')" />
      <div class="p-5 border border-border rounded-lg bg-muted/25 space-y-2">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('purchasePayment.paymentAmount') }} · {{ t(`purchasePayment.types.${selection.item.paymentType}`) }}
        </p>
        <AmountDisplay :value="selection.item.remainingAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" class="text-2xl" />
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('purchasePayment.amountHint') }}
        </p>
      </div>
      <dl class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('purchasePayment.orderNo') }}
          </dt>
          <dd class="qs-type-data-emphasis m-0 mt-1 break-all">
            {{ selection.order.orderNo }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('purchasePayment.supplier') }}
          </dt>
          <dd class="m-0 mt-1 break-words">
            {{ selection.order.supplierName }}
          </dd>
        </div>
        <div class="sm:col-span-2">
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('purchasePayment.owner') }}
          </dt>
          <dd class="m-0 mt-1">
            <span v-if="selection.order.accountOwnerType === 'COMPANY'">{{ t('purchasePayment.companyAccount') }}</span>
            <QsPersonDisplay v-else-if="selection.order.owner" :display-name="selection.order.owner.name" size="sm" />
            <span v-else class="text-muted-foreground">{{ t('purchasePayment.ownerUnavailable') }}</span>
          </dd>
        </div>
      </dl>
      <FaForm :model="{ paymentMethod, remark }" :disabled="busy || unknown || stale" class="space-y-3">
        <FaFormItem name="paymentMethod" :label="t('purchasePayment.paymentMethod')" required>
          <QsDictionarySelect v-model="paymentMethod" dictionary-code="payment.method" :disabled="busy || unknown || stale" :placeholder="t('purchasePayment.choosePaymentMethod')" />
          <p v-if="fieldError === 'paymentMethod'" class="text-xs text-destructive m-0 mt-1">
            {{ t('purchasePayment.invalidPaymentMethod') }}
          </p>
        </FaFormItem>
        <FaFormItem name="remark" :label="t('purchasePayment.remark')">
          <FaTextarea v-model="remark" :disabled="busy || unknown || stale" maxlength="500" :placeholder="t('purchasePayment.remarkPlaceholder')" input-class="min-h-20" />
          <p v-if="fieldError === 'remark'" class="text-xs text-destructive m-0 mt-1">
            {{ t('purchasePayment.invalidRemark') }}
          </p>
        </FaFormItem>
      </FaForm>
    </div>
    <template #footer>
      <FaButton variant="outline" :disabled="busy" @click="emit('close')">
        {{ t(stale ? 'purchasePayment.close' : 'purchasePayment.cancel') }}
      </FaButton>
      <FaButton v-if="!stale" :disabled="!canSubmit" :loading="busy" @click="confirm">
        {{ t(unknown ? 'purchasePayment.retryPay' : 'purchasePayment.confirmPay') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
