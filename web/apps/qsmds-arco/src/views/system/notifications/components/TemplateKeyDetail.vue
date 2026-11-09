<script setup lang="ts">
import type { TemplateKeyGroup } from '../template-key-grouping.logic'
import type { NotificationTemplateDto } from '@/api/generated/types.gen'

import { computed } from 'vue'

import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import {
  templateDomainClass,
  templateDomainLabel,
} from '../template-key-grouping.logic'
import TemplateChannelCard from './TemplateChannelCard.vue'

const props = defineProps<{
  busy: boolean
  canUpdate: boolean
  group: TemplateKeyGroup | null
}>()

const emit = defineEmits<{
  add: [channel: 'ASSISTANT' | 'IN_APP']
  edit: [template: NotificationTemplateDto]
  preview: [template: NotificationTemplateDto]
  toggle: [template: NotificationTemplateDto, enabled: boolean]
}>()

const missingChannel = computed<'' | 'ASSISTANT' | 'IN_APP'>(() => {
  if (props.group === null || (props.group.assistant !== null && props.group.inApp !== null)) {
    return ''
  }
  return props.group.assistant === null ? 'ASSISTANT' : 'IN_APP'
})
</script>

<template>
  <div v-if="group === null" class="p-6 flex flex-col gap-2 h-full min-h-48 items-center justify-center">
    <FaIcon name="i-lucide:mail-search" class="text-muted-foreground size-6" aria-hidden="true" />
    <p class="qs-type-meta text-muted-foreground m-0">
      从左侧选择一个模板键查看渠道模板。
    </p>
  </div>

  <div v-else class="p-4 flex flex-col gap-4 min-w-0 sm:p-5">
    <div class="flex flex-wrap gap-3 items-start justify-between">
      <div class="min-w-0">
        <div class="flex flex-wrap gap-2 items-center">
          <FaTag variant="outline" :class="templateDomainClass(group.domain)">
            {{ templateDomainLabel(group.domain) }}
          </FaTag>
          <span class="qs-type-data-emphasis break-all">{{ group.key }}</span>
          <CopyCellButton :text="group.key" label="模板 Key" always-visible />
        </div>
        <p class="qs-type-meta text-muted-foreground m-0 mt-1.5">
          <template v-if="group.channelCount === 2">
            该模板键下共配置了 2 个分发渠道，调用接口时将按启用状态自动路由。
          </template>
          <template v-else>
            该模板键下已配置 1 个分发渠道，可补齐另一渠道。
          </template>
        </p>
      </div>
      <FaButton
        v-if="missingChannel !== ''"
        variant="outline"
        size="sm"
        class="border-dashed"
        :disabled="!canUpdate || busy"
        @click="emit('add', missingChannel)"
      >
        <FaIcon name="i-lucide:plus" class="size-4" aria-hidden="true" />
        新增渠道模板
      </FaButton>
    </div>

    <div class="gap-4 grid lg:grid-cols-2">
      <TemplateChannelCard
        channel="ASSISTANT"
        :template="group.assistant"
        :can-update="canUpdate"
        :busy="busy"
        @add="emit('add', $event)"
        @edit="emit('edit', $event)"
        @preview="emit('preview', $event)"
        @toggle="(template, enabled) => emit('toggle', template, enabled)"
      />
      <TemplateChannelCard
        channel="IN_APP"
        :template="group.inApp"
        :can-update="canUpdate"
        :busy="busy"
        @add="emit('add', $event)"
        @edit="emit('edit', $event)"
        @preview="emit('preview', $event)"
        @toggle="(template, enabled) => emit('toggle', template, enabled)"
      />
    </div>
  </div>
</template>
