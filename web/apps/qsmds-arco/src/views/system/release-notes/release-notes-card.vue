<script setup lang="ts">
import type { ReleaseNotesGroup } from '@/types/development-map'
import { groupToneClass, shouldFoldGroup, visibleGroupItems } from './release-notes.logic'

defineOptions({
  name: 'ReleaseNotesCard',
})

defineProps<{
  title: string
  subtitle: string
  badge?: string | null
  groups: ReleaseNotesGroup[]
  graphTag?: string | null
}>()

const emit = defineEmits<{
  openGraph: [tag: string | null]
}>()

// 折叠状态按分类 type 记录：同一次页面会话内切换版本卡片不会互相影响。
const expandedGroups = ref<Set<string>>(new Set())

function toggleGroup(type: string) {
  const next = new Set(expandedGroups.value)
  if (next.has(type)) {
    next.delete(type)
  }
  else {
    next.add(type)
  }
  expandedGroups.value = next
}

const isExpanded = (type: string) => expandedGroups.value.has(type)
</script>

<template>
  <FaCard class="h-full">
    <template #header>
      <div class="flex flex-wrap gap-x-3 gap-y-1 items-center">
        <span class="text-lg font-bold font-sans">{{ title }}</span>
        <FaTag v-if="badge" variant="secondary">
          {{ badge }}
        </FaTag>
        <span class="text-sm text-muted-foreground">{{ subtitle }}</span>
      </div>
    </template>
    <div v-if="groups.length === 0" class="text-sm text-muted-foreground">
      本版本没有可归类的提交。
    </div>
    <div v-else class="flex flex-col gap-4">
      <div v-for="group in groups" :key="group.type" class="flex flex-col gap-1.5">
        <div class="flex gap-2 items-center">
          <span class="text-sm font-bold" :class="groupToneClass(group.type)">{{ group.label }}</span>
          <span class="text-xs text-muted-foreground">{{ group.count }}</span>
        </div>
        <ul class="text-sm list-none flex flex-col gap-1">
          <li v-for="item in visibleGroupItems(group, isExpanded(group.type))" :key="item.sha" class="flex gap-2 items-start">
            <span class="text-muted-foreground font-sans shrink-0">{{ item.sha }}</span>
            <span class="break-all">{{ item.subject }}</span>
          </li>
        </ul>
        <FaButton
          v-if="shouldFoldGroup(group)"
          variant="link"
          size="sm"
          class="p-0 h-auto self-start"
          @click="toggleGroup(group.type)"
        >
          {{ isExpanded(group.type) ? '收起' : `展开全部 ${group.count} 条` }}
        </FaButton>
      </div>
    </div>
    <template #footer>
      <div class="flex flex-1 justify-end">
        <FaButton variant="outline" size="sm" @click="emit('openGraph', graphTag ?? null)">
          查看该版本代码图谱
        </FaButton>
      </div>
    </template>
  </FaCard>
</template>
