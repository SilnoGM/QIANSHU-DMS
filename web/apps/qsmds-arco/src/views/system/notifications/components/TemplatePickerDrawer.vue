<script setup lang="ts">
import type { NotificationEventDto, NotificationTemplateDto } from '@/api/generated/types.gen'

import { computed, ref } from 'vue'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { templateIncompatibleVariables, templateUsageCount } from '../event-config.logic'
import { templateDomainClass, templateDomainLabel } from '../template-key-grouping.logic'

const props = defineProps<{
  busy: boolean
  canUpdatePolicy: boolean
  canUpdateTemplate: boolean
  channel: 'IN_APP' | 'ASSISTANT'
  event: NotificationEventDto
  selectedKey: string | null
  templates: readonly NotificationTemplateDto[]
  usage: ReadonlyMap<string, Set<string>>
}>()

const emit = defineEmits<{
  create: [key: string]
  preview: [template: NotificationTemplateDto]
  select: [key: string]
}>()

const open = defineModel<boolean>('open', { required: true })
const keyword = ref('')
const onlyCompatible = ref(true)

interface TemplateCandidate {
  template: NotificationTemplateDto
  snippet: string
  incompatible: string[]
  usageCount: number
}

const channelLabel = computed(() => props.channel === 'ASSISTANT' ? '千树小助理' : '站内通知')

const allCandidates = computed<TemplateCandidate[]>(() => {
  const normalized = keyword.value.trim().toLowerCase()
  return props.templates
    .filter(template => template.channel === props.channel)
    .map(template => ({
      template,
      snippet: template.bodyTemplate.replace(/\s+/gu, ' ').trim().slice(0, 80),
      incompatible: templateIncompatibleVariables(template, props.event),
      usageCount: templateUsageCount(props.usage, template.key),
    }))
    .filter((item) => {
      if (normalized.length === 0) {
        return true
      }
      return [item.template.name, item.template.key, templateDomainLabel(item.template.domain)]
        .some(value => value.toLowerCase().includes(normalized))
    })
    .sort((left, right) => (left.incompatible.length - right.incompatible.length)
      || left.template.name.localeCompare(right.template.name, 'zh-CN')
      || left.template.key.localeCompare(right.template.key))
})

const incompatibleCount = computed(() => allCandidates.value.filter(item => item.incompatible.length > 0).length)
const candidates = computed(() => onlyCompatible.value
  ? allCandidates.value.filter(item => item.incompatible.length === 0)
  : allCandidates.value)

function select(key: string): void {
  emit('select', key)
  open.value = false
}

function choose(item: TemplateCandidate): void {
  if (item.incompatible.length > 0 || !props.canUpdatePolicy || props.busy) {
    return
  }
  select(item.template.key)
}
</script>

