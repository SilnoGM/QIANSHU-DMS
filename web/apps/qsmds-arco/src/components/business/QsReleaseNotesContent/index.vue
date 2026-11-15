<script setup lang="ts">
import type { ReleaseNoteSection } from './logic'
import { parseReleaseNoteItem } from './logic'

defineOptions({
  name: 'QsReleaseNotesContent',
})

const props = defineProps<{
  sections: readonly ReleaseNoteSection[]
}>()

const ROLE_TAG_CLASS = 'inline-flex items-center align-middle bg-muted text-muted-foreground px-1.5 rounded font-medium text-[11px] leading-4'

const SECTION_PRESENTATION: Record<string, { icon: string, tone: string, bullet: string }> = {
  功能新增: { icon: 'i-lucide:sparkles', tone: 'text-primary', bullet: 'bg-primary/70' },
  功能优化: { icon: 'i-lucide:trending-up', tone: 'text-primary', bullet: 'bg-primary/70' },
  缺陷修复: { icon: 'i-lucide:wrench', tone: 'text-amber-600 dark:text-amber-300', bullet: 'bg-amber-500/80' },
  已知问题: { icon: 'i-lucide:triangle-alert', tone: 'text-amber-600 dark:text-amber-300', bullet: 'bg-amber-500/80' },
}
const DEFAULT_SECTION_PRESENTATION = {
  icon: 'i-lucide:info',
  tone: 'text-muted-foreground',
  bullet: 'bg-muted-foreground/60',
}

/**
 * 分类标题来自文案；早期版本允许自定义分类，未知标题按中性样式渲染。
 * 角色标签一律内联在每条正文末尾，不再按分类提取到标题下，保证所有条目的阅读格式一致。
 */
const renderedSections = computed(() => props.sections.map(section => ({
  title: section.title,
  items: section.items.map(parseReleaseNoteItem),
  presentation: SECTION_PRESENTATION[section.title] ?? DEFAULT_SECTION_PRESENTATION,
})))
</script>

<template>
  <div class="flex flex-col gap-3">
    <section
      v-for="section in renderedSections"
      :key="section.title"
      class="p-3 border rounded-lg sm:p-4"
      :class="section.title === '已知问题'
        ? 'border-amber-500/30 bg-amber-500/5'
        : 'border-border/70 bg-muted/20'"
    >
      <div class="mb-2 flex gap-2 items-center">
        <FaIcon
          :name="section.presentation.icon"
          class="shrink-0 size-4"
          :class="section.presentation.tone"
          aria-hidden="true"
        />
        <h3 class="text-sm font-semibold m-0">
          {{ section.title }}
        </h3>
        <FaTag variant="secondary" class="text-xs ms-auto tabular-nums" aria-hidden="true">
          {{ section.items.length }}
        </FaTag>
      </div>

      <ul class="m-0 p-0 list-none space-y-2">
        <li v-for="(item, index) in section.items" :key="`${section.title}-${index}`" class="flex gap-2">
          <span class="mt-[9px] flex shrink-0 w-4 justify-center" aria-hidden="true">
            <span class="rounded-full size-1.5" :class="section.presentation.bullet" />
          </span>
          <div class="min-w-0">
            <p class="text-sm text-foreground leading-6 m-0 break-words">
              {{ item.text }}
              <span v-if="item.roles.length > 0">
                <span
                  v-for="role in item.roles"
                  :key="role"
                  :class="ROLE_TAG_CLASS"
                  class="ms-1"
                >{{ role }}</span>
              </span>
            </p>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
