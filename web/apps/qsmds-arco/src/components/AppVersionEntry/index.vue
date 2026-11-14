<script setup lang="ts">
defineOptions({
  name: 'AppVersionEntry',
})

withDefaults(
  defineProps<{
    collapsed?: boolean
  }>(),
  {
    collapsed: false,
  },
)

const { t } = useI18n()

// 展示当前运行 bundle 的版本，避免与 release.json 的“最新版本”混淆。
const version = __SYSTEM_INFO__.pkg.version
const versionLabel = computed(() => t('app.components.versionEntry.currentVersion'))
const versionTitle = computed(() => `${versionLabel.value} v${version}`)
</script>

<template>
  <div class="px-4 pt-2">
    <FaTooltip :disabled="!collapsed" :text="versionTitle" side="right">
      <RouterLink
        :to="{ name: 'releaseNotes' }"
        :title="collapsed ? versionTitle : undefined"
        :aria-label="collapsed ? versionTitle : undefined"
        class="group text-xs px-2 rounded-md bg-primary/10 no-underline flex gap-2 h-[34px] transition-colors items-center hover-bg-primary/20"
        :class="{ 'justify-center px-0': collapsed }"
        data-testid="sidebar-version-entry"
      >
        <FaIcon name="i-lucide:sprout" class="text-primary shrink-0 size-3.5" aria-hidden="true" />
        <template v-if="!collapsed">
          <span class="flex flex-1 gap-1 min-w-0 items-baseline">
            <span class="text-muted-foreground truncate">{{ versionLabel }}</span>
            <span class="font-qs-data-mono text-primary font-semibold shrink-0">v{{ version }}</span>
          </span>
          <FaIcon
            name="i-lucide:chevron-right"
            class="text-muted-foreground shrink-0 size-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </template>
      </RouterLink>
    </FaTooltip>
  </div>
</template>
