<script setup lang="ts">
import type { AdvertisingRechargeRequiredField } from './recharge-form'
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
import { resolveAdvertisingRechargeMissingFields } from './recharge-form'
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
const attempted = ref(false)
const copyError = ref('')
const copyPending = ref(false)
const copied = ref(false)
const closeArmed = ref(false)
const nameWrap = ref<HTMLElement | null>(null)
const noWrap = ref<HTMLElement | null>(null)
const amountWrap = ref<HTMLElement | null>(null)
const qrWrap = ref<HTMLElement | null>(null)

const FIELD_LABEL_KEYS: Record<AdvertisingRechargeRequiredField, string> = {
  adAccountName: 'advertisingRecharge.field.adAccountName',
  adAccountNo: 'advertisingRecharge.field.adAccountNo',
  rechargeAmount: 'advertisingRecharge.field.rechargeAmount',
  paymentQr: 'advertisingRecharge.field.paymentQr',
}

const accountTypeOptions = computed(() => ADVERTISING_RECHARGE_ACCOUNT_TYPE_OPTIONS.map(option => ({
  value: option.value,
  label: t(option.labelKey),
})))
/** 上传或提交期间锁定关闭与再次提交；字段缺失不再禁用按钮，改由点击后定位错误。 */
const busy = computed(() => props.submitting || qrBusy.value)
const missingFields = computed(() => resolveAdvertisingRechargeMissingFields({
  accountType: accountType.value,
  adAccountName: adAccountName.value,
  adAccountNo: adAccountNo.value,
  rechargeAmount: rechargeAmount.value,
  paymentQrMediaAssetId: qrMediaAssetId.value,
}))
/** 只有点过提交才显示字段级错误，避免刚打开弹窗就一片红。 */
const invalidFields = computed(() => new Set(attempted.value ? missingFields.value : []))
const missingSummary = computed(() => missingFields.value
  .map(field => t(FIELD_LABEL_KEYS[field]))
  .join('、'))
const footerMessage = computed(() => {
  if (props.error) {
    return props.error
  }
  if (attempted.value && missingFields.value.length > 0) {
    return t('advertisingRecharge.create.missing', { fields: missingSummary.value })
  }
  return ''
})
const stepText = computed(() => t(step.value === 'form'
  ? 'advertisingRecharge.create.stepOne'
  : 'advertisingRecharge.create.stepTwo'))
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
  attempted.value = false
  copyError.value = ''
  copyPending.value = false
  copied.value = false
  closeArmed.value = false
}

watch(() => props.modelValue, (visible) => {
  if (visible) {
    reset()
  }
})

watch(() => props.created, (created) => {
  if (created !== null) {
    step.value = 'copy'
    attempted.value = false
  }
})

function focusField(field: AdvertisingRechargeRequiredField): void {
  const wrapper = {
    adAccountName: nameWrap,
    adAccountNo: noWrap,
    rechargeAmount: amountWrap,
    paymentQr: qrWrap,
  }[field]
  wrapper.value?.querySelector<HTMLElement>('input, textarea, button')?.focus()
}

