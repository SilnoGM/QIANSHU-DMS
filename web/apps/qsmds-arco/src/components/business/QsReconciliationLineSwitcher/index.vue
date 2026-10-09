<script setup lang="ts">
import type { QsReconciliationLineSwitcherItem, QsReconciliationLineSwitcherTone } from './types'
import {
  buildLineSwitcherWindow,
  LINE_SWITCHER_DEFAULT_SIDE_COUNT,
  LINE_SWITCHER_TONE_BAR_CLASSES,
  resolveLineSwitcherSideCount,
  resolveLineSwitcherStep,
  resolveLineSwitcherTone,
} from './logic'

/**
 * 对账明细行切换器：折叠形态在条带内聚焦当前行（选中项放大），展开形态纵览全部行。
 *
 * 组件只表达「选中了哪一行」：不读 API、Store 与路由，不写核对结果，也不认识任何状态字面量；
 * 状态取值与状态色映射由调用方通过 items.status 与 statusTones 给出，未登记的状态回落中性灰。
 */
defineOptions({ name: 'QsReconciliationLineSwitcher' })

const props = withDefaults(defineProps<{
  items: readonly QsReconciliationLineSwitcherItem[]
  /** 状态取值 → 语义色；未登记的状态回落 neutral。 */
  statusTones?: Readonly<Record<string, QsReconciliationLineSwitcherTone>>
  /** 折叠条带每侧可见的相邻项数量，槽位数 = 2 * 该值 + 1。 */
  visibleSideCount?: number
  ariaLabel?: string
}>(), {
  statusTones: () => ({}),
  visibleSideCount: LINE_SWITCHER_DEFAULT_SIDE_COUNT,
  ariaLabel: undefined,
})

const model = defineModel<string | null>({ required: true })

const ITEM_SLOT = 'qs-reconciliation-line-switcher-item'

const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
const viewport = ref<HTMLElement | null>(null)
/** 折叠 / 展开是纯视图状态，组件内部持有，形态切换不影响由页面持有的选中值。 */
const expanded = ref(false)

const isEmpty = computed(() => props.items.length === 0)
const sideCount = computed(() => resolveLineSwitcherSideCount(props.visibleSideCount))
const selectedIndex = computed(() => props.items.findIndex(item => item.value === model.value))
const windowIndexes = computed(() => (
  buildLineSwitcherWindow(props.items.length, selectedIndex.value, sideCount.value)
))
/** 到数组首尾即禁用，不循环；无选中或空数组时两个方向都不可用。 */
const canStepPrevious = computed(() => (
  resolveLineSwitcherStep(selectedIndex.value, props.items.length, -1) !== null
))
const canStepNext = computed(() => (
  resolveLineSwitcherStep(selectedIndex.value, props.items.length, 1) !== null
))
const resolvedAriaLabel = computed(() => props.ariaLabel ?? t('qsReconciliationLineSwitcher.ariaLabel'))

function isSelected(item: QsReconciliationLineSwitcherItem): boolean {
  return item.value === model.value
}

function itemAriaLabel(item: QsReconciliationLineSwitcherItem): string {
  return t('qsReconciliationLineSwitcher.itemAriaLabel', {
    label: item.label,
    status: item.statusLabel ?? item.status,
  })
}

function barClassOf(item: QsReconciliationLineSwitcherItem): string {
  return LINE_SWITCHER_TONE_BAR_CLASSES[resolveLineSwitcherTone(item.status, props.statusTones)]
}

function select(value: string): void {
  if (model.value !== value) {
    model.value = value
  }
}

/** 焦点当前是否落在条带槽位上：决定方向键切换后焦点是否跟随选中项。 */
function isStripSlotFocused(): boolean {
  const active = document.activeElement
  return active instanceof HTMLElement
    && active.dataset.slot === ITEM_SLOT
    && root.value?.contains(active) === true
}

/**
 * 折叠条带的选中槽对齐视口正中。窄容器（抽屉、分栏）里条带会横向滚动，
 * 不做这一步「选中项在中间」在窄屏就会失效。
 */
