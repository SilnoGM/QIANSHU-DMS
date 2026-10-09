<script setup lang="ts">
import type { QsReconciliationLineSwitcherItem } from '@/components/business/QsReconciliationLineSwitcher/types'
import QsReconciliationLineSwitcher from '@/components/business/QsReconciliationLineSwitcher/index.vue'
import {
  RECONCILIATION_LINE_SWITCHER_CODE_ITEMS,
  RECONCILIATION_LINE_SWITCHER_CODE_TONES,
  RECONCILIATION_LINE_SWITCHER_DEFAULT_ITEMS,
  RECONCILIATION_LINE_SWITCHER_EMPTY_ITEMS,
  RECONCILIATION_LINE_SWITCHER_EXACT_ITEMS,
  RECONCILIATION_LINE_SWITCHER_SHORT_ITEMS,
  RECONCILIATION_LINE_SWITCHER_SINGLE_ITEMS,
  RECONCILIATION_LINE_SWITCHER_STATUS_TONES,
} from '../fixtures/reconciliation-line-switcher.fixture'

defineOptions({ name: 'ReconciliationLineSwitcherShowcase' })

/** 示例里的选中值全部由本页持有，组件只发 update:modelValue，不自行选择默认项。 */
function initialValue(items: readonly QsReconciliationLineSwitcherItem[], index: number): string | null {
  const item = items.at(index)
  return item ? item.value : null
}

function summarize(items: readonly QsReconciliationLineSwitcherItem[], value: string | null): string {
  const item = items.find(candidate => candidate.value === value)
  return item ? `${item.value} · ${item.label} · ${item.status}` : 'null'
}

const defaultSelected = ref(initialValue(RECONCILIATION_LINE_SWITCHER_DEFAULT_ITEMS, 3))
const exactSelected = ref(initialValue(RECONCILIATION_LINE_SWITCHER_EXACT_ITEMS, 3))
const shortSelected = ref(initialValue(RECONCILIATION_LINE_SWITCHER_SHORT_ITEMS, 1))
const singleSelected = ref(initialValue(RECONCILIATION_LINE_SWITCHER_SINGLE_ITEMS, 0))
const emptySelected = ref<string | null>(null)
const codeSelected = ref(initialValue(RECONCILIATION_LINE_SWITCHER_CODE_ITEMS, 2))
const narrowSelected = ref(initialValue(RECONCILIATION_LINE_SWITCHER_DEFAULT_ITEMS, 5))

const defaultSummary = computed(() => summarize(RECONCILIATION_LINE_SWITCHER_DEFAULT_ITEMS, defaultSelected.value))
const exactSummary = computed(() => summarize(RECONCILIATION_LINE_SWITCHER_EXACT_ITEMS, exactSelected.value))
const shortSummary = computed(() => summarize(RECONCILIATION_LINE_SWITCHER_SHORT_ITEMS, shortSelected.value))
const singleSummary = computed(() => summarize(RECONCILIATION_LINE_SWITCHER_SINGLE_ITEMS, singleSelected.value))
const emptySummary = computed(() => summarize(RECONCILIATION_LINE_SWITCHER_EMPTY_ITEMS, emptySelected.value))
const codeSummary = computed(() => summarize(RECONCILIATION_LINE_SWITCHER_CODE_ITEMS, codeSelected.value))
const narrowSummary = computed(() => summarize(RECONCILIATION_LINE_SWITCHER_DEFAULT_ITEMS, narrowSelected.value))

/** 边界演示：把选中值推到首项 / 末项，观察方向按钮的禁用而不是循环。 */
function moveToEdge(edge: 'first' | 'last'): void {
  const target = edge === 'first'
    ? RECONCILIATION_LINE_SWITCHER_DEFAULT_ITEMS.at(0)
    : RECONCILIATION_LINE_SWITCHER_DEFAULT_ITEMS.at(-1)
  defaultSelected.value = target ? target.value : null
}
</script>

