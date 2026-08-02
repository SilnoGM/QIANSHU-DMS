<script setup lang="ts">
import type { NumberingLifecycleAction } from './numbering-detail.logic'
import type { NumberingRuleDetailDto } from '@/api/generated/types.gen'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { buildNumberingLifecyclePresentation } from './numbering-detail.logic'

defineOptions({ name: 'NumberingLifecycleModal' })

const props = withDefaults(defineProps<{
  modelValue: boolean
  action: NumberingLifecycleAction
  detail: NumberingRuleDetailDto | null
  submitting: boolean
  errorMessage?: string | null
  requestId?: string
}>(), {
  errorMessage: null,
  requestId: undefined,
})

const emit = defineEmits<{
  'closed': []
  'update:modelValue': [value: boolean]
  'confirm': [action: NumberingLifecycleAction]
  'cancel': []
}>()

const presentation = computed(() => props.detail === null
  ? null
  : buildNumberingLifecyclePresentation(props.action, props.detail))

function cancel(): void {
  if (props.submitting) {
    return
  }
  emit('update:modelValue', false)
  emit('cancel')
}

function handleVisibleChange(value: boolean): void {
  if (!value) {
    cancel()
  }
  else {
    emit('update:modelValue', true)
  }
}

function confirm(): void {
  if (
    props.submitting
    || presentation.value === null
    || !presentation.value.canConfirm
  ) {
    return
  }
  emit('confirm', props.action)
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="presentation?.title ?? '编号规则操作确认'"
    :description="presentation === null
      ? '缺少可操作的编号规则详情。'
      : `请核对 ${presentation.ruleCode} 的目标版本与影响。`"
    size="md"
    :submitting="submitting"
    data-testid="numbering-lifecycle-modal"
    @update:model-value="handleVisibleChange"
    @closed="emit('closed')"
  >
    <template #header-leading>
      <FaIcon :name="presentation?.icon ?? 'i-lucide:triangle-alert'" class="size-4" />
    </template>

    <FaEmpty
      v-if="presentation === null"
      icon="i-lucide:file-question"
      title="规则详情不可用"
      description="请关闭弹窗并重新加载编号规则。"
    />

    <div v-else class="gap-4 grid min-w-0">
      <FaAlert
        v-if="errorMessage"
        role="alert"
        variant="destructive"
        icon="i-lucide:circle-alert"
        title="操作未完成"
      >
        <template #description>
          <div class="flex flex-wrap gap-2 min-w-0 items-center justify-between">
            <span class="break-words">{{ errorMessage }}</span>
            <code v-if="requestId" class="qs-type-meta [overflow-wrap:anywhere]">
              requestId: {{ requestId }}
            </code>
          </div>
        </template>
      </FaAlert>

      <section class="p-4 border border-border rounded-lg bg-muted/10 min-w-0">
        <p class="qs-type-compact-label mb-1 mt-0">
          规则
        </p>
        <strong class="qs-type-body-medium block break-words">
          {{ presentation.name }}
        </strong>
        <code class="qs-type-data-emphasis mt-1 block [overflow-wrap:anywhere]">
          {{ presentation.ruleCode }}
        </code>
      </section>

      <dl class="m-0 gap-3 grid grid-cols-2 max-[390px]:grid-cols-1">
        <div class="p-3 border border-border rounded-lg bg-background min-w-0">
          <dt class="qs-type-compact-label">
            {{ presentation.revisionLabel }}
          </dt>
          <dd class="qs-type-data-emphasis mb-0 mt-1 tabular-nums">
            {{ presentation.revision ?? '不可用' }}
          </dd>
        </div>
        <div class="p-3 border border-border rounded-lg bg-background min-w-0">
          <dt class="qs-type-compact-label">
            动作
          </dt>
          <dd class="qs-type-data mb-0 mt-1">
            {{ presentation.confirmLabel }}
          </dd>
        </div>
      </dl>

      <FaAlert
        :variant="presentation.destructive ? 'destructive' : 'default'"
        :icon="presentation.destructive ? 'i-lucide:triangle-alert' : 'i-lucide:info'"
        title="操作影响"
        :description="presentation.impact"
      />

      <p v-if="!presentation.canConfirm" class="qs-type-description m-0" role="status">
        当前详情缺少所需 revision，确认按钮已禁用；请刷新详情后重试。
      </p>
    </div>

    <template #footer>
      <FaButton
        variant="outline"
        data-testid="numbering-lifecycle-cancel"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="submitting"
        @click="cancel"
      >
        取消
      </FaButton>
      <FaButton
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        data-testid="numbering-lifecycle-confirm"
        :variant="presentation?.destructive ? 'destructive' : 'default'"
        :loading="submitting"
        :disabled="presentation === null || !presentation.canConfirm"
        @click="confirm"
      >
        {{ presentation?.confirmLabel ?? '确认' }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