function centerSelectedSlot(): void {
  const scroller = viewport.value
  const slot = root.value?.querySelector<HTMLElement>(`[data-slot="${ITEM_SLOT}"][aria-pressed="true"]`)
  const track = scroller?.firstElementChild
  if (!scroller || !slot || !(track instanceof HTMLElement)) {
    return
  }
  const contentOffset = slot.getBoundingClientRect().left
    - track.getBoundingClientRect().left
    + scroller.scrollLeft
  scroller.scrollLeft = contentOffset - (scroller.clientWidth - slot.offsetWidth) / 2
}

/** `moveFocus` 只在方向键切换时为真：点方向按钮时焦点留在按钮上，便于连续点击。 */
async function syncSelectedSlot(moveFocus: boolean): Promise<void> {
  await nextTick()
  if (moveFocus) {
    root.value
      ?.querySelector<HTMLElement>(`[data-slot="${ITEM_SLOT}"][aria-pressed="true"]`)
      ?.focus({ preventScroll: true })
  }
  centerSelectedSlot()
}

async function step(delta: -1 | 1): Promise<void> {
  const target = resolveLineSwitcherStep(selectedIndex.value, props.items.length, delta)
  const item = target === null ? undefined : props.items[target]
  if (!item) {
    return
  }
  const followSelection = isStripSlotFocused()
  model.value = item.value
  await syncSelectedSlot(followSelection)
}

// 页面外部改值、数据变化、形态与槽位数变化都要重新对齐；挂载时同样先对齐一次。
watch([() => model.value, () => props.items, sideCount, expanded], () => {
  void syncSelectedSlot(false)
})
onMounted(() => {
  void syncSelectedSlot(false)
})
</script>

