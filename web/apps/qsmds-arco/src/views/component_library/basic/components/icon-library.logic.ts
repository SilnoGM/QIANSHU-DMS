import type { IconCatalogEntry } from '@/icons'
import { computed, onScopeDispose, ref, watch } from 'vue'

export type IconPreviewSize = 20 | 24 | 32
export type IconPreviewState = 'default' | 'selected'
type IconTypeFilter = 'all' | 'brand' | 'general'
type CopyStatus = 'idle' | 'copied' | 'unavailable' | 'failed'
type ClipboardWriter = (value: string) => Promise<void>

const sizeClasses: Record<IconPreviewSize, string> = {
  20: 'size-5',
  24: 'size-6',
  32: 'size-8',
}

export function useIconLibrary(catalog: readonly IconCatalogEntry[]) {
  const query = ref<string | undefined>('')
  const typeFilter = ref<IconTypeFilter>('all')
  const size = ref<IconPreviewSize>(24)
  const previewState = ref<IconPreviewState>('default')
  const selectedName = ref(catalog[0]?.name)
  const copyStatus = ref<CopyStatus>('idle')
  const copyPending = ref(false)
  let active = true

  const brandCount = computed(() => catalog.filter(icon => icon.source === 'brand').length)
  const generalCount = computed(() => catalog.length - brandCount.value)
  const filteredIcons = computed(() => {
    const search = query.value?.trim().toLowerCase() ?? ''
    return catalog.filter((icon) => {
      const matchesType = typeFilter.value === 'all'
        || (typeFilter.value === 'brand' ? icon.source === 'brand' : icon.source !== 'brand')
      const searchableText = [icon.name, icon.label, icon.category, ...icon.usages].join(' ').toLowerCase()
      return matchesType && (!search || searchableText.includes(search))
    })
  })
  const selectedIcon = computed(() => filteredIcons.value.find(icon => icon.name === selectedName.value) ?? filteredIcons.value[0])
  const usageCode = computed(() => selectedIcon.value
    ? `<FaIcon name="${selectedIcon.value.name}" class="${sizeClasses[size.value]}" />`
    : '')

  watch(usageCode, () => {
    copyStatus.value = 'idle'
  }, { flush: 'sync' })
  onScopeDispose(() => {
    active = false
  })

  function setTypeFilter(value: string | number) {
    if (value === 'all' || value === 'brand' || value === 'general') {
      typeFilter.value = value
    }
  }

  function selectIcon(name: string) {
    if (filteredIcons.value.some(icon => icon.name === name)) {
      selectedName.value = name
    }
  }

  function resetFilters() {
    query.value = ''
    typeFilter.value = 'all'
  }

  async function copySelectedCode(writeText?: ClipboardWriter): Promise<Exclude<CopyStatus, 'idle'> | 'ignored'> {
    if (!active || copyPending.value || !usageCode.value) {
      return 'ignored'
    }
    if (!writeText) {
      copyStatus.value = 'unavailable'
      return 'unavailable'
    }

    const code = usageCode.value
    copyPending.value = true
    let result: Exclude<CopyStatus, 'idle'> = 'copied'
    try {
      await writeText(code)
    }
    catch {
      result = 'failed'
    }
    finally {
      copyPending.value = false
    }

    // 用户可能已切换图标或离开页面，旧复制结果不得覆盖当前详情或触发全局提示。
    if (!active || code !== usageCode.value) {
      return 'ignored'
    }
    copyStatus.value = result
    return result
  }

  return {
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
  }
}
