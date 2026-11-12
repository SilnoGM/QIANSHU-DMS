<script setup lang="ts">
import type {
  EventTableFilter,
  EventTableGroupRow,
  EventTableRow,
  NotificationChannelValue,
} from '../event-config.logic'
import type {
  NotificationChannelPolicyDto,
  NotificationEventDto,
  NotificationTemplateDto,
} from '@/api/generated/types.gen'
import type { QsGenericTableColumn, QsGenericTableGrouping } from '@/components/business/QsGenericTable/logic'

import { useMediaQuery } from '@vueuse/core'
import { computed, ref } from 'vue'
import { resolveActionColumnWidth } from '@/components/business/QsGenericTable/action-column-width'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import {
  buildEventCoverage,
  buildEventTableGroups,
  buildTemplateUsageCounts,
  findChannelPolicy,
} from '../event-config.logic'
import {
  ASSISTANT_ACTION_CLASS,
  channelStateClass,
  IN_APP_ACTION_CLASS,
  channelSummary as presentChannelSummary,
  eventStateClass as presentEventStateClass,
  eventStateLabel as presentEventStateLabel,
  updatedDateLabel,
} from '../event-config.presentation'
import { formatNotificationDateTime } from '../template-key-grouping.logic'
import EventChannelDrawer from './EventChannelDrawer.vue'
import EventConfigCards from './EventConfigCards.vue'
import EventFilterBar from './EventFilterBar.vue'

const props = defineProps<{
  busy: boolean
  canUpdatePolicy: boolean
  canUpdateTemplate: boolean
  canViewPolicy: boolean
  canViewTemplate: boolean
  events: readonly NotificationEventDto[]
  eventsError: string | null
  policies: readonly NotificationChannelPolicyDto[]
  policiesError: string | null
  templates: readonly NotificationTemplateDto[] | null
  templatesError: string | null
}>()

const emit = defineEmits<{
  createTemplate: [payload: { eventType: string, channel: NotificationChannelValue, key: string }]
  editTemplate: [payload: { eventType: string, template: NotificationTemplateDto }]
  previewTemplate: [template: NotificationTemplateDto]
  retry: []
  saved: [policy: NotificationChannelPolicyDto]
}>()

const EVENT_STATE_FALLBACK_CLASS = 'border-border bg-muted text-muted-foreground'

type TableRow = EventTableGroupRow | EventTableRow

const ACTION_COLUMN_WIDTH = resolveActionColumnWidth([
  { kind: 'text', chars: 4 },
  { kind: 'text', chars: 5 },
])

const keyword = ref('')
const statusFilter = ref<EventTableFilter>('ALL')
const drawerOpen = ref(false)
const drawerEventType = ref<string | null>(null)
const drawerChannel = ref<NotificationChannelValue>('IN_APP')
const drawerRef = ref<InstanceType<typeof EventChannelDrawer> | null>(null)
const isWide = useMediaQuery('(min-width: 1440px)')

const coverage = computed(() => buildEventCoverage(props.events, props.policies, props.templates))
const tableGroups = computed<EventTableGroupRow[]>(() => buildEventTableGroups(
  coverage.value,
  props.policies,
  { filter: statusFilter.value, keyword: keyword.value },
))
const usage = computed(() => buildTemplateUsageCounts(props.events, props.policies))

const drawerEvent = computed<NotificationEventDto | null>(() => drawerEventType.value === null
  ? null
  : props.events.find(event => event.eventType === drawerEventType.value) ?? null)

const drawerPolicy = computed<NotificationChannelPolicyDto | null>(() => drawerEvent.value === null
  ? null
  : findChannelPolicy(props.policies, drawerEvent.value.eventType, drawerChannel.value))

const grouping: QsGenericTableGrouping<TableRow> = {
  getRows: group => group.kind === 'domain' ? group.children : [],
  getLabel: group => group.label,
}

