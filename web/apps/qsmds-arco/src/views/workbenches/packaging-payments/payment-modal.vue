<script setup lang="ts">
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { usePackagingPayment } from './use-packaging-payment'

const props = defineProps<{ requestId: string, enabled: boolean }>()
const emit = defineEmits<{ close: [], changed: [] }>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const { detail, loading, busy, loadError, actionError, payable, load, confirm } = usePackagingPayment(
  computed(() => props.enabled && auth('packaging-costs:read')),
  computed(() => auth('packaging-costs:pay')),
  computed(() => account.authEpoch),
  computed(() => props.requestId),
)
async function pay() {
  if (await confirm()) {
    toast.success(t('packagingPayment.paySuccess'))
    emit('changed')
    emit('close')
  }
  else if (detail.value?.status === 'PAID') {
    emit('changed')
  }
}
</script>

<template>
  <QsGenericModal :model-value="true" :title="t('packagingPayment.payTitle')" size="md" :loading="loading" :error="loadError || null" :submitting="busy" @update:model-value="!$event && emit('close')">
    <template #header-leading>
      <FaIcon name="i-lucide:wallet" class="size-5" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" @click="load">
        {{ t('packagingPayment.retry') }}
      </FaButton>
    </template>
    <div v-if="detail" class="space-y-5">
      <FaAlert v-if="actionError" :title="t('packagingPayment.payFailed')" :description="actionError" variant="destructive" />
      <FaAlert v-if="detail.status === 'PAID'" :title="t('packagingPayment.alreadyPaid')" />
      <div class="p-5 border border-border rounded-lg bg-muted/25 space-y-2">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('packagingPayment.paymentAmount') }}
        </p>
        <AmountDisplay :value="detail.amount" currency="CNY" :currencies="currencyCatalog.currencies.value" class="text-2xl" />
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('packagingPayment.amountHint') }}
        </p>
      </div>
      <dl class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('packagingPayment.shipmentNo') }}
          </dt>
          <dd class="qs-type-data-emphasis m-0 mt-1 break-all">
            {{ detail.shipmentNo || '—' }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('packagingPayment.shippingMarkText') }}
          </dt>
          <dd class="qs-type-data m-0 mt-1 break-all">
            {{ detail.shippingMarkText || '—' }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('packagingPayment.packagingInfo') }}
          </dt>
          <dd class="m-0 mt-1">
            {{ detail.packagingTypeName }} · {{ t(`packagingPayment.vendor.${detail.packagingVendor}`) }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('packagingPayment.owner') }}
          </dt>
          <dd class="m-0 mt-1">
            <QsPersonDisplay :display-name="detail.owner.name" size="sm" :avatar-url="detail.owner.avatarUrl" />
          </dd>
        </div>
      </dl>
    </div>
    <template #footer>
      <FaButton variant="outline" :disabled="busy" @click="emit('close')">
        {{ t(detail?.status === 'PAID' ? 'packagingPayment.close' : 'packagingPayment.cancel') }}
      </FaButton>
      <FaButton v-if="detail?.status !== 'PAID'" :disabled="!payable" :loading="busy" @click="pay">
        {{ t('packagingPayment.confirmPay') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
