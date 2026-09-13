<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import { projectIcons } from '@/icons'
import { useIconLibrary } from './icon-library.logic'
import IconLibraryDetails from './IconLibraryDetails.vue'
import IconLibraryGrid from './IconLibraryGrid.vue'

defineOptions({ name: 'IconLibraryShowcase' })

const { t } = useI18n()
const toast = useQsToast()
const isWideScreen = useMediaQuery('(min-width: 1024px)')
const mobileDetailsOpen = ref(false)
const {
  brandCount,
  copyPending,
  copySelectedCode,
  copyStatus,
  filteredIcons,
  generalCount,
  previewState,
  query,
  resetFilters,
  selectIcon,
  selectedIcon,
  setTypeFilter,
  size,
  typeFilter,
  usageCode,
} = useIconLibrary(projectIcons)

const sizes = [20, 24, 32] as const
const previewStates = ['default', 'selected'] as const
const typeTabs = computed(() => [
  { value: 'all', label: t('iconLibrary.typeAll', { count: projectIcons.length }), class: 'h-auto w-full py-2 sm:w-auto' },
  { value: 'brand', label: t('iconLibrary.typeBrand', { count: brandCount.value }), class: 'h-auto w-full py-2 sm:w-auto' },
  { value: 'general', label: t('iconLibrary.typeGeneral', { count: generalCount.value }), class: 'h-auto w-full py-2 sm:w-auto' },
])
const hasFilters = computed(() => Boolean(query.value) || typeFilter.value !== 'all')

watch(isWideScreen, () => {
  mobileDetailsOpen.value = false
})

function viewIcon(name: string) {
  selectIcon(name)
  if (!isWideScreen.value) {
    mobileDetailsOpen.value = true
  }
}

async function copyUsage() {
  const clipboard = globalThis.navigator?.clipboard
  const result = await copySelectedCode(clipboard?.writeText.bind(clipboard))
  if (result === 'copied') {
    toast.success(t('iconLibrary.copy.copied'))
  }
  else if (result === 'unavailable' || result === 'failed') {
    toast.error(t(`iconLibrary.copy.${result}`))
  }
}
</script>

<template>
  <section :aria-label="t('iconLibrary.title')" class="min-w-0">
    <div class="pb-5 border-b border-border flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div class="flex-1 min-w-0 xl:max-w-md">
        <label for="icon-library-search" class="text-sm font-medium mb-2 block">
          {{ t('iconLibrary.search') }}
        </label>
        <FaInput
          id="icon-library-search"
          v-model="query"
          type="search"
          class="w-full"
          :placeholder="t('iconLibrary.searchPlaceholder')"
          aria-controls="icon-library-results"
          @keydown.esc="resetFilters"
        >
          <template #start>
            <FaIcon name="i-lucide:search" class="text-muted-foreground size-4" aria-hidden="true" />
          </template>
        </FaInput>
      </div>
      <div class="flex flex-wrap gap-x-6 gap-y-4">
        <fieldset class="m-0 p-0 border-0 min-w-0">
          <legend class="text-sm font-medium mb-2 p-0">
            {{ t('iconLibrary.size') }}
          </legend>
          <div class="flex gap-1">
            <FaButton
              v-for="option in sizes"
              :key="option"
              type="button"
              size="sm"
              :variant="size === option ? 'secondary' : 'ghost'"
              :aria-pressed="size === option"
              @click="size = option"
            >
              {{ option }} px
            </FaButton>
          </div>
        </fieldset>
        <fieldset class="m-0 p-0 border-0 min-w-0">
          <legend class="text-sm font-medium mb-2 p-0">
            {{ t('iconLibrary.background') }}
          </legend>
          <div class="flex gap-1">
            <FaButton
              v-for="state in previewStates"
              :key="state"
              type="button"
              size="sm"
              :variant="previewState === state ? 'secondary' : 'ghost'"
              :aria-pressed="previewState === state"
              @click="previewState = state"
            >
              {{ t(`iconLibrary.preview.${state}`) }}
            </FaButton>
          </div>
        </fieldset>
      </div>
    </div>

    <div class="mt-5 gap-6 grid min-w-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div id="icon-library-results" class="min-w-0">
        <FaTabs
          :model-value="typeFilter"
          :list="typeTabs"
          list-class="w-full h-auto flex-col sm:w-fit sm:flex-row"
          content-class="mt-4 outline-none"
          @update:model-value="setTypeFilter"
        >
          <template v-for="tab in typeTabs" :key="tab.value" #[tab.value]>
            <div class="text-sm text-muted-foreground mb-3 flex flex-wrap gap-2 min-h-8 items-center justify-between">
              <span role="status">{{ t('iconLibrary.resultCount', { count: filteredIcons.length, total: projectIcons.length }) }}</span>
              <FaButton v-if="hasFilters" type="button" size="sm" variant="ghost" @click="resetFilters">
                {{ t('iconLibrary.reset') }}
              </FaButton>
            </div>
            <IconLibraryGrid
              :icons="filteredIcons"
              :selected-name="selectedIcon?.name"
              :size="size"
              :preview-state="previewState"
              :open-as-dialog="!isWideScreen"
              @select="viewIcon"
              @reset="resetFilters"
            />
          </template>
        </FaTabs>
      </div>

      <aside v-if="isWideScreen" id="icon-library-detail" aria-labelledby="icon-library-detail-title" class="min-w-0 self-start lg:top-4 lg:sticky">
        <h2 id="icon-library-detail-title" class="text-base font-semibold m-0 mb-4">
          {{ t('iconLibrary.detail') }}
        </h2>
        <IconLibraryDetails
          :icon="selectedIcon"
          :size="size"
          :preview-state="previewState"
          :usage-code="usageCode"
          :copy-pending="copyPending"
          :copy-status="copyStatus"
          @copy="copyUsage"
        />
      </aside>
    </div>
    <!-- 窄屏按需展示详情，避免用户必须穿过完整图标清单才能找到复制入口；通用抽屉负责关闭后的焦点恢复。 -->
    <QsGenericDrawer
      v-if="!isWideScreen"
      v-model="mobileDetailsOpen"
      :title="t('iconLibrary.detail')"
      :description="selectedIcon?.label"
      size="sm"
    >
      <div id="icon-library-mobile-detail">
        <IconLibraryDetails
          :icon="selectedIcon"
          :size="size"
          :preview-state="previewState"
          :usage-code="usageCode"
          :copy-pending="copyPending"
          :copy-status="copyStatus"
          @copy="copyUsage"
        />
      </div>
    </QsGenericDrawer>
  </section>
</template>