const tableColumns: QsGenericTableColumn<TableRow>[] = [
  {
    id: 'event',
    title: '事件',
    minWidth: 150,
    accessorFn: row => eventRow(row)?.label ?? '',
  },
  {
    id: 'state',
    title: '配置状态',
    width: 80,
    accessorFn: row => eventRow(row)?.coverage.state ?? '',
  },
  {
    id: 'inApp',
    title: '站内通知',
    minWidth: 130,
    accessorFn: row => eventRow(row)?.coverage.inApp.key ?? '',
  },
  {
    id: 'assistant',
    title: '千树小助理',
    minWidth: 130,
    accessorFn: row => eventRow(row)?.coverage.assistant.key ?? '',
  },
  {
    id: 'updatedAt',
    title: '策略更新',
    width: 145,
    accessorFn: row => eventRow(row)?.updatedAt ?? '',
  },
]

function eventRow(row: TableRow): EventTableRow | null {
  return row.kind === 'event' ? row : null
}

function eventStateLabel(row: TableRow): string {
  const item = eventRow(row)
  return item === null ? '—' : presentEventStateLabel(item.coverage)
}

function eventStateClass(row: TableRow): string {
  const item = eventRow(row)
  return item === null ? EVENT_STATE_FALLBACK_CLASS : presentEventStateClass(item.coverage)
}

function channelSummary(row: TableRow, channel: NotificationChannelValue): ReturnType<typeof presentChannelSummary> {
  const item = eventRow(row)
  return item === null
    ? { key: null, label: '—', source: '', state: 'UNCONFIGURED' }
    : presentChannelSummary(item.coverage, channel)
}

function groupReadyCount(rows: readonly TableRow[]): number {
  return rows.filter(row => eventRow(row)?.coverage.state === 'READY').length
}

function openDrawer(eventType: string, channel: NotificationChannelValue): void {
  drawerEventType.value = eventType
  drawerChannel.value = channel
  drawerOpen.value = true
}

