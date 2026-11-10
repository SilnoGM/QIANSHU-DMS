<script setup lang="ts">
import type { TemplateDomain } from '../template-key-grouping.logic'
import type { NotificationTemplateDto } from '@/api/generated/types.gen'

import { computed, ref, watch } from 'vue'

import { templateUsageCount } from '../event-config.logic'
import {
  filterTemplateDomainGroups,
  groupTemplateKeysByDomain,
  groupTemplatesByKey,
} from '../template-key-grouping.logic'
import TemplateDomainRail from './TemplateDomainRail.vue'
import TemplateKeyDetail from './TemplateKeyDetail.vue'

const props = defineProps<{
  busy: boolean
  canUpdate: boolean
  loadingError: string | null
  templates: readonly NotificationTemplateDto[]
  usage: ReadonlyMap<string, Set<string>>
}>()

const emit = defineEmits<{
  add: [payload: { key: string, domain: TemplateDomain, channel: 'ASSISTANT' | 'IN_APP' }]
  create: []
  edit: [template: NotificationTemplateDto]
  preview: [template: NotificationTemplateDto]
  toggle: [template: NotificationTemplateDto, enabled: boolean]
}>()

const templateSearch = ref('')
const selectedTemplateKey = ref<string | null>(null)

const templateKeyGroups = computed(() => groupTemplatesByKey(props.templates))
const templateDomainGroups = computed(() => groupTemplateKeysByDomain(templateKeyGroups.value))
const visibleTemplateDomainGroups = computed(() => filterTemplateDomainGroups(templateDomainGroups.value, templateSearch.value))
const selectedTemplateGroup = computed(() => {
  const current = templateKeyGroups.value.find(group => group.key === selectedTemplateKey.value)
  if (current !== undefined) {
    return current
  }
  return visibleTemplateDomainGroups.value[0]?.keys[0] ?? null
})
const selectedUsageCount = computed(() => selectedTemplateGroup.value === null
  ? 0
  : templateUsageCount(props.usage, selectedTemplateGroup.value.key))

watch(
  visibleTemplateDomainGroups,
  (groups) => {
    const visibleKeys = groups.flatMap(group => group.keys)
    if (!visibleKeys.some(group => group.key === selectedTemplateKey.value)) {
      selectedTemplateKey.value = visibleKeys[0]?.key ?? null
    }
  },
  { immediate: true },
)

function handleTemplateAdd(channel: 'ASSISTANT' | 'IN_APP'): void {
  if (selectedTemplateGroup.value === null) {
    return
  }
  emit('add', {
    key: selectedTemplateGroup.value.key,
    domain: selectedTemplateGroup.value.domain,
    channel,
  })
}
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="notification-template-library">
    <div class="flex flex-wrap gap-3 items-center justify-between">
      <div>
        <h2 class="qs-type-section-title m-0">
          消息模板
        </h2>
        <p class="qs-type-meta text-muted-foreground m-0 mt-1">
          业务只传一个 templateKey，每个渠道各有一份模板；跨事件复用时修改会影响所有绑定事件。
        </p>
      </div>
      <FaButton size="sm" :disabled="!canUpdate || busy" @click="emit('create')">
        新建模板
      </FaButton>
    </div>

    <FaAlert v-if="loadingError !== null" variant="destructive" :title="loadingError" />

    <div
      class="border border-border rounded-xl bg-background grid overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)] lg:h-[640px]"
      data-testid="notification-template-master-detail"
    >
      <TemplateDomainRail
        :groups="visibleTemplateDomainGroups"
        :search="templateSearch"
        :selected-key="selectedTemplateKey"
        @select="selectedTemplateKey = $event"
        @update:search="templateSearch = $event"
      />
      <div class="h-full min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:overflow-y-auto">
        <TemplateKeyDetail
          :group="selectedTemplateGroup"
          :can-update="canUpdate"
          :busy="busy"
          :usage-count="selectedUsageCount"
          @add="handleTemplateAdd"
          @edit="emit('edit', $event)"
          @preview="emit('preview', $event)"
          @toggle="(template, enabled) => emit('toggle', template, enabled)"
        />
      </div>
    </div>
  </section>
</template>
