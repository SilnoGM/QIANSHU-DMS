<script setup lang="ts">
import type { EventTableGroupRow, NotificationChannelValue } from '../event-config.logic'

import {
  ASSISTANT_ACTION_CLASS,
  channelStateClass,
  channelSummary,
  eventStateClass,
  eventStateLabel,
  IN_APP_ACTION_CLASS,
  updatedDateLabel,
} from '../event-config.presentation'
import { formatNotificationDateTime } from '../template-key-grouping.logic'

defineProps<{
  busy: boolean
  groups: readonly EventTableGroupRow[]
}>()

const emit = defineEmits<{
  configure: [eventType: string, channel: NotificationChannelValue]
}>()

function groupReadyCount(group: EventTableGroupRow): number {
  return group.children.filter(row => row.coverage.state === 'READY').length
}

function isUnimplementedConfigured(row: EventTableGroupRow['children'][number]): boolean {
  return !row.event.implemented && row.coverage.state !== 'UNCONFIGURED'
}
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="notification-event-cards">
    <FaEmpty
      v-if="groups.length === 0"
      icon="i-lucide:search-x"
      title="暂无可配置事件"
      description="调整搜索或状态筛选后再试。"
      class="py-10"
    />

    <section v-for="group in groups" :key="group.id" class="flex flex-col gap-2">
      <div class="px-1 flex flex-wrap gap-2 min-w-0 w-full items-center justify-between">
        <span class="qs-type-body-medium">{{ group.label }}</span>
        <span class="flex flex-wrap gap-2 items-center">
          <span class="qs-type-meta text-muted-foreground">{{ group.children.length }} 个事件</span>
          <FaTag v-if="groupReadyCount(group) > 0" variant="outline" class="text-primary border-primary/30 bg-primary/10">
            已配齐 {{ groupReadyCount(group) }}
          </FaTag>
        </span>
      </div>

      <div class="gap-3 grid xl:grid-cols-2">
        <article
          v-for="row in group.children"
          :key="row.id"
          class="p-4 border border-border rounded-xl bg-background flex flex-col gap-3 min-w-0"
        >
          <header class="flex flex-wrap gap-2 items-center justify-between">
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="flex flex-wrap gap-1.5 items-baseline">
                <span class="qs-type-body-medium truncate">{{ row.label }}</span>
                <span v-if="isUnimplementedConfigured(row)" class="qs-type-meta text-muted-foreground">未接入</span>
              </span>
              <code class="qs-type-meta text-muted-foreground break-all">{{ row.event.eventType }}</code>
            </div>
            <FaTag variant="outline" :class="eventStateClass(row.coverage)">
              {{ eventStateLabel(row.coverage) }}
            </FaTag>
          </header>

          <div class="gap-2 grid sm:grid-cols-2">
            <div
              v-for="channel in (['IN_APP', 'ASSISTANT'] as const)"
              :key="channel"
              class="p-3 border border-border rounded-md bg-muted/20 flex flex-col gap-2 min-w-0"
            >
              <div class="flex flex-wrap gap-2 items-center justify-between">
                <span class="qs-type-meta text-muted-foreground">{{ channel === 'IN_APP' ? '站内通知' : '千树小助理' }}</span>
                <FaTag variant="outline" :class="channelStateClass(channelSummary(row.coverage, channel).state)">
                  {{ channelSummary(row.coverage, channel).label }}
                </FaTag>
              </div>
              <p class="qs-type-meta text-muted-foreground m-0 break-all">
                <template v-if="channelSummary(row.coverage, channel).key !== null">
                  {{ channelSummary(row.coverage, channel).source }} · {{ channelSummary(row.coverage, channel).key }}
                </template>
                <template v-else>
                  未指定模板
                </template>
              </p>
              <FaButton
                variant="outline"
                size="sm"
                class="mt-auto w-full"
                :class="channel === 'IN_APP' ? IN_APP_ACTION_CLASS : ASSISTANT_ACTION_CLASS"
                :disabled="busy"
                @click="emit('configure', row.event.eventType, channel)"
              >
                {{ channel === 'IN_APP' ? '站内配置' : '小助理配置' }}
              </FaButton>
            </div>
          </div>

          <footer class="qs-type-meta text-muted-foreground pt-3 border-t border-border flex flex-wrap gap-1 justify-between">
            <span>策略更新：{{ row.updatedByName ?? '—' }}</span>
            <span :title="formatNotificationDateTime(row.updatedAt)">
              {{ updatedDateLabel(row.updatedAt) }}
            </span>
          </footer>
        </article>
      </div>
    </section>
  </div>
</template>