<template>
  <QsGenericModal
    v-model="open"
    :title="`选择模板 · ${channelLabel}`"
    description="只列同渠道模板；含事件不提供变量的模板不可选。"
    size="xl"
    :z-index="2200"
  >
    <div class="flex flex-col gap-3" data-testid="notification-template-picker">
      <div class="flex flex-wrap gap-2 items-center">
        <FaInput
          v-model="keyword"
          type="search"
          clearable
          class="flex-1 min-w-52"
          placeholder="搜索模板"
          aria-label="搜索模板"
        >
          <template #start>
            <FaIcon name="i-lucide:search" />
          </template>
        </FaInput>
        <label class="qs-type-meta flex flex-wrap gap-2 items-center">
          <FaSwitch v-model="onlyCompatible" aria-label="仅看可绑定模板" />
          仅看可绑定
          <span v-if="incompatibleCount > 0" class="text-muted-foreground">
            （隐藏 {{ incompatibleCount }} 个不兼容）
          </span>
        </label>
      </div>

      <div class="pb-3 border-b border-border flex flex-wrap gap-2">
        <FaButton
          variant="outline"
          size="sm"
          :disabled="!canUpdateTemplate || busy"
          @click="emit('create', event.defaultTemplateKey ?? '')"
        >
          <FaIcon name="i-lucide:plus" class="size-4" aria-hidden="true" />
          新建模板
        </FaButton>
        <FaButton
          v-if="event.defaultTemplateKey !== null"
          variant="ghost"
          size="sm"
          :disabled="!canUpdatePolicy || busy || selectedKey === null || selectedKey === event.defaultTemplateKey"
          @click="select('')"
        >
          恢复业务默认模板
        </FaButton>
        <span v-if="event.defaultTemplateKey !== null" class="qs-type-meta text-muted-foreground self-center">
          默认键 {{ event.defaultTemplateKey }}
        </span>
      </div>

      <FaEmpty
        v-if="candidates.length === 0"
        icon="i-lucide:search-x"
        title="没有匹配的模板"
        :description="onlyCompatible && incompatibleCount > 0
          ? '没有可绑定的模板，可关闭「仅看可绑定」查看不兼容项。'
          : '调整搜索关键词后再试。'"
        class="py-8"
      />

      <div v-else class="gap-3 grid md:grid-cols-2">
        <div
          v-for="item in candidates"
          :key="item.template.id"
          role="button"
          :tabindex="item.incompatible.length > 0 || !canUpdatePolicy || busy ? -1 : 0"
          :aria-disabled="item.incompatible.length > 0 || !canUpdatePolicy || busy ? 'true' : undefined"
          class="p-3 text-left border rounded-lg bg-background flex flex-col gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          :class="[
            item.template.key === selectedKey ? 'border-primary/40 bg-primary/5' : 'border-border',
            item.incompatible.length > 0 || !canUpdatePolicy || busy
              ? 'opacity-70 cursor-not-allowed'
              : 'cursor-pointer hover:bg-muted/40',
          ]"
          @click="choose(item)"
          @keydown.enter="choose(item)"
          @keydown.space.prevent="choose(item)"
        >
          <span class="flex flex-wrap gap-2 items-center justify-between">
            <span class="flex gap-1.5 min-w-0 items-baseline">
              <span class="qs-type-body-medium min-w-0 truncate">{{ item.template.name }}</span>
              <span class="qs-type-meta text-muted-foreground whitespace-nowrap">v{{ item.template.version }}</span>
            </span>
            <span class="flex flex-wrap gap-1.5 items-center">
              <FaTag variant="outline" :class="templateDomainClass(item.template.domain)">
                {{ templateDomainLabel(item.template.domain) }}
              </FaTag>
              <FaTag v-if="!item.template.enabled" variant="outline" class="text-red-600 border-red-500/30 bg-red-500/10 dark:text-red-400">
                已停用
              </FaTag>
              <FaTag v-if="item.incompatible.length > 0" variant="outline" class="text-amber-700 border-amber-500/30 bg-amber-500/10 dark:text-amber-300">
                不兼容
              </FaTag>
              <FaTag v-if="item.template.key === selectedKey" variant="outline" class="text-primary border-primary/30 bg-primary/10">
                当前
              </FaTag>
            </span>
          </span>
          <code class="qs-type-meta text-muted-foreground break-all">{{ item.template.key }}</code>
          <span v-if="item.snippet.length > 0" class="qs-type-meta text-muted-foreground line-clamp-2">
            {{ item.snippet }}
          </span>
          <span class="flex flex-wrap gap-2 items-center justify-between">
            <span class="qs-type-meta text-muted-foreground">
              被 {{ item.usageCount }} 个事件使用
              <template v-if="item.incompatible.length > 0">
                · 不兼容变量：{{ item.incompatible.join('、') }}
              </template>
            </span>
            <FaButton variant="ghost" size="sm" :disabled="busy" @click.stop="emit('preview', item.template)">
              预览
            </FaButton>
          </span>
        </div>
      </div>
    </div>

    <template #footer>
      <FaButton variant="outline" @click="open = false">
        关闭
      </FaButton>
    </template>
  </QsGenericModal>
</template>
