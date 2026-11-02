<script setup lang="ts">
import type { RechargeImageUploadFile } from './use-recharge-image-upload'
import type { AdvertisingRechargeDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import type { MoneyAmount } from '@/components/base/MoneyInput/logic'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  ADVERTISING_RECHARGE_ACCOUNT_TYPE_OPTIONS,
  buildAdvertisingRechargeCopyText,
  buildAdvertisingRechargeDetailLink,
} from './logic'
import RechargeImageUpload from './recharge-image-upload.vue'

export interface AdvertisingRechargeCreatePayload {
  accountType: AdvertisingRechargeDto['accountType']
  adAccountName: string
  adAccountNo: string
  rechargeAmount: string
  rechargeCurrency: string
  paymentQrMediaAssetId?: string
  remark?: string
}

const props = withDefaults(defineProps<{
  created?: AdvertisingRechargeDto | null
  currencies: readonly CurrencyDescriptor[]
  enabled: boolean
  error?: null | string
  modelValue: boolean
  submitting?: boolean
  upload: RechargeImageUploadFile
}>(), {
  created: null,
  error: null,
  submitting: false,
})

const emit = defineEmits<{
  'submit': [payload: AdvertisingRechargeCreatePayload]
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const router = useRouter()
const toast = useQsToast()
const step = ref<'form' | 'copy'>('form')
const accountType = ref<AdvertisingRechargeDto['accountType']>('PERSONAL')
const adAccountName = ref('')
const adAccountNo = ref('')
const rechargeAmount = ref<MoneyAmount>(null)
const rechargeCurrency = ref<string | null>('USD')
const remark = ref('')
const qrMediaAssetId = ref<string | null>(null)
const qrBusy = ref(false)
const localError = ref('')
const copyError = ref('')
const copyPending = ref(false)

const accountTypeOptions = computed(() => ADVERTISING_RECHARGE_ACCOUNT_TYPE_OPTIONS.map(option => ({
  value: option.value,
  label: t(option.labelKey),
})))
const visibleError = computed(() => localError.value || props.error || '')
const canSubmit = computed(() => (
  !props.submitting
  && !qrBusy.value
  && adAccountName.value.trim().length > 0
  && adAccountNo.value.trim().length > 0
  && rechargeAmount.value !== null
  && rechargeAmount.value.trim().length > 0
  && rechargeCurrency.value !== null
  && (accountType.value === 'NON_PERSONAL' || qrMediaAssetId.value !== null)
))
const copyText = computed(() => props.created === null
  ? ''
  : buildAdvertisingRechargeCopyText({
      adAccountName: props.created.adAccountName,
      adAccountNo: props.created.adAccountNo,
      link: detailLink(props.created.id),
    }))

function detailLink(id: string): string {
  // 财务详情路由对所有已登录用户都注册，运营只需复制链接、不进入该页。
  const href = router.resolve({
    name: 'qsFinanceRealtimeAdvertisingRechargeDetail',
    params: { id },
  }).href
  return buildAdvertisingRechargeDetailLink(window.location.origin, href)
}

function reset(): void {
  step.value = 'form'
  accountType.value = 'PERSONAL'
  adAccountName.value = ''
  adAccountNo.value = ''
  rechargeAmount.value = null
  rechargeCurrency.value = 'USD'
  remark.value = ''
  qrMediaAssetId.value = null
  localError.value = ''
  copyError.value = ''
  copyPending.value = false
}

watch(() => props.modelValue, (visible) => {
  if (visible) {
    reset()
  }
})

watch(() => props.created, (created) => {
  if (created !== null) {
    step.value = 'copy'
  }
})

watch(accountType, (value) => {
  if (value === 'NON_PERSONAL') {
    qrMediaAssetId.value = null
  }
  localError.value = ''
})

function close(): void {
  if (props.submitting || qrBusy.value) {
    return
  }
  emit('update:modelValue', false)
}

function updateVisible(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
    return
  }
  close()
}

function submit(): void {
  if (!canSubmit.value) {
    localError.value = t('advertisingRecharge.create.required')
    return
  }
  localError.value = ''
  emit('submit', {
    accountType: accountType.value,
    adAccountName: adAccountName.value.trim(),
    adAccountNo: adAccountNo.value.trim(),
    rechargeAmount: rechargeAmount.value!,
    rechargeCurrency: rechargeCurrency.value!,
    ...(accountType.value === 'PERSONAL' && qrMediaAssetId.value !== null
      ? { paymentQrMediaAssetId: qrMediaAssetId.value }
      : {}),
    ...(remark.value.trim().length === 0 ? {} : { remark: remark.value.trim() }),
  })
}

