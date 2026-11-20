<script setup lang="ts">
import type { OrderProductLineModel } from '../QsOrderProductLineEditor/types'
import type { SalesOrderProductEditIntent, SalesOrderProductsEditorModalProps } from './types'

import QsGenericModal from '../QsGenericModal/index.vue'
import QsSalesOrderProductsEditorPanel from './Panel.vue'

defineOptions({ name: 'QsSalesOrderProductsEditorModal' })

const props = withDefaults(defineProps<SalesOrderProductsEditorModalProps>(), {
  lines: () => [],
  reason: '客户调整产品',
  loading: false,
  error: null,
  submitting: false,
})

const emit = defineEmits<{
  'cancel': []
  'confirm': [intent: SalesOrderProductEditIntent]
  'retry': []
  'review': [intent: SalesOrderProductEditIntent]
  'validationError': [message: string]
  'update:lines': [lines: readonly OrderProductLineModel[]]
  'update:modelValue': [value: boolean]
  'update:reason': [value: string]
}>()

function closeAsCancel(): void {
  if (props.submitting) {
    return
  }
  emit('cancel')
  emit('update:modelValue', false)
}

function handleVisibility(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
    return
  }
  closeAsCancel()
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="修改销售订单产品"
    description="当前订单产品统一在下方编辑；已采购行保留采购事实约束。"
    size="xl"
    class="sm:!max-w-[90rem] sm:!w-[calc(100%-3rem)]"
    :loading="loading"
    :error="error"
    :submitting="submitting"
    :dismiss-on-overlay="!submitting"
    :dismiss-on-escape="!submitting"
    @update:model-value="handleVisibility"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:list-restart" class="size-4" aria-hidden="true" />
    </template>

    <template #error-actions>
      <FaButton type="button" variant="outline" :disabled="submitting" @click="emit('retry')">
        <FaIcon name="i-lucide:refresh-cw" class="size-4" aria-hidden="true" />
        重新加载
      </FaButton>
    </template>

    <QsSalesOrderProductsEditorPanel
      :context="context"
      :lines="lines"
      :reason="reason"
      :currencies="currencies"
      :load-products="loadProducts"
      :submitting="submitting"
      @cancel="closeAsCancel"
      @confirm="emit('confirm', $event)"
      @review="emit('review', $event)"
      @validation-error="emit('validationError', $event)"
      @update:lines="emit('update:lines', $event)"
      @update:reason="emit('update:reason', $event)"
    />
  </QsGenericModal>
</template>
