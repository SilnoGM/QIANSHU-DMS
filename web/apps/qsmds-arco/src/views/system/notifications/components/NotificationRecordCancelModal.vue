<script setup lang="ts">
import type { NotificationRecordDto } from '@/api/generated/types.gen'
import { computed } from 'vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { pendingDeliveryCount } from '../records.logic'

const props = defineProps<{
  error: string | null
  modelValue: boolean
  record: NotificationRecordDto | null
  submitting: boolean
}>()

const emit = defineEmits<{
  'confirm': []
  'update:modelValue': [value: boolean]
}>()

const pendingCount = computed(() => props.record === null ? 0 : pendingDeliveryCount(props.record))
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="取消未发送交付"
    description="站内通知不受影响，仅取消小助理渠道尚未发送的交付。"
    size="sm"
    :z-index="2200"
    :submitting="submitting"
    :error="error"
    error-title="取消失败"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="record !== null" class="flex flex-col gap-4">
      <div class="p-3 border border-border rounded-lg bg-muted/20">
        <p class="qs-type-body-medium m-0">
          {{ record.eventLabel }}
        </p>
        <p class="qs-type-meta text-muted-foreground m-0 mt-1 break-all">
          {{ record.id }}
        </p>
      </div>

      <div class="p-3 border border-amber-500/30 rounded-lg bg-amber-500/10">
        <p class="text-sm text-amber-800 font-medium m-0 dark:text-amber-200">
          将取消 {{ pendingCount }} 条待发送交付
        </p>
        <p class="qs-type-meta text-amber-700/90 m-0 mt-1 dark:text-amber-200/80">
          此操作不可撤销；已发送或发送中的交付不会被更改。
        </p>
      </div>
    </div>

    <template #footer>
      <FaButton variant="outline" :disabled="submitting" @click="emit('update:modelValue', false)">
        返回
      </FaButton>
      <FaButton variant="destructive" :loading="submitting" @click="emit('confirm')">
        确认取消
      </FaButton>
    </template>
  </QsGenericModal>
</template>
