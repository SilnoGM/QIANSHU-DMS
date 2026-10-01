<script setup lang="ts">
import type { TechStackData, TechStackGroup } from '@/types/development-map'

defineOptions({
  name: 'TechStackPanel',
})

const props = defineProps<{ techStack: TechStackData }>()

/** 条目较多的分组默认折叠，避免「其他依赖」把页面拉得过长。 */
const collapseThreshold = 12

const expandedGroups = ref<Set<string>>(new Set())

function isExpanded(group: TechStackGroup): boolean {
  return expandedGroups.value.has(group.key)
}

function canCollapse(group: TechStackGroup): boolean {
  return group.items.length > collapseThreshold
}

function visibleItems(group: TechStackGroup): TechStackGroup['items'] {
  return isExpanded(group) || !canCollapse(group) ? group.items : group.items.slice(0, collapseThreshold)
}

function toggleGroup(key: string) {
  const next = new Set(expandedGroups.value)
  if (next.has(key)) {
    next.delete(key)
  }
  else {
    next.add(key)
  }
  expandedGroups.value = next
}

const runtime = computed(() => props.techStack.runtime)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap gap-x-4 gap-y-2 items-center">
      <span v-for="item in runtime" :key="item.label" class="text-sm flex gap-2 items-center">
        <span class="text-muted-foreground">{{ item.label }}</span>
        <FaTag variant="secondary">
          {{ item.value }}
        </FaTag>
      </span>
    </div>

    <div class="gap-4 grid lg:grid-cols-2">
      <FaCard v-for="group in techStack.groups" :key="group.key">
        <template #header>
          <div class="flex gap-2 items-center">
            <span class="font-bold">{{ group.label }}</span>
            <span class="text-xs text-muted-foreground">{{ group.items.length }}</span>
          </div>
        </template>
        <ul class="list-none flex flex-col gap-2">
          <li v-for="item in visibleItems(group)" :key="item.name" class="flex flex-wrap gap-x-2 items-baseline">
            <span class="text-sm font-sans">{{ item.name }}</span>
            <span class="text-xs text-muted-foreground font-sans">{{ item.version }}</span>
            <span v-if="item.note" class="text-xs text-muted-foreground">{{ item.note }}</span>
          </li>
        </ul>
        <FaButton
          v-if="canCollapse(group)"
          variant="link"
          size="sm"
          class="p-0 h-auto self-start"
          @click="toggleGroup(group.key)"
        >
          {{ isExpanded(group) ? '收起' : `展开全部 ${group.items.length} 项` }}
        </FaButton>
      </FaCard>
    </div>
  </div>
</template>
