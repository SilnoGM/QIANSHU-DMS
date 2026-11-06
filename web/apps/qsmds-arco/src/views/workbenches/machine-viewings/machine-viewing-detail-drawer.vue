<script setup lang="ts">
import type { MachineViewingDto } from '@/api/generated/types.gen'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
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
  <QsGenericDrawer
    :model-value="modelValue"
    :title="t('machineViewing.detail.title')"
    :description="record?.appointmentNo"
    size="lg"
    @update:model-value="close"
  >
    <template #header-leading>
      <FaIcon name="i-lucide:calendar-check" class="size-5" />
    </template>

    <div v-if="record" class="min-w-0 space-y-6">
      <section>
        <h3 class="qs-type-body-medium text-foreground">
          {{ t('machineViewing.detail.appointment') }}
        </h3>
        <dl class="mt-3 gap-3 grid grid-cols-1 sm:grid-cols-2">
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
              {{ t('machineViewing.column.appointmentTime') }}
            </dt>
            <dd class="qs-type-data mt-1">
              {{ formatMachineViewingTime(t, record) }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('machineViewing.column.site') }}
            </dt>
            <dd class="mt-1">
              {{ t(`machineViewing.site.${record.site}`) }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('machineViewing.column.machineType') }}
            </dt>
            <dd class="mt-1">
              {{ t(`machineViewing.machineType.${record.machineType}`) }}
            </dd>
          </div>
        </dl>
      </section>

      <section class="pt-5 border-t border-border">
        <h3 class="qs-type-body-medium text-foreground">
          {{ t('machineViewing.detail.customer') }}
        </h3>
        <dl class="mt-3 gap-3 grid grid-cols-1 sm:grid-cols-2">
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
              {{ t('machineViewing.column.customerPhone') }}
            </dt>
            <dd class="qs-type-data mt-1 break-all">
              {{ record.customerPhone ?? t('machineViewing.noPhone') }}
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t('machineViewing.column.contactPerson') }}
            </dt>
            <dd class="mt-1 break-words">
              {{ record.contactPerson }}
            </dd>
          </div>
        </dl>
      </section>

      <section class="pt-5 border-t border-border">
        <h3 class="qs-type-body-medium text-foreground">
          {{ t('machineViewing.detail.feedback') }}
        </h3>
        <p
          v-if="record.feedback"
          class="qs-type-body mt-3 px-4 py-3 rounded-lg bg-muted/40 whitespace-pre-wrap break-words"
        >
          {{ record.feedback }}
        </p>
        <p v-else class="qs-type-body text-muted-foreground mt-3">
          {{ t('machineViewing.feedback.none') }}
        </p>
      </section>

      <section class="pt-5 border-t border-border">
        <h3 class="qs-type-body-medium text-foreground">
          {{ t('machineViewing.detail.submitted') }}
        </h3>
        <div class="mt-3 flex flex-wrap gap-3 items-center justify-between">
          <QsPersonDisplay :display-name="record.createdBy.name" size="sm" :avatar-url="record.createdBy.avatarUrl" />
          <DateTimeDisplay :value="record.createdAt" />
        </div>
      </section>
    </div>

    <template #footer>
      <FaButton variant="outline" class="w-full sm:w-auto" @click="close()">
        {{ t('machineViewing.detail.close') }}
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
