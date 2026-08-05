<script setup lang="ts">
import type {
  SupplierDto,
  SupplierStatusAction,
} from './supplier-management.logic'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  buildSupplierStatusPresentation,
  buildSupplierStatusRequest,
} from './supplier-management.logic'

defineOptions({ name: 'SupplierStatusChangeModal' })

const props = withDefaults(defineProps<{
  action: SupplierStatusAction
  error?: null | string
  modelValue: boolean
  requestId?: null | string
  submitting?: boolean
  supplier: null | SupplierDto
}>(), {
  error: null,
  requestId: null,
  submitting: false,
})

const emit = defineEmits<{
  'cancel': []
  'closed': []
  'confirm': [request: {
    action: SupplierStatusAction
    expectedVersion: number
    supplierId: string
  }]
  'update:modelValue': [value: boolean]
}>()

const submitRequested = ref(false)
const submitLocked = computed(() => props.submitting || submitRequested.value)
const presentation = computed(() => props.supplier === null
  ? null
  : buildSupplierStatusPresentation(props.action, props.supplier))

function cancel(): void {
  if (submitLocked.value) {
    return
  }
  emit('update:modelValue', false)
  emit('cancel')
}

function handleVisibleChange(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
  }
  else {
    cancel()
  }
}

async function confirm(): Promise<void> {
  const supplier = props.supplier
  if (
    submitLocked.value
    || supplier === null
    || presentation.value?.canConfirm !== true
  ) {
    return
  }

  submitRequested.value = true
  emit('confirm', {
    action: props.action,
    supplierId: supplier.id,
    ...buildSupplierStatusRequest(supplier),
  })
  await nextTick()
  if (!props.submitting) {
    submitRequested.value = false
  }
}

watch(
  () => props.submitting,
  (submitting) => {
    if (!submitting) {
      submitRequested.value = false
    }
  },
)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="presentation?.title ?? '供应商状态确认'"
    :description="supplier === null
      ? '缺少可操作的供应商详情。'
      : `请核对 ${supplier.code} 的状态变化与影响。`"
    size="sm"
    :submitting="submitLocked"
    data-testid="supplier-status-change-modal"
    @update:model-value="handleVisibleChange"
    @closed="emit('closed')"
  >
    <template #header-leading>
      <FaIcon
        :name="action === 'disable' ? 'i-lucide:circle-stop' : 'i-lucide:circle-check'"
        class="size-4"
      />
    </template>

    <FaEmpty
      v-if="supplier === null || presentation === null"
      icon="i-lucide:file-question"
      title="供应商详情不可用"
      description="请关闭弹窗并重新加载供应商详情。"
    />

    <div v-else class="gap-4 grid min-w-0">
      <FaAlert
        v-if="error"
        role="alert"
        variant="destructive"
        icon="i-lucide:circle-alert"
        title="操作未完成"
      >
        <template #description>
          <div class="gap-2 grid">
            <span>{{ error }}</span>
            <code v-if="requestId" class="qs-type-meta break-all">
              requestId: {{ requestId }}
            </code>
          </div>
        </template>
      </FaAlert>

      <section class="p-4 border border-border rounded-lg bg-muted/25 min-w-0">
        <p class="qs-type-compact-label mb-1 mt-0">
          供应商
        </p>
        <strong class="qs-type-body-medium block break-words">
          {{ supplier.legalName }}
        </strong>
        <code class="qs-type-data-emphasis mt-1 block break-all">
          {{ supplier.code }}
        </code>
      </section>

      <FaAlert
        :variant="presentation.destructive || !presentation.canConfirm
          ? 'destructive'
          : 'default'"
        :icon="presentation.canConfirm ? 'i-lucide:info' : 'i-lucide:circle-alert'"
        title="操作影响"
        :description="presentation.impact"
      />

      <div v-if="action === 'enable'" class="p-3 border border-border rounded-lg min-w-0">
        <p class="qs-type-compact-label mb-2 mt-0">
          启用就绪度
        </p>
        <p v-if="supplier.enableReadiness.ready" class="qs-type-body m-0">
          已满足：联系人姓名，以及电话或微信号。
        </p>
        <ul v-else class="qs-type-body m-0 pl-5" role="list">
          <li
            v-for="field in supplier.enableReadiness.missingFields"
            :key="field"
          >
            {{ field === 'primaryContact.name'
              ? '缺少联系人姓名'
              : '缺少联系人电话或微信号' }}
          </li>
        </ul>
      </div>
    </div>

    <template #footer>
      <FaButton
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="submitLocked"
        @click="cancel"
      >
        取消
      </FaButton>
      <FaButton
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :variant="presentation?.destructive ? 'destructive' : 'default'"
        :loading="submitLocked"
        :disabled="presentation === null || !presentation.canConfirm"
        @click="confirm"
      >
        {{ presentation?.confirmLabel ?? '确认' }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
