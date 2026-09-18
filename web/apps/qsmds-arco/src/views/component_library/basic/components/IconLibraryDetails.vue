<script setup lang="ts">
import type { IconPreviewSize, IconPreviewState } from './icon-library.logic'
import type { IconCatalogEntry } from '@/icons'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  icon?: IconCatalogEntry
  size: IconPreviewSize
  previewState: IconPreviewState
  usageCode: string
  copyPending: boolean
  copyStatus: 'idle' | 'copied' | 'unavailable' | 'failed'
}>()

const emit = defineEmits<{ copy: [] }>()
const { t } = useI18n()
const copyFeedback = computed(() => props.copyStatus === 'idle' ? '' : t(`iconLibrary.copy.${props.copyStatus}`))
</script>

<template>
  <div v-if="icon" class="min-w-0">
    <div
      class="border border-border rounded-lg flex h-28 items-center justify-center"
      :class="previewState === 'selected'
        ? 'bg-[var(--g-sub-sidebar-menu-active-bg)] text-[var(--g-sub-sidebar-menu-active-color)]'
        : 'bg-[var(--g-sub-sidebar-bg)] text-[var(--g-sub-sidebar-menu-color)]'"
    >
      <FaIcon :name="icon.name" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true" />
    </div>
    <p class="text-base font-medium m-0 mt-4 break-words">
      {{ icon.label }}
    </p>
    <p class="text-sm text-muted-foreground m-0 mt-1 break-all">
      {{ icon.name }}
    </p>
    <dl class="text-sm m-0 mt-4 space-y-3">
      <div class="flex gap-3 justify-between">
        <dt class="text-muted-foreground shrink-0">
          {{ t('iconLibrary.category') }}
        </dt>
        <dd class="m-0 text-end break-words">
          {{ icon.category }}
        </dd>
      </div>
      <div>
        <dt class="text-muted-foreground mb-1">
          {{ t('iconLibrary.usages') }}
        </dt>
        <dd class="leading-6 m-0 break-words">
          {{ icon.usages.join('、') || t('iconLibrary.noUsages') }}
        </dd>
      </div>
    </dl>
    <div class="mt-5 pt-4 border-t border-border">
      <h3 class="text-sm font-medium m-0">
        {{ t('iconLibrary.code') }}
      </h3>
      <pre class="text-xs leading-6 m-0 mt-2 p-3 border border-border rounded-md bg-muted/30 whitespace-pre-wrap break-all"><code>{{ usageCode }}</code></pre>
      <FaButton type="button" class="mt-3 w-full" :loading="copyPending" @click="emit('copy')">
        <FaIcon v-if="!copyPending" name="i-lucide:copy" class="size-4" aria-hidden="true" />
        {{ t(copyPending ? 'iconLibrary.copyPending' : 'iconLibrary.copyCode') }}
      </FaButton>
      <p v-if="copyFeedback" role="status" class="text-xs leading-5 m-0 mt-2" :class="copyStatus === 'failed' || copyStatus === 'unavailable' ? 'text-destructive' : 'text-muted-foreground'">
        {{ copyFeedback }}
      </p>
    </div>
    <p class="text-xs text-muted-foreground leading-5 m-0 mt-4">
      {{ t('iconLibrary.themeHint') }}
    </p>
  </div>
  <p v-else class="text-sm text-muted-foreground leading-6 m-0">
    {{ t('iconLibrary.noSelection') }}
  </p>
</template>