<template>
  <section
    aria-labelledby="reconciliation-line-switcher-showcase-title"
    data-testid="reconciliation-line-switcher-showcase"
  >
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:gallery-horizontal-end" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">明细行导航</span>
          </div>
          <h3
            id="reconciliation-line-switcher-showcase-title"
            class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl"
          >
            对账明细行切换场景
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            示例使用本地 fixture，覆盖默认条带、首尾禁用、恰好铺满、少于槽位数、单项、空数组、
            状态色映射、每侧项数与 390px 窄容器。选中值只在本页回显，组件不写任何业务数据。
          </p>
        </div>
        <FaTag variant="secondary">
          QsReconciliationLineSwitcher
        </FaTag>
      </div>

      <div class="mt-7 space-y-7">
        <div>
          <div class="mb-3 flex flex-wrap gap-3 items-center justify-between">
            <span class="qs-type-compact-label text-foreground">默认条带（12 条，每侧 3 项）</span>
            <span class="text-xs text-muted-foreground font-mono">{{ defaultSummary }}</span>
          </div>
          <QsReconciliationLineSwitcher
            v-model="defaultSelected"
            :items="RECONCILIATION_LINE_SWITCHER_DEFAULT_ITEMS"
            :status-tones="RECONCILIATION_LINE_SWITCHER_STATUS_TONES"
            aria-label="默认对账明细行切换"
          />
          <div class="mt-3 flex flex-wrap gap-2 items-center">
            <FaButton variant="outline" size="sm" @click="moveToEdge('first')">
              设为首项
            </FaButton>
            <FaButton variant="outline" size="sm" @click="moveToEdge('last')">
              设为末项
            </FaButton>
            <span class="text-xs text-muted-foreground">
              首项时「上一条」、末项时「下一条」置灰，条带贴边铺满且不循环。
            </span>
          </div>
        </div>

        <div class="gap-6 grid lg:grid-cols-2">
          <div>
            <div class="mb-3 flex gap-3 items-center justify-between">
              <span class="qs-type-compact-label text-foreground">恰好 7 条</span>
              <span class="text-xs text-muted-foreground font-mono">{{ exactSummary }}</span>
            </div>
            <QsReconciliationLineSwitcher
              v-model="exactSelected"
              :items="RECONCILIATION_LINE_SWITCHER_EXACT_ITEMS"
              :status-tones="RECONCILIATION_LINE_SWITCHER_STATUS_TONES"
              aria-label="恰好一屏的对账明细行切换"
            />
          </div>

          <div>
            <div class="mb-3 flex gap-3 items-center justify-between">
              <span class="qs-type-compact-label text-foreground">3 条（少于槽位数）</span>
              <span class="text-xs text-muted-foreground font-mono">{{ shortSummary }}</span>
            </div>
            <QsReconciliationLineSwitcher
              v-model="shortSelected"
              :items="RECONCILIATION_LINE_SWITCHER_SHORT_ITEMS"
              :status-tones="RECONCILIATION_LINE_SWITCHER_STATUS_TONES"
              aria-label="少于一屏的对账明细行切换"
            />
          </div>

          <div>
            <div class="mb-3 flex gap-3 items-center justify-between">
              <span class="qs-type-compact-label text-foreground">1 条（两个方向都禁用）</span>
              <span class="text-xs text-muted-foreground font-mono">{{ singleSummary }}</span>
            </div>
            <QsReconciliationLineSwitcher
              v-model="singleSelected"
              :items="RECONCILIATION_LINE_SWITCHER_SINGLE_ITEMS"
              :status-tones="RECONCILIATION_LINE_SWITCHER_STATUS_TONES"
              aria-label="单条明细行切换"
            />
          </div>

          <div>
            <div class="mb-3 flex gap-3 items-center justify-between">
              <span class="qs-type-compact-label text-foreground">0 条（空数组）</span>
              <span class="text-xs text-muted-foreground font-mono">{{ emptySummary }}</span>
            </div>
            <QsReconciliationLineSwitcher
              v-model="emptySelected"
              :items="RECONCILIATION_LINE_SWITCHER_EMPTY_ITEMS"
              :status-tones="RECONCILIATION_LINE_SWITCHER_STATUS_TONES"
              aria-label="空明细行切换"
            />
          </div>
        </div>

        <div class="gap-6 grid lg:grid-cols-2">
          <div>
            <div class="mb-3 flex gap-3 items-center justify-between">
              <span class="qs-type-compact-label text-foreground">每侧 1 项（3 槽）</span>
              <span class="text-xs text-muted-foreground font-mono">{{ defaultSummary }}</span>
            </div>
            <QsReconciliationLineSwitcher
              v-model="defaultSelected"
              :items="RECONCILIATION_LINE_SWITCHER_DEFAULT_ITEMS"
              :status-tones="RECONCILIATION_LINE_SWITCHER_STATUS_TONES"
              :visible-side-count="1"
              aria-label="每侧一项的对账明细行切换"
            />
          </div>

          <div>
            <div class="mb-3 flex gap-3 items-center justify-between">
              <span class="qs-type-compact-label text-foreground">状态码取值 + 未登记状态回落中性</span>
              <span class="text-xs text-muted-foreground font-mono">{{ codeSummary }}</span>
            </div>
            <QsReconciliationLineSwitcher
              v-model="codeSelected"
              :items="RECONCILIATION_LINE_SWITCHER_CODE_ITEMS"
              :status-tones="RECONCILIATION_LINE_SWITCHER_CODE_TONES"
              aria-label="状态码取值的对账明细行切换"
            />
            <p class="text-xs text-muted-foreground leading-5 m-0 mt-2">
              <code>ARCHIVED</code> 未登记在 <code>statusTones</code> 中，横条回落中性灰；
              组件本身不认识 <code>PENDING</code> / <code>RECONCILED</code>。
            </p>
          </div>
        </div>

        <div>
          <div class="mb-3 flex gap-3 items-center justify-between">
            <span class="qs-type-compact-label text-foreground">390px 窄容器（条带横向滚动并把选中项对齐正中）</span>
            <span class="text-xs text-muted-foreground font-mono">{{ narrowSummary }}</span>
          </div>
          <div class="max-w-[390px]">
            <QsReconciliationLineSwitcher
              v-model="narrowSelected"
              :items="RECONCILIATION_LINE_SWITCHER_DEFAULT_ITEMS"
              :status-tones="RECONCILIATION_LINE_SWITCHER_STATUS_TONES"
              aria-label="窄容器对账明细行切换"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
