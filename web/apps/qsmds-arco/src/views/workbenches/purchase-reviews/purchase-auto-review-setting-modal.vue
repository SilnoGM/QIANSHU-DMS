<script setup lang="ts">
import type { PurchaseAutoReviewSettingDto } from '@/api/generated/types.gen'
import purchaseOrdersApi from '@/api/modules/purchase-orders'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from '../../operations/purchase-orders/purchase-order-list.logic'

const props = defineProps<{
  modelValue: boolean
  setting: PurchaseAutoReviewSettingDto | null
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'updated': [setting: PurchaseAutoReviewSettingDto]
}>()
const { t } = useI18n()
const { auth } = useAppAuth()
const toast = useQsToast()
const submitting = ref(false)
const actionError = ref('')
let controller: AbortController | null = null
const canManage = computed(() => auth('purchase-orders:auto-review'))
const targetEnabled = computed(() => props.setting !== null && !props.setting.enabled)

function setVisible(value: boolean): void {
  if (!submitting.value) {
    emit('update:modelValue', value)
  }
}

async function submit(): Promise<void> {
  const setting = props.setting
  if (!setting || submitting.value || !canManage.value) {
    return
  }
  const request = new AbortController()
  controller = request
  submitting.value = true
  actionError.value = ''
  try {
    const response = await purchaseOrdersApi.updateAutoReviewSetting({
      enabled: !setting.enabled,
      expectedVersion: setting.version,
    }, request.signal)
    emit('updated', response.data)
    toast.success(t(response.data.enabled
      ? 'purchaseReview.autoReview.enabledToast'
      : 'purchaseReview.autoReview.disabledToast'))
    // 先释放提交态再关窗：QsGenericModal 在 submitting 期间拒绝受控关闭。
    submitting.value = false
    emit('update:modelValue', false)
  }
  catch (failure) {
    if (!isPurchaseOrderAbortError(failure)) {
      actionError.value = getPurchaseOrderApiFailure(failure).message
    }
  }
  finally {
    if (controller === request) {
      controller = null
    }
    submitting.value = false
  }
}

onBeforeUnmount(() => {
  controller?.abort()
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('purchaseReview.autoReview.settingTitle')"
    :description="t('purchaseReview.autoReview.settingDescription')"
    size="md"
    :submitting="submitting"
    @update:model-value="setVisible"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:workflow" class="text-primary size-4" aria-hidden="true" />
    </template>
    <div class="space-y-4">
      <FaAlert v-if="actionError" :description="actionError" variant="destructive" />

      <div class="text-sm space-y-1">
        <p class="font-medium">
          {{ setting?.enabled ? t('purchaseReview.autoReview.statusEnabled') : t('purchaseReview.autoReview.statusDisabled') }}
        </p>
        <p v-if="setting?.updatedAt" class="text-muted-foreground">
          {{ t('purchaseReview.autoReview.updatedBy', { name: setting.updatedBy?.displayName ?? '—' }) }}
          · <DateTimeDisplay :value="setting.updatedAt" />
        </p>
        <p v-else class="text-muted-foreground">
          {{ t('purchaseReview.autoReview.neverUpdated') }}
        </p>
      </div>

      <div>
        <p class="text-sm font-medium mb-2">
          {{ t('purchaseReview.autoReview.impactTitle') }}
        </p>
        <ul class="text-sm text-muted-foreground pl-5 list-disc space-y-1">
          <li>{{ t('purchaseReview.autoReview.impactMarks') }}</li>
          <li>{{ t('purchaseReview.autoReview.impactImage') }}</li>
          <li>{{ t('purchaseReview.autoReview.impactReview') }}</li>
          <li>{{ t('purchaseReview.autoReview.impactPayable') }}</li>
          <li>{{ t('purchaseReview.autoReview.impactFallback') }}</li>
        </ul>
      </div>

      <FaAlert v-if="targetEnabled" :description="t('purchaseReview.autoReview.enableHint')" />
      <FaAlert v-else variant="destructive" :description="t('purchaseReview.autoReview.disableHint')" />
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="setVisible(false)">
        {{ t('purchaseReview.autoReview.cancel') }}
      </FaButton>
      <FaButton
        type="button"
        :variant="targetEnabled ? 'default' : 'destructive'"
        :disabled="!canManage || setting === null || submitting"
        :loading="submitting"
        data-testid="purchase-auto-review-confirm"
        @click="submit"
      >
        {{ targetEnabled ? t('purchaseReview.autoReview.enable') : t('purchaseReview.autoReview.disable') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
