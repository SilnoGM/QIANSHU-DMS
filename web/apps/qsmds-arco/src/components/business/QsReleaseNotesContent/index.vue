<script setup lang="ts">
import type { ReleaseNoteSection } from './logic'
import {
  isAllReleaseAudience,
  parseReleaseNoteItem,
  resolveReleaseSectionAudience,
} from './logic'

defineOptions({
  name: 'QsReleaseNotesContent',
})

const props = defineProps<{
  sections: readonly ReleaseNoteSection[]
}>()

const { t } = useI18n()

const SECTION_PRESENTATION: Record<string, { icon: string, tone: string }> = {
  功能新增: { icon: 'i-lucide:sparkles', tone: 'text-primary' },
  功能优化: { icon: 'i-lucide:trending-up', tone: 'text-primary' },
  缺陷修复: { icon: 'i-lucide:wrench', tone: 'text-amber-600 dark:text-amber-300' },
  已知问题: { icon: 'i-lucide:triangle-alert', tone: 'text-amber-600 dark:text-amber-300' },
}
const DEFAULT_SECTION_PRESENTATION = { icon: 'i-lucide:info', tone: 'text-muted-foreground' }

/** 分类标题来自文案；早期版本允许自定义分类，未知标题按中性样式渲染。 */
const renderedSections = computed(() => props.sections.map((section) => {
  const items = section.items.map(parseReleaseNoteItem)
  return {
    title: section.title,
    items,
    audience: resolveReleaseSectionAudience(items),
    presentation: SECTION_PRESENTATION[section.title] ?? DEFAULT_SECTION_PRESENTATION,
  }
}))
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

      <p v-if="section.audience.commonRoles" class="text-xs text-muted-foreground m-0 mb-2">
        {{ t('app.components.checkUpdates.audience', { roles: section.audience.commonRoles.join('、') }) }}
      </p>

      <ul class="m-0 p-0 list-none space-y-2">
        <li
          v-for="(item, index) in section.items"
          :key="`${section.title}-${index}`"
          class="flex gap-2"
        >
          <span class="mt-2 rounded-full bg-primary/70 shrink-0 size-1.5" aria-hidden="true" />
          <div class="min-w-0">
            <p class="text-sm text-foreground leading-6 m-0 break-words">
              {{ item.text }}
            </p>
            <p
              v-if="section.audience.showItemRoles && item.roles.length > 0 && !isAllReleaseAudience(item.roles)"
              class="text-xs text-muted-foreground m-0 mt-0.5"
            >
              {{ t('app.components.checkUpdates.audience', { roles: item.roles.join('、') }) }}
            </p>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