async function copyAndClose(): Promise<void> {
  if (copyText.value.length === 0 || copyPending.value) {
    return
  }
  copyPending.value = true
  try {
    await navigator.clipboard.writeText(copyText.value)
    copyError.value = ''
    toast.success(t('advertisingRecharge.create.copied'))
    emit('update:modelValue', false)
  }
  catch {
    copyError.value = t('advertisingRecharge.create.copyFailed')
  }
  finally {
    copyPending.value = false
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t(step === 'form' ? 'advertisingRecharge.create.title' : 'advertisingRecharge.create.copyTitle')"
    :description="t(step === 'form' ? 'advertisingRecharge.create.description' : 'advertisingRecharge.create.copyDescription')"
    size="lg"
    :submitting="submitting || qrBusy"
    :dismiss-on-escape="!submitting && !qrBusy"
    :dismiss-on-overlay="!submitting && !qrBusy"
    @update:model-value="updateVisible"
  >
    <template v-if="step === 'form'">
      <FaAlert v-if="visibleError" :description="visibleError" variant="destructive" class="mb-4" />
      <div class="gap-4 grid min-w-0">
        <label class="flex flex-col gap-1.5">
          <span class="qs-type-meta text-muted-foreground">{{ t('advertisingRecharge.field.accountType') }}</span>
          <FaSelect v-model="accountType" :options="accountTypeOptions" :aria-label="t('advertisingRecharge.field.accountType')" />
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="qs-type-meta text-muted-foreground">{{ t('advertisingRecharge.field.adAccountName') }}</span>
          <FaInput v-model="adAccountName" maxlength="128" autocomplete="off" :aria-label="t('advertisingRecharge.field.adAccountName')" />
        </label>

        <label class="flex flex-col gap-1.5">
          <span class="qs-type-meta text-muted-foreground">{{ t('advertisingRecharge.field.adAccountNo') }}</span>
          <FaInput v-model="adAccountNo" maxlength="128" autocomplete="off" :aria-label="t('advertisingRecharge.field.adAccountNo')" />
        </label>

        <div class="flex flex-col gap-1.5">
          <span class="qs-type-meta text-muted-foreground">{{ t('advertisingRecharge.field.rechargeAmount') }}</span>
          <MoneyInput
            v-model="rechargeAmount"
            v-model:currency="rechargeCurrency"
            :currencies="currencies"
            min="0.01"
            autocomplete="off"
            :aria-label="t('advertisingRecharge.field.rechargeAmount')"
          />
          <span class="qs-type-meta text-muted-foreground">{{ t('advertisingRecharge.field.rechargeAmountHint') }}</span>
        </div>

        <div v-if="accountType === 'PERSONAL'" class="flex flex-col gap-1.5">
          <span class="qs-type-meta text-muted-foreground">{{ t('advertisingRecharge.field.paymentQr') }}</span>
          <RechargeImageUpload
            v-model="qrMediaAssetId"
            :enabled="enabled"
            :disabled="submitting"
            :upload="upload"
            :label="t('advertisingRecharge.field.paymentQr')"
            :hint="t('advertisingRecharge.field.paymentQrHint')"
            @busy-change="qrBusy = $event"
          />
        </div>

        <label class="flex flex-col gap-1.5">
          <span class="qs-type-meta text-muted-foreground">{{ t('advertisingRecharge.field.remark') }}</span>
          <FaTextarea v-model="remark" maxlength="500" :rows="3" :aria-label="t('advertisingRecharge.field.remark')" />
        </label>
      </div>
    </template>

    <template v-else>
      <FaAlert v-if="copyError" :description="copyError" variant="destructive" class="mb-4" />
      <dl v-if="created" class="m-0 mb-4 gap-x-6 gap-y-4 grid grid-cols-2">
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground mb-1">
            {{ t('advertisingRecharge.field.rechargeNo') }}
          </dt>
          <dd class="qs-type-data-emphasis m-0 break-all">
            {{ created.rechargeNo }}
          </dd>
        </div>
        <div class="min-w-0">
          <dt class="qs-type-meta text-muted-foreground mb-1">
            {{ t('advertisingRecharge.field.rechargeAmount') }}
          </dt>
          <dd class="m-0">
            <AmountDisplay :value="created.rechargeAmount" :currency="created.rechargeCurrency" :currencies="currencies" />
          </dd>
        </div>
      </dl>
      <pre class="text-sm font-mono m-0 p-4 border border-border rounded-lg bg-muted/30 max-h-80 whitespace-pre-wrap break-words overflow-auto">{{ copyText }}</pre>
    </template>

    <template #footer>
      <template v-if="step === 'form'">
        <FaButton type="button" variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="submitting" @click="close">
          {{ t('advertisingRecharge.create.cancel') }}
        </FaButton>
        <FaButton type="button" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="submitting" :disabled="!canSubmit" @click="submit">
          {{ t('advertisingRecharge.create.submit') }}
        </FaButton>
      </template>
      <template v-else>
        <FaButton type="button" variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" @click="close">
          {{ t('advertisingRecharge.create.close') }}
        </FaButton>
        <FaButton type="button" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="copyPending" @click="copyAndClose">
          <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
          {{ t('advertisingRecharge.create.copy') }}
        </FaButton>
      </template>
    </template>
  </QsGenericModal>
</template>
