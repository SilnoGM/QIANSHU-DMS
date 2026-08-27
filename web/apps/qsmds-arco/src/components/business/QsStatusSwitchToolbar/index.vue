<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import type { QsStatusSwitchItem } from './types'
import { useMediaQuery, useResizeObserver } from '@vueuse/core'
import {
  getStatusSwitchScrollTarget,
  hasStatusSwitchRightOverflow,
} from './logic'

defineOptions({ name: 'QsStatusSwitchToolbar' })

const props = withDefaults(defineProps<{
  ariaLabel?: string
  items: readonly QsStatusSwitchItem[]
}>(), {
  ariaLabel: '状态筛选',
})

const modelValue = defineModel<string>({ required: true })

const scrollViewport = ref<HTMLElement | null>(null)
const itemElements = new Map<string, HTMLElement>()
const hasRightOverflow = ref(false)
const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

function getOverflowMetrics() {
  const viewport = scrollViewport.value
  if (!viewport) {
    return null
  }

  return {
    clientWidth: viewport.clientWidth,
    scrollLeft: viewport.scrollLeft,
    scrollWidth: viewport.scrollWidth,
  }
}

function syncOverflowState() {
  const metrics = getOverflowMetrics()
  hasRightOverflow.value = metrics
    ? hasStatusSwitchRightOverflow(metrics)
    : false
}

function setItemElement(
  value: string,
  element: Element | ComponentPublicInstance | null,
) {
  if (!element) {
    itemElements.delete(value)
    return
  }

  // Vue 的模板 ref 同时允许原生元素和组件实例，显式判断 `$el` 避免联合类型误判。
  const componentRoot = '$el' in element ? element.$el : null
  const htmlElement = element instanceof HTMLElement
    ? element
    : componentRoot instanceof HTMLElement
      ? componentRoot
      : null

  if (htmlElement) {
    itemElements.set(value, htmlElement)
  }
}

function selectItem(item: QsStatusSwitchItem) {
  if (item.disabled || modelValue.value === item.value) {
    return
  }

  modelValue.value = item.value
}

function browseRight() {
  const viewport = scrollViewport.value
  const metrics = getOverflowMetrics()
  if (!viewport || !metrics) {
    return
  }

  viewport.scrollTo({
    behavior: prefersReducedMotion.value ? 'auto' : 'smooth',
    left: getStatusSwitchScrollTarget(metrics),
  })
}

/**
 * 外部受控值变化时，只负责让当前项进入可视区域；组件不擅自修正或选择业务状态。
 */
watch(modelValue, async (value) => {
  await nextTick()
  itemElements.get(value)?.scrollIntoView({
    behavior: prefersReducedMotion.value ? 'auto' : 'smooth',
    block: 'nearest',
    inline: 'nearest',
  })
  syncOverflowState()
})

watch(() => props.items, async () => {
  await nextTick()
  syncOverflowState()
}, { deep: true })

useResizeObserver(scrollViewport, syncOverflowState)

onMounted(async () => {
  await nextTick()
  syncOverflowState()
})
</script>

<template>
  <nav
    data-slot="qs-status-switch-toolbar"
    class="p-2 border border-border rounded-lg bg-background h-14 relative overflow-hidden"
    :aria-label="ariaLabel"
  >
    <div
      ref="scrollViewport"
      data-slot="qs-status-switch-viewport"
      class="qs-status-switch-toolbar__viewport h-10 overflow-x-auto overflow-y-hidden"
      @scroll.passive="syncOverflowState"
    >
      <div class="flex gap-1 h-10 min-w-max items-stretch">
        <button
          v-for="item in items"
          :key="item.value"
          :ref="element => setItemElement(item.value, element)"
          type="button"
          data-slot="qs-status-switch-item"
          class="group px-3.5 rounded-lg inline-flex gap-2 h-10 min-w-24 w-35 transition-colors items-center justify-center relative focus-visible:outline-none disabled:opacity-45 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="modelValue === item.value
            ? 'text-primary bg-primary/8'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'"
          :aria-pressed="modelValue === item.value"
          :disabled="item.disabled"
          @click="selectItem(item)"
        >
          <span class="text-sm leading-5 font-medium whitespace-nowrap">
            {{ item.label }}
          </span>
          <span
            v-if="item.count !== undefined"
            class="text-xs leading-4 font-mono whitespace-nowrap tabular-nums"
            :class="modelValue === item.value ? 'text-primary' : 'text-muted-foreground'"
          >
            {{ item.count }}
          </span>
          <span
            v-if="modelValue === item.value"
            aria-hidden="true"
            class="rounded-full bg-primary h-0.5 inset-x-3 bottom-0 absolute"
          />
        </button>
      </div>
    </div>

    <div
      v-if="hasRightOverflow"
      data-slot="qs-status-switch-overflow"
      class="flex h-10 items-stretch right-2 top-2 absolute"
    >
      <span aria-hidden="true" class="bg-background/25 w-2" />
      <span aria-hidden="true" class="bg-background/60 w-2" />
      <span aria-hidden="true" class="bg-background/90 w-2" />
      <button
        type="button"
        class="text-muted-foreground border border-border rounded-lg bg-background inline-flex size-10 shadow-sm transition-colors items-center justify-center hover:text-foreground focus-visible:outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label="浏览更多状态"
        @click="browseRight"
      >
        <FaIcon name="i-lucide:chevron-right" class="size-4" />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.qs-status-switch-toolbar__viewport {
  scrollbar-width: none;
}

.qs-status-switch-toolbar__viewport::-webkit-scrollbar {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  [data-slot="qs-status-switch-item"],
  [data-slot="qs-status-switch-overflow"] button {
    transition: none;
  }
}
</style>
