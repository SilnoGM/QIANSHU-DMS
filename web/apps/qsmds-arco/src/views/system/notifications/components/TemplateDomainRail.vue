<script setup lang="ts">
import type { TemplateDomainGroup } from '../template-key-grouping.logic'

import { computed, ref, watch } from 'vue'

const props = defineProps<{
  groups: readonly TemplateDomainGroup[]
  search: string
  selectedKey: string | null
}>()

const emit = defineEmits<{
  'select': [key: string]
  'update:search': [value: string]
}>()

const collapsedDomains = ref<Set<string>>(new Set())
const searchModel = computed({
  get: () => props.search,
  set: (value: string) => emit('update:search', value),
})

const hasGroups = computed(() => props.groups.length > 0)

function toggleDomain(domain: string): void {
  const next = new Set(collapsedDomains.value)
  if (next.has(domain)) {
    next.delete(domain)
  }
  else {
    next.add(domain)
  }
  collapsedDomains.value = next
}

watch(() => props.search, (value) => {
  if (value.trim().length > 0) {
    collapsedDomains.value = new Set()
  }
})
</script>

<template>
  <div class="border-b border-border flex flex-col h-full min-h-0 overflow-hidden lg:border-b-0 lg:border-r">
    <div class="p-3 border-b border-border">
      <FaInput
        v-model="searchModel"
        type="search"
        clearable
        placeholder="过滤业务域或 templateKey..."
        aria-label="过滤业务域或模板键"
        class="w-full"
      >
        <template #start>
          <FaIcon name="i-lucide:search" />
        </template>
      </FaInput>
    </div>

    <div class="overscroll-contain flex-1 min-h-0 [scrollbar-width:none] overflow-x-hidden overflow-y-auto [&::-webkit-scrollbar]:hidden">
      <div v-if="!hasGroups" class="qs-type-meta text-muted-foreground p-4">
        没有匹配的模板键。
      </div>
      <section v-for="group in groups" :key="group.domain" class="border-b border-border/60 last:border-b-0">
        <button
          type="button"
          class="px-3 py-2 text-left flex gap-1.5 w-full items-center hover:bg-muted/40"
          :aria-expanded="!collapsedDomains.has(group.domain)"
          @click="toggleDomain(group.domain)"
        >
          <FaIcon :name="collapsedDomains.has(group.domain) ? 'i-lucide:chevron-right' : 'i-lucide:chevron-down'" class="text-muted-foreground shrink-0 size-3.5" aria-hidden="true" />
          <span class="qs-type-meta font-medium">{{ group.label }}</span>
          <span class="qs-type-meta text-muted-foreground">({{ group.keyCount }} 个模板键 · {{ group.channelCount }} 个渠道)</span>
        </button>

        <div v-if="!collapsedDomains.has(group.domain)" class="px-2 pb-1">
          <button
            v-for="keyGroup in group.keys"
            :key="keyGroup.key"
            type="button"
            class="my-0.5 px-2.5 py-2 text-left rounded-md flex gap-2 w-full transition-colors items-start"
            :class="selectedKey === keyGroup.key
              ? 'bg-primary/8 text-primary'
              : 'hover:bg-muted/50'"
            :aria-current="selectedKey === keyGroup.key ? 'true' : undefined"
            @click="emit('select', keyGroup.key)"
          >
            <span class="flex-1 min-w-0">
              <span class="qs-type-body-medium block truncate" :title="keyGroup.displayName">
                {{ keyGroup.displayName }}
              </span>
              <span class="qs-type-meta text-muted-foreground font-mono block truncate" :title="keyGroup.key">
                {{ keyGroup.key }}
              </span>
            </span>
            <span class="flex shrink-0 gap-1 items-center">
              <template v-if="selectedKey === keyGroup.key">
                <FaTag
                  v-if="keyGroup.assistant !== null"
                  variant="outline"
                  :class="keyGroup.assistant.enabled
                    ? 'text-primary border-primary/30 bg-primary/10'
                    : 'text-muted-foreground border-border bg-muted'"
                  :title="`千树小助理：${keyGroup.assistant.enabled ? '已启用' : '已停用'}`"
                >
                  小助理
                </FaTag>
                <FaTag
                  v-if="keyGroup.inApp !== null"
                  variant="outline"
                  :class="keyGroup.inApp.enabled
                    ? 'text-sky-700 border-sky-500/30 bg-sky-500/10 dark:text-sky-300'
                    : 'text-muted-foreground border-border bg-muted'"
                  :title="`站内通知：${keyGroup.inApp.enabled ? '已启用' : '已停用'}`"
                >
                  站内
                </FaTag>
              </template>
              <template v-else>
                <span
                  v-if="keyGroup.assistant !== null"
                  class="rounded-full size-2"
                  :class="keyGroup.assistant.enabled ? 'bg-primary' : 'border border-slate-400 bg-transparent'"
                  :title="`千树小助理：${keyGroup.assistant.enabled ? '已启用' : '已停用'}`"
                />
                <span
                  v-if="keyGroup.inApp !== null"
                  class="rounded-full size-2"
                  :class="keyGroup.inApp.enabled ? 'bg-sky-500' : 'border border-slate-400 bg-transparent'"
                  :title="`站内通知：${keyGroup.inApp.enabled ? '已启用' : '已停用'}`"
                />
              </template>
            </span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
