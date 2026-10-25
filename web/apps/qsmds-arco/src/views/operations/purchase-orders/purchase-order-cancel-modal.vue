<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { createPurchaseOrderCancelFlow } from './purchase-order-cancel-flow'
import { getPurchaseOrderApiFailure, isPurchaseOrderAbortError } from './purchase-order-list.logic'

defineOptions({ name: 'PurchaseOrderCancelModal' })

const props = defineProps<{ modelValue: boolean, orderId: string | null }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'cancelled': [detail: PurchaseOrderDetailDto]
}>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
// 运营侧取消权限与接口一致：purchase-orders:update 或 review 任一满足；页面本身仍要求 read。
const canCancel = computed(() => (
  auth('purchase-orders:read')
  && (auth('purchase-orders:update') || auth('purchase-orders:review'))
))
const flow = createPurchaseOrderCancelFlow({
  visible: toRef(props, 'modelValue'),
  orderId: toRef(props, 'orderId'),
  authEpoch: computed(() => account.authEpoch),
  canCancel,
  translate: t,
  api: purchaseOrdersApi,
  // 非安全上下文可能没有 Clipboard API；复制失败仍会保留弹窗并允许重试。
  clipboard: navigator.clipboard ?? { writeText: () => Promise.reject(new Error('Clipboard unavailable')) },
  toast,
  failure: getPurchaseOrderApiFailure,
  isAbortError: isPurchaseOrderAbortError,
  onCancelled: detail => emit('cancelled', detail),
  onClose: () => emit('update:modelValue', false),
})
const {
  detail,
  loading,
  submitting,
  copying,
  completed,
  loadError,
  actionError,
  reason,
  reasonError,
  busy,
  blockedMessage,
  copyText,
  canConfirm,
  reset,
  loadDetail,
  copyCancelledInfo,
  submit,
} = flow

function setVisible(value: boolean): void {
  if (!busy.value) {
    emit('update:modelValue', value)
  }
}

watch(() => [props.modelValue, props.orderId, account.authEpoch, canCancel.value] as const, () => {
  void loadDetail()
}, { immediate: true })
onDeactivated(() => {
  reset()
  emit('update:modelValue', false)
})
onBeforeUnmount(reset)
</script>

<template>
  <QsGenericModal :model-value="modelValue" title="确认取消采购单？" description="取消后停止履约和付款，并复制以下取消信息。" size="md" :loading="loading" :error="loadError || undefined" :submitting="busy" @update:model-value="setVisible">
    <template #header-leading>
      <FaIcon name="i-lucide:circle-x" class="text-destructive size-4" aria-hidden="true" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" @click="loadDetail">
        重试
      </FaButton>
    </template>
    <div class="space-y-4">
      <FaAlert v-if="actionError" :description="actionError" :variant="completed ? 'default' : 'destructive'" />
      <FaAlert v-else-if="!completed && blockedMessage" :description="blockedMessage" variant="destructive" />
      <pre v-if="detail" class="qs-type-body text-foreground m-0 p-4 border border-border rounded-lg bg-muted/20 whitespace-pre-wrap break-words">{{ copyText }}</pre>
      <div v-if="detail">
        <label for="purchase-order-cancel-reason" class="text-sm font-medium">
          取消原因 <span class="text-destructive" aria-hidden="true">*</span>
        </label>
        <FaTextarea
          id="purchase-order-cancel-reason"
          v-model="reason"
          class="mt-2"
          :rows="3"
          :maxlength="500"
          placeholder="请填写取消原因（最多 500 字）"
          :disabled="busy || completed"
        />
        <p v-if="reasonError" class="text-xs text-destructive m-0 mt-1">
          {{ reasonError }}
        </p>
      </div>
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="busy" @click="setVisible(false)">
        {{ completed ? '关闭' : '返回' }}
      </FaButton>
      <FaButton v-if="completed" type="button" :loading="copying" @click="copyCancelledInfo">
        复制取消信息
      </FaButton>
      <FaButton v-else type="button" variant="destructive" :disabled="!canConfirm" :loading="submitting" @click="submit">
        确认取消并复制
      </FaButton>
    </template>
  </QsGenericModal>
</template>
