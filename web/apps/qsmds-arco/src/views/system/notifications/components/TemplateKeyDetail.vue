<script setup lang="ts">
import type { TemplateKeyGroup } from '../template-key-grouping.logic'
import type { NotificationTemplateDto } from '@/api/generated/types.gen'

import { computed } from 'vue'

import { useQsToast } from '@/components/base/QsToast/useQsToast'
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

const toast = useQsToast()

async function copyKey(): Promise<void> {
  if (props.group === null) {
    return
  }
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is unavailable')
    }
    await navigator.clipboard.writeText(props.group.key)
    toast.success('模板 Key 已复制')
  }
  catch {
    toast.error('复制失败，请手动选择模板 Key')
  }
}

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
          <span class="qs-type-body-medium text-foreground">{{ group.displayName }}</span>
          <FaTag variant="outline" :class="templateDomainClass(group.domain)">
            {{ templateDomainLabel(group.domain) }}
          </FaTag>
          <span class="qs-type-data-emphasis break-all">{{ group.key }}</span>
          <FaButton variant="ghost" size="sm" class="text-muted-foreground" @click="copyKey">
            <FaIcon name="i-lucide:copy" class="size-3.5" aria-hidden="true" />
            复制 Key
          </FaButton>
        </div>
        <p class="qs-type-meta text-muted-foreground m-0 mt-1.5">
          <template v-if="group.channelCount === 2">
            该模板键下共配置了 2 个发送渠道，调用接口时将按启用状态自动路由。
          </template>
          <template v-else>
            该模板键下已配置 1 个发送渠道，可补齐另一渠道。
          </template>
        </p>
      </div>
      <div class="flex flex-wrap gap-2 items-center">
        <span
          v-if="group.channelCount === 2"
          class="qs-type-meta text-muted-foreground inline-flex gap-1 items-center"
        >
          <FaIcon name="i-lucide:check" class="text-emerald-600 size-3.5 dark:text-emerald-400" aria-hidden="true" />
          渠道已配齐 (2/2)
        </span>
        <FaTag
          v-else
          variant="outline"
          class="text-amber-700 border-amber-500/30 bg-amber-500/10 dark:text-amber-300"
        >
          缺少 1 个渠道
        </FaTag>
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
