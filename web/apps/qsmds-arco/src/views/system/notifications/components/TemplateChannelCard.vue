<script setup lang="ts">
import type { NotificationTemplateDto } from '@/api/generated/types.gen'

import { computed } from 'vue'

import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import {
  messageKindLabel,
  splitTemplateBody,
} from '../template-key-grouping.logic'

const props = defineProps<{
  busy: boolean
  canUpdate: boolean
  channel: 'ASSISTANT' | 'IN_APP'
  template: NotificationTemplateDto | null
}>()

const emit = defineEmits<{
  add: [channel: 'ASSISTANT' | 'IN_APP']
  edit: [template: NotificationTemplateDto]
  preview: [template: NotificationTemplateDto]
  toggle: [template: NotificationTemplateDto, enabled: boolean]
}>()

const channelLabel = computed(() => props.channel === 'ASSISTANT' ? '千树小助理' : '站内通知')
const channelIcon = computed(() => props.channel === 'ASSISTANT' ? 'i-lucide:messages-square' : 'i-lucide:bell')
const channelIconClass = computed(() => props.channel === 'ASSISTANT'
  ? 'bg-primary/10 text-primary'
  : 'bg-sky-500/10 text-sky-600 dark:text-sky-300')
const previewSegments = computed(() => props.template === null ? [] : splitTemplateBody(props.template.bodyTemplate))
const linkSegments = computed(() => props.template?.linkUrlTemplate ? splitTemplateBody(props.template.linkUrlTemplate) : [])
</script>

<template>
  <article class="p-4 border border-border rounded-lg bg-background flex flex-col gap-3 h-full min-w-0">
    <div class="flex gap-2 items-center justify-between">
      <div class="flex gap-2 min-w-0 items-center">
        <span class="rounded-md flex shrink-0 size-7 items-center justify-center" :class="channelIconClass">
          <FaIcon :name="channelIcon" class="size-4" aria-hidden="true" />
        </span>
        <span class="qs-type-meta text-muted-foreground truncate">{{ channelLabel }}</span>
      </div>
      <label v-if="template !== null" class="qs-type-meta flex shrink-0 gap-1.5 items-center">
        启用
        <FaSwitch
          :model-value="template.enabled"
          :disabled="!canUpdate || busy"
          :aria-label="`${channelLabel}模板启用状态`"
          :title="template.enabled ? '点击停用' : '点击启用'"
          @update:model-value="emit('toggle', template, Boolean($event))"
        />
      </label>
      <FaTag v-else variant="outline" class="text-muted-foreground border-border bg-muted shrink-0">
        未配置
      </FaTag>
    </div>

    <template v-if="template !== null">
      <div class="flex flex-wrap gap-x-1.5 min-w-0 items-baseline">
        <p class="qs-type-body-medium text-foreground m-0 min-w-0 truncate" :title="template.name">
          {{ template.name }}
        </p>
        <span class="qs-type-meta text-muted-foreground whitespace-nowrap">
          (v{{ template.version }} · {{ messageKindLabel(template.messageKind) }})
        </span>
      </div>

      <div class="p-3 border border-border rounded-md bg-muted/30">
        <div
          class="template-preview-scroll overscroll-contain max-h-[240px] overflow-y-auto"
          role="region"
          tabindex="0"
          aria-label="模板正文预览"
        >
          <p class="qs-type-body m-0 pb-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
            <span
              v-for="(segment, index) in previewSegments"
              :key="index"
              :class="segment.token ? 'text-primary bg-primary/10 rounded px-0.5 font-mono' : ''"
            >{{ segment.text }}</span>
          </p>
        </div>
      </div>

      <div v-if="template.linkUrlTemplate" class="px-3 py-2 border border-border rounded-md bg-background flex gap-2 min-w-0 items-start">
        <FaIcon name="i-lucide:external-link" class="text-muted-foreground shrink-0 size-3.5" aria-hidden="true" />
        <span class="qs-type-meta text-muted-foreground shrink-0">跳转链接</span>
        <span
          class="text-[11px] text-foreground leading-4 font-mono flex-1 min-w-0 whitespace-normal break-all"
          :title="template.linkUrlTemplate"
        >
          <span
            v-for="(segment, index) in linkSegments"
            :key="index"
            :class="segment.token ? 'text-primary bg-primary/10 rounded px-0.5' : ''"
          >{{ segment.text }}</span>
        </span>
      </div>

      <div class="mt-auto pb-2 pt-2 border-t border-border flex flex-wrap gap-2 items-center justify-between -mb-4">
        <QsPersonDisplay :display-name="template.updatedByName?.trim() || '系统内置'" size="sm" />
        <div class="flex flex-wrap gap-2">
          <FaButton variant="outline" size="sm" @click="emit('preview', template)">
            预览
          </FaButton>
          <FaButton
            variant="outline"
            size="sm"
            class="text-primary border-primary/30 bg-primary/5 hover:bg-primary/10"
            :disabled="!canUpdate || busy"
            @click="emit('edit', template)"
          >
            编辑模板
          </FaButton>
        </div>
      </div>
    </template>

    <div v-else class="p-4 border border-border rounded-md border-dashed bg-muted/20 flex flex-1 flex-col gap-2 min-h-40 items-center justify-center">
      <FaIcon :name="channelIcon" class="text-muted-foreground size-5" aria-hidden="true" />
      <p class="qs-type-meta text-muted-foreground m-0">
        未配置{{ channelLabel }}
      </p>
      <FaButton
        variant="outline"
        size="sm"
        :disabled="!canUpdate || busy"
        @click="emit('add', channel)"
      >
        新增{{ channelLabel }}
      </FaButton>
    </div>
  </article>
</template>

<style scoped>
.template-preview-scroll {
  scrollbar-color: oklch(var(--border)) transparent;
  scrollbar-width: thin;
}

.template-preview-scroll::-webkit-scrollbar {
  width: 6px;
}

.template-preview-scroll::-webkit-scrollbar-thumb {
  background: oklch(var(--border));
  border-radius: 9999px;
}

.template-preview-scroll::-webkit-scrollbar-track {
  background: transparent;
}
</style>
