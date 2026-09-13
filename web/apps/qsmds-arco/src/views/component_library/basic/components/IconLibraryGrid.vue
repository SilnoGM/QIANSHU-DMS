<script setup lang="ts">
import type { IconPreviewSize, IconPreviewState } from './icon-library.logic'
import type { IconCatalogEntry } from '@/icons'
import { useI18n } from 'vue-i18n'

defineProps<{
  icons: readonly IconCatalogEntry[]
  selectedName?: string
  size: IconPreviewSize
  previewState: IconPreviewState
  openAsDialog: boolean
}>()

const emit = defineEmits<{
  select: [name: string]
  reset: []
}>()

const { t } = useI18n()
</script>

<template>
  <ul v-if="icons.length" :aria-label="t('iconLibrary.results')" class="m-0 p-0 list-none gap-2 grid grid-cols-2 2xl:grid-cols-5 sm:grid-cols-3 xl:grid-cols-4">
    <li v-for="icon in icons" :key="icon.name" class="min-w-0">
      <FaButton
        type="button"
        variant="ghost"
        class="p-3 border rounded-lg flex flex-col gap-2 h-full min-h-28 w-full whitespace-normal"
        :class="selectedName === icon.name ? 'border-primary bg-accent/30' : 'border-border hover:bg-accent/30'"
        :aria-label="`${icon.label} (${icon.name})`"
        :aria-pressed="selectedName === icon.name"
        :aria-controls="openAsDialog ? 'icon-library-mobile-detail' : 'icon-library-detail'"
        :aria-haspopup="openAsDialog ? 'dialog' : undefined"
        :data-icon-name="icon.name"
        @click="emit('select', icon.name)"
      >
        <span
          class="rounded-md flex size-12 items-center justify-center"
          :class="previewState === 'selected'
            ? 'bg-[var(--g-sub-sidebar-menu-active-bg)] text-[var(--g-sub-sidebar-menu-active-color)]'
            : 'bg-[var(--g-sub-sidebar-bg)] text-[var(--g-sub-sidebar-menu-color)]'"
        >
          <FaIcon :name="icon.name" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true" />
        </span>
        <span class="text-sm leading-5 font-medium w-full break-words">{{ icon.label }}</span>
        <span class="text-xs text-muted-foreground leading-4 font-normal w-full break-all">{{ icon.name }}</span>
      </FaButton>
    </li>
  </ul>
  <div v-else class="px-4 py-12 text-center">
    <p role="status" class="text-sm font-medium m-0">
      {{ t('iconLibrary.emptyTitle') }}
    </p>
    <p class="text-sm text-muted-foreground m-0 mt-2">
      {{ t('iconLibrary.emptyDescription') }}
    </p>
    <FaButton type="button" variant="outline" class="mt-4" @click="emit('reset')">
      {{ t('iconLibrary.reset') }}
    </FaButton>
  </div>
</template>