<template>
  <div
    ref="root"
    data-slot="qs-reconciliation-line-switcher"
    class="p-3 border border-border rounded-xl bg-card flex flex-col gap-2"
    role="group"
    :aria-label="resolvedAriaLabel"
    @keydown.left.prevent="step(-1)"
    @keydown.right.prevent="step(1)"
  >
    <div v-if="!expanded" class="flex gap-2 items-center">
      <button
        type="button"
        data-slot="qs-reconciliation-line-switcher-arrow"
        class="text-muted-foreground border border-border rounded-lg bg-background flex-center shrink-0 size-10 transition-colors hover:text-foreground focus-visible:outline-none hover:bg-muted disabled:opacity-45 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        :aria-label="t('qsReconciliationLineSwitcher.previous')"
        :disabled="!canStepPrevious"
        @click="step(-1)"
      >
        <FaIcon name="i-lucide:chevron-left" class="size-4" />
      </button>

      <div
        ref="viewport"
        data-slot="qs-reconciliation-line-switcher-viewport"
        class="qs-reconciliation-line-switcher__viewport flex-1 min-w-0 overflow-x-auto overflow-y-hidden"
      >
        <p
          v-if="isEmpty"
          data-slot="qs-reconciliation-line-switcher-empty"
          class="text-sm text-muted-foreground m-0 flex-center h-13"
        >
          {{ t('qsReconciliationLineSwitcher.empty') }}
        </p>
        <div v-else class="flex gap-2 min-w-max items-center justify-center">
          <button
            v-for="itemIndex in windowIndexes"
            :key="items[itemIndex].value"
            type="button"
            data-slot="qs-reconciliation-line-switcher-item"
            class="px-3 pb-1 border rounded-lg inline-flex shrink-0 whitespace-nowrap transition-colors items-center justify-center relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            :class="isSelected(items[itemIndex])
              ? 'min-w-35 h-13 px-5 text-lg leading-6 font-semibold text-primary border-primary/45 bg-primary/8'
              : 'min-w-26 h-10 text-sm leading-5 font-medium text-muted-foreground border-border bg-background hover:text-foreground hover:bg-muted'"
            :aria-pressed="isSelected(items[itemIndex])"
            :aria-label="itemAriaLabel(items[itemIndex])"
            @click="select(items[itemIndex].value)"
          >
            <span>{{ items[itemIndex].label }}</span>
            <span
              aria-hidden="true"
              class="rounded-[2px] h-1 w-5 bottom-0 left-1/2 absolute -translate-x-1/2"
              :class="barClassOf(items[itemIndex])"
            />
          </button>
        </div>
      </div>

      <button
        type="button"
        data-slot="qs-reconciliation-line-switcher-arrow"
        class="text-muted-foreground border border-border rounded-lg bg-background flex-center shrink-0 size-10 transition-colors hover:text-foreground focus-visible:outline-none hover:bg-muted disabled:opacity-45 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        :aria-label="t('qsReconciliationLineSwitcher.next')"
        :disabled="!canStepNext"
        @click="step(1)"
      >
        <FaIcon name="i-lucide:chevron-right" class="size-4" />
      </button>
    </div>

    <div v-else data-slot="qs-reconciliation-line-switcher-grid" class="flex flex-wrap gap-2">
      <p
        v-if="isEmpty"
        data-slot="qs-reconciliation-line-switcher-empty"
        class="text-sm text-muted-foreground m-0 flex-center h-13 w-full"
      >
        {{ t('qsReconciliationLineSwitcher.empty') }}
      </p>
      <template v-else>
        <button
          v-for="item in items"
          :key="item.value"
          type="button"
          data-slot="qs-reconciliation-line-switcher-item"
          class="text-sm leading-5 px-3 pb-1 border rounded-lg inline-flex shrink-0 h-10 min-w-26 whitespace-nowrap transition-colors items-center justify-center relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          :class="isSelected(item)
            ? 'font-semibold text-primary border-primary/45 bg-primary/8'
            : 'font-medium text-muted-foreground border-border bg-background hover:text-foreground hover:bg-muted'"
          :aria-pressed="isSelected(item)"
          :aria-label="itemAriaLabel(item)"
          @click="select(item.value)"
        >
          <span>{{ item.label }}</span>
          <span
            aria-hidden="true"
            class="rounded-[2px] h-1 w-5 bottom-0 left-1/2 absolute -translate-x-1/2"
            :class="barClassOf(item)"
          />
        </button>
      </template>
    </div>

    <div class="flex justify-center">
      <button
        v-if="expanded"
        type="button"
        data-slot="qs-reconciliation-line-switcher-toggle"
        class="text-xs text-muted-foreground font-medium px-2.5 py-0.5 border border-transparent rounded-full inline-flex gap-1 transition-colors items-center hover:text-foreground focus-visible:outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-expanded="true"
        :aria-label="t('qsReconciliationLineSwitcher.collapse')"
        @click="expanded = false"
      >
        <FaIcon name="i-lucide:chevron-up" class="size-4" />{{ t('qsReconciliationLineSwitcher.collapse') }}
      </button>
      <button
        v-else
        type="button"
        data-slot="qs-reconciliation-line-switcher-toggle"
        class="text-xs text-muted-foreground font-medium px-2.5 py-0.5 border border-transparent rounded-full inline-flex gap-1 transition-colors items-center hover:text-foreground focus-visible:outline-none hover:bg-muted disabled:opacity-45 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        :aria-expanded="false"
        :aria-label="t('qsReconciliationLineSwitcher.expand')"
        :disabled="isEmpty"
        @click="expanded = true"
      >
        <FaIcon name="i-lucide:chevron-down" class="size-4" />{{ t('qsReconciliationLineSwitcher.expand') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 条带溢出时只靠滚动与选中项对齐，不显示滚动条，避免长条容器出现第二条滚动轨道。 */
.qs-reconciliation-line-switcher__viewport {
  scrollbar-width: none;
}

.qs-reconciliation-line-switcher__viewport::-webkit-scrollbar {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  [data-slot="qs-reconciliation-line-switcher-item"],
  [data-slot="qs-reconciliation-line-switcher-arrow"],
  [data-slot="qs-reconciliation-line-switcher-toggle"] {
    transition: none;
  }
}
</style>