defineExpose({
  hasDirty: () => drawerRef.value?.hasDirty() === true,
  discard: () => drawerRef.value?.discard(),
})
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="notification-event-config">
    <FaAlert v-if="!canViewPolicy" title="当前账号没有策略查看权限，无法判断事件配置状态。" />
    <FaAlert v-else-if="eventsError !== null" variant="destructive" :title="eventsError">
      <template #actions>
        <FaButton variant="outline" size="sm" :disabled="busy" @click="emit('retry')">
          重试
        </FaButton>
      </template>
    </FaAlert>
    <FaAlert v-else-if="policiesError !== null" variant="destructive" :title="policiesError">
      <template #actions>
        <FaButton variant="outline" size="sm" :disabled="busy" @click="emit('retry')">
          重试
        </FaButton>
      </template>
    </FaAlert>
    <FaAlert v-if="!canViewTemplate" title="当前账号没有模板查看权限，只能配置投递目标。" />
    <FaAlert v-if="templatesError !== null" variant="destructive" :title="templatesError">
      <template #actions>
        <FaButton variant="outline" size="sm" :disabled="busy" @click="emit('retry')">
          重试
        </FaButton>
      </template>
    </FaAlert>

    <EventFilterBar
      v-if="!isWide"
      v-model:keyword="keyword"
      v-model:status="statusFilter"
    />

    <QsGenericTable
      v-if="isWide"
      :columns="tableColumns"
      :data="tableGroups"
      :grouping="grouping"
      :action-column="{ width: ACTION_COLUMN_WIDTH, minWidth: ACTION_COLUMN_WIDTH }"
      :addable="false"
      :searchable="false"
      :show-column-settings="true"
      :show-pagination="false"
      :show-row-number="false"
      :loading="busy"
      row-key="id"
      empty-title="暂无可配置事件"
      empty-description="调整搜索或状态筛选后再试。"
      table-class="w-full"
      data-testid="notification-event-table"
    >
      <template #query-leading>
        <EventFilterBar v-model:keyword="keyword" v-model:status="statusFilter" />
      </template>

      <template #group-header="{ row, rows }">
        <div class="flex flex-wrap gap-2 min-w-0 w-full items-center justify-between">
          <span class="qs-type-body-medium">{{ row.label }}</span>
          <span class="flex flex-wrap gap-2 items-center">
            <span class="qs-type-meta text-muted-foreground">{{ rows.length }} 个事件</span>
            <FaTag v-if="groupReadyCount(rows) > 0" variant="outline" class="text-primary border-primary/30 bg-primary/10">
              已配齐 {{ groupReadyCount(rows) }}
            </FaTag>
          </span>
        </div>
      </template>

      <template #cell-event="{ row }">
        <div class="flex flex-col gap-0.5 min-w-0">
          <span
            class="qs-type-body-medium truncate"
            :title="eventRow(row.original)?.event.eventType"
          >
            {{ eventRow(row.original)?.label }}
          </span>
          <span
            v-if="eventRow(row.original)?.event.implemented === false && eventRow(row.original)?.coverage.state !== 'UNCONFIGURED'"
            class="qs-type-meta text-muted-foreground"
          >
            未接入
          </span>
        </div>
      </template>

      <template #cell-state="{ row }">
        <FaTag variant="outline" :class="eventStateClass(row.original)">
          {{ eventStateLabel(row.original) }}
        </FaTag>
      </template>

      <template #cell-inApp="{ row }">
        <div class="flex flex-col gap-1 min-w-0">
          <FaTag variant="outline" class="w-fit" :class="channelStateClass(channelSummary(row.original, 'IN_APP').state)">
            {{ channelSummary(row.original, 'IN_APP').label }}
          </FaTag>
          <span class="qs-type-meta text-muted-foreground break-all">
            <template v-if="channelSummary(row.original, 'IN_APP').key !== null">
              {{ channelSummary(row.original, 'IN_APP').source }} · {{ channelSummary(row.original, 'IN_APP').key }}
            </template>
            <template v-else>未指定模板</template>
          </span>
        </div>
      </template>

      <template #cell-assistant="{ row }">
        <div class="flex flex-col gap-1 min-w-0">
          <FaTag variant="outline" class="w-fit" :class="channelStateClass(channelSummary(row.original, 'ASSISTANT').state)">
            {{ channelSummary(row.original, 'ASSISTANT').label }}
          </FaTag>
          <span class="qs-type-meta text-muted-foreground break-all">
            <template v-if="channelSummary(row.original, 'ASSISTANT').key !== null">
              {{ channelSummary(row.original, 'ASSISTANT').source }} · {{ channelSummary(row.original, 'ASSISTANT').key }}
            </template>
            <template v-else>未指定模板</template>
          </span>
        </div>
      </template>

      <template #cell-updatedAt="{ row }">
        <div class="flex flex-col gap-0.5 min-w-0">
          <QsPersonDisplay :display-name="eventRow(row.original)?.updatedByName ?? '—'" size="md" />
          <span
            class="qs-type-meta text-muted-foreground whitespace-nowrap"
            :title="formatNotificationDateTime(eventRow(row.original)?.updatedAt ?? null)"
          >
            {{ updatedDateLabel(eventRow(row.original)?.updatedAt ?? null) }}
          </span>
        </div>
      </template>

      <template #actions="{ row }">
        <div class="flex flex-wrap gap-1 items-center">
          <FaButton
            variant="outline"
            size="sm"
            :class="IN_APP_ACTION_CLASS"
            @click="openDrawer(eventRow(row)!.event.eventType, 'IN_APP')"
          >
            站内配置
          </FaButton>
          <FaButton
            variant="outline"
            size="sm"
            :class="ASSISTANT_ACTION_CLASS"
            @click="openDrawer(eventRow(row)!.event.eventType, 'ASSISTANT')"
          >
            小助理配置
          </FaButton>
        </div>
      </template>
    </QsGenericTable>

    <EventConfigCards
      v-else
      :groups="tableGroups"
      :busy="busy"
      @configure="openDrawer"
    />

    <EventChannelDrawer
      v-if="drawerEvent !== null"
      ref="drawerRef"
      v-model="drawerOpen"
      :event="drawerEvent"
      :channel="drawerChannel"
      :policy="drawerPolicy"
      :templates="templates"
      :usage="usage"
      :busy="busy"
      :can-update-policy="canUpdatePolicy && policiesError === null"
      :can-update-template="canUpdateTemplate"
      :can-view-template="canViewTemplate"
      @saved="emit('saved', $event)"
      @edit-template="emit('editTemplate', $event)"
      @preview-template="emit('previewTemplate', $event)"
      @create-template="emit('createTemplate', $event)"
    />
  </section>
</template>
