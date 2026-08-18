<script setup lang="ts">
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

defineOptions({ name: 'FundConfigurationConfirmModal' })

const props = withDefaults(defineProps<{
  action: ConfirmAction
  error?: null | string
  modelValue: boolean
  requestId?: null | string
  submitting?: boolean
  targetCode: string
  targetName: string
}>(), {
  error: null,
  requestId: null,
  submitting: false,
})

const emit = defineEmits<{
  'confirm': []
  'update:modelValue': [value: boolean]
}>()

type ConfirmAction = 'disable' | 'enable' | 'publish'

const content = computed(() => {
  if (props.action === 'publish') {
    return {
      button: '确认发布',
      description: '发布后当前草稿成为新的生效版本，旧生效版本会退役且历史批次仍保留原版本快照。',
      title: '发布规则草稿',
    }
  }
  if (props.action === 'disable') {
    return {
      button: '确认停用',
      description: '停用后将拒绝新的业务调用；历史批次、流水和快照不受影响。',
      title: '停用配置',
    }
  }
  return {
    button: '确认启用',
    description: '启用后配置可参与新的业务调用，仍由来源允许范围和生效规则共同约束。',
    title: '启用配置',
  }
})

function close(): void {
  if (!props.submitting) {
    emit('update:modelValue', false)
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="content.title"
    :description="content.description"
    size="sm"
    :submitting="submitting"
    @update:model-value="value => value ? emit('update:modelValue', true) : close()"
  >
    <FaAlert
      v-if="error"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="操作失败"
      class="mb-4"
      role="alert"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ error }}</span>
          <code v-if="requestId" class="qs-type-meta break-all">requestId: {{ requestId }}</code>
        </div>
      </template>
    </FaAlert>

    <div class="p-4 border border-border rounded-lg bg-muted/25">
      <div class="qs-type-data-emphasis break-words">
        {{ targetName }}
      </div>
      <code class="qs-type-meta mt-1 block break-all">{{ targetCode }}</code>
    </div>

    <template #footer>
      <FaButton variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="submitting" @click="close">
        取消
      </FaButton>
      <FaButton
        :variant="action === 'disable' ? 'destructive' : 'default'"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :loading="submitting"
        :disabled="submitting"
        @click="emit('confirm')"
      >
        {{ content.button }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