function close(): void {
  if (busy.value) {
    return
  }
  // 复制步骤先确认一次再关闭，避免还没复制就把唯一一份文案关掉。
  if (step.value === 'copy' && !copied.value && !closeArmed.value) {
    closeArmed.value = true
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

async function submit(): Promise<void> {
  if (busy.value) {
    return
  }
  attempted.value = true
  if (missingFields.value.length > 0) {
    // 首次校验会插入字段错误节点，等 DOM 稳定后再聚焦，避免焦点被这次补丁重置。
    await nextTick()
    focusField(missingFields.value[0]!)
    return
  }
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

async function copyToClipboard(): Promise<boolean> {
  if (copyText.value.length === 0 || copyPending.value) {
    return false
  }
  copyPending.value = true
  try {
    await navigator.clipboard.writeText(copyText.value)
    copyError.value = ''
    copied.value = true
    closeArmed.value = false
    return true
  }
  catch {
    copyError.value = t('advertisingRecharge.create.copyFailed')
    return false
  }
  finally {
    copyPending.value = false
  }
}

async function copyOnly(): Promise<void> {
  if (await copyToClipboard()) {
    toast.success(t('advertisingRecharge.create.copied'))
  }
}

async function copyAndClose(): Promise<void> {
  if (await copyToClipboard()) {
    toast.success(t('advertisingRecharge.create.copied'))
    emit('update:modelValue', false)
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t(step === 'form' ? 'advertisingRecharge.create.title' : 'advertisingRecharge.create.submittedTitle')"
    :description="t(step === 'form' ? 'advertisingRecharge.create.description' : 'advertisingRecharge.create.copyDescription')"
    size="lg"
    :submitting="busy"
    :dismiss-on-escape="!busy"
    :dismiss-on-overlay="!busy"
    @update:model-value="updateVisible"
  >
    <template #header-extra>
      <span class="qs-type-meta text-muted-foreground pt-0.5 whitespace-nowrap">{{ stepText }}</span>
    </template>

    <FaForm v-if="step === 'form'" :disabled="busy" class="min-w-0 space-y-5">
      <section class="min-w-0 space-y-3">
        <h3 class="qs-type-component-title m-0">
          {{ t('advertisingRecharge.create.accountSection') }}
        </h3>
        <div class="gap-4 grid grid-cols-1 md:grid-cols-12">
          <div class="md:col-span-4">
            <FaFormItem
              name="accountType"
              :label="t('advertisingRecharge.field.accountType')"
              required
              :auto-bind="false"
            >
              <div
                class="p-1 border border-border rounded-lg bg-muted/30 flex gap-1"
                role="radiogroup"
                :aria-label="t('advertisingRecharge.field.accountType')"
              >
                <button
                  v-for="option in accountTypeOptions"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :aria-checked="accountType === option.value"
                  class="text-sm px-2 py-1.5 rounded-md flex-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  :class="accountType === option.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'"
                  @click="accountType = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </FaFormItem>
          </div>

          <div ref="nameWrap" class="md:col-span-8">
            <FaFormItem
              name="adAccountName"
              :label="t('advertisingRecharge.field.adAccountName')"
              required
              :auto-bind="false"
            >
              <FaInput
                v-model="adAccountName"
                class="w-full"
                maxlength="128"
                autocomplete="off"
                :aria-invalid="invalidFields.has('adAccountName')"
                :placeholder="t('advertisingRecharge.field.adAccountNamePlaceholder')"
              />
            </FaFormItem>
            <p v-if="invalidFields.has('adAccountName')" role="alert" class="text-xs text-destructive m-0 mt-1">
              {{ t('advertisingRecharge.field.required') }}
            </p>
          </div>

          <div ref="noWrap" class="md:col-span-12">
            <FaFormItem
              name="adAccountNo"
              :label="t('advertisingRecharge.field.adAccountNo')"
              required
              :auto-bind="false"
            >
              <FaInput
                v-model="adAccountNo"
                class="w-full"
                maxlength="128"
                autocomplete="off"
                :aria-invalid="invalidFields.has('adAccountNo')"
                :placeholder="t('advertisingRecharge.field.adAccountNoPlaceholder')"
              />
            </FaFormItem>
            <p v-if="invalidFields.has('adAccountNo')" role="alert" class="text-xs text-destructive m-0 mt-1">
              {{ t('advertisingRecharge.field.required') }}
            </p>
          </div>
        </div>
      </section>

      <section class="pt-5 border-t border-border min-w-0 space-y-3">
        <h3 class="qs-type-component-title m-0">
          {{ t('advertisingRecharge.create.rechargeSection') }}
        </h3>
        <div class="gap-4 grid grid-cols-1 md:grid-cols-12">
          <div ref="amountWrap" class="md:col-span-6">
            <FaFormItem
              name="rechargeAmount"
              :label="t('advertisingRecharge.field.rechargeAmount')"
              required
              :auto-bind="false"
              :description="t('advertisingRecharge.field.rechargeAmountHint')"
            >
              <MoneyInput
                v-model="rechargeAmount"
                v-model:currency="rechargeCurrency"
                :currencies="currencies"
                min="0.01"
                autocomplete="off"
                :aria-invalid="invalidFields.has('rechargeAmount')"
                :aria-label="t('advertisingRecharge.field.rechargeAmount')"
              />
            </FaFormItem>
            <p v-if="invalidFields.has('rechargeAmount')" role="alert" class="text-xs text-destructive m-0 mt-1">
              {{ t('advertisingRecharge.field.required') }}
            </p>
          </div>

          <!-- 切换账户类型只隐藏二维码，不清空已上传文件；切回个人户可直接复用。 -->
          <div v-show="accountType === 'PERSONAL'" ref="qrWrap" class="md:col-span-12">
            <div class="p-3 border border-primary/25 rounded-xl bg-primary/5">
              <FaFormItem
                name="paymentQr"
                :label="t('advertisingRecharge.field.paymentQr')"
                required
                :auto-bind="false"
                :description="t('advertisingRecharge.field.paymentQrHint')"
                description-class="text-primary"
              >
                <RechargeImageUpload
                  v-model="qrMediaAssetId"
                  :enabled="enabled"
                  :disabled="busy"
                  :upload="upload"
                  :label="t('advertisingRecharge.field.paymentQr')"
                  @busy-change="qrBusy = $event"
                />
              </FaFormItem>
              <!-- 错误提示必须放在 FaFormItem 外侧：插槽子节点数量变化会重建上传组件，
                   重建时的 onScopeDispose 会把已上传的媒体 id 清空。 -->
              <p v-if="invalidFields.has('paymentQr')" role="alert" class="text-xs text-destructive m-0 mt-1">
                {{ t('advertisingRecharge.field.required') }}
              </p>
            </div>
          </div>

          <div class="md:col-span-12">
            <FaFormItem
              name="remark"
              :label="t('advertisingRecharge.field.remark')"
              :auto-bind="false"
            >
              <FaTextarea
                v-model="remark"
                maxlength="500"
                :rows="3"
                :placeholder="t('advertisingRecharge.field.remarkPlaceholder')"
              />
              <p class="qs-type-meta text-muted-foreground m-0 text-right">
                {{ t('advertisingRecharge.field.remarkCount', { count: remark.length }) }}
              </p>
            </FaFormItem>
          </div>
        </div>
      </section>
    </FaForm>

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
      <div class="border border-border rounded-xl overflow-hidden">
        <div class="px-3 py-2 border-b border-border bg-muted/30 flex gap-2 items-center justify-between">
          <span class="qs-type-meta text-muted-foreground">{{ t('advertisingRecharge.create.copyHint') }}</span>
          <FaButton
            type="button"
            variant="ghost"
            size="sm"
            class="shrink-0 min-h-9"
            :loading="copyPending"
            @click="copyOnly"
          >
            <FaIcon :name="copied ? 'i-lucide:check' : 'i-lucide:copy'" class="size-4" aria-hidden="true" />
            {{ t(copied ? 'advertisingRecharge.create.copiedShort' : 'advertisingRecharge.create.copy') }}
          </FaButton>
        </div>
        <pre class="text-sm m-0 p-4 select-all whitespace-pre-wrap break-words">{{ copyText }}</pre>
      </div>
    </template>

    <template #footer>
      <p
        v-if="footerMessage"
        role="alert"
        class="qs-type-meta text-destructive m-0 sm:mr-auto sm:max-w-[60%]"
      >
        {{ footerMessage }}
      </p>
      <p
        v-else-if="step === 'copy' && closeArmed"
        role="status"
        class="qs-type-meta text-amber-700 m-0 dark:text-amber-300 sm:mr-auto"
      >
        {{ t('advertisingRecharge.create.closeUncopied') }}
      </p>
      <template v-if="step === 'form'">
        <FaButton type="button" variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="busy" @click="close">
          {{ t('advertisingRecharge.create.cancel') }}
        </FaButton>
        <FaButton type="button" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="submitting" :disabled="busy" @click="submit">
          {{ t('advertisingRecharge.create.submit') }}
        </FaButton>
      </template>
      <template v-else>
        <FaButton type="button" variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" @click="close">
          {{ t(closeArmed ? 'advertisingRecharge.create.confirmClose' : 'advertisingRecharge.create.close') }}
        </FaButton>
        <FaButton type="button" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="copyPending" @click="copyAndClose">
          <FaIcon name="i-lucide:copy" class="size-4" aria-hidden="true" />
          {{ t('advertisingRecharge.create.copy') }}
        </FaButton>
      </template>
    </template>
  </QsGenericModal>
</template>
