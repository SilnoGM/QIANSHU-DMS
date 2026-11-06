<script setup lang="ts">
import type { MachineViewingDto } from '@/api/generated/types.gen'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { formatMachineViewingTime } from '@/utils/machine-viewing-schedule'
import { machineViewingStatusMeta } from '@/utils/machine-viewing-status'
import { resolveStatusTagToneClass } from '@/utils/status-tag-tone'

withDefaults(defineProps<{
  modelValue: boolean
  record?: MachineViewingDto | null
}>(), { record: null })

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()

function close(value = false): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('machineViewing.feedback.title')"
    size="md"
    @update:model-value="close"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:message-square-text" class="text-primary size-5" />
    </template>
    <div v-if="record" class="min-w-0 space-y-4">
      <dl class="gap-3 grid grid-cols-1 sm:grid-cols-2">
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('machineViewing.column.appointmentNo') }}
          </dt>
          <dd class="qs-type-data-emphasis mt-1 break-all">
            {{ record.appointmentNo }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('machineViewing.column.status') }}
          </dt>
          <dd class="mt-1">
            <span
              class="qs-type-tag px-2 py-0.5 border rounded-md whitespace-nowrap"
              :class="resolveStatusTagToneClass(machineViewingStatusMeta(record.status).tone)"
            >
              {{ t(machineViewingStatusMeta(record.status).labelKey) }}
            </span>
          </dd>
        </div>
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('machineViewing.column.customerName') }}
          </dt>
          <dd class="mt-1 break-words">
            {{ record.customerName }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-meta text-muted-foreground">
            {{ t('machineViewing.column.appointmentTime') }}
          </dt>
          <dd class="qs-type-data mt-1">
            {{ formatMachineViewingTime(t, record) }}
          </dd>
        </div>
      </dl>
      <div class="pt-4 border-t border-border">
        <div class="qs-type-meta text-muted-foreground">
          {{ t('machineViewing.feedback.content') }}
        </div>
        <p class="qs-type-body mt-2 whitespace-pre-wrap break-words">
          {{ record.feedback }}
        </p>
      </div>
    </div>
    <template #footer>
      <FaButton variant="outline" class="w-full sm:w-auto" @click="close()">
        {{ t('machineViewing.feedback.close') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
