<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, shallowRef, useId, useTemplateRef, watch } from 'vue'
import sparkline from './sparkline'

type SparklineEntry = number | {
  value: number
  tooltip?: string
}

interface NormalizedSparklineEntry {
  tooltip?: string
  value: number
}

defineOptions({
  name: 'BuiltInSparkline',
})

const props = withDefaults(
  defineProps<{
    value: SparklineEntry[]
    width?: number
    height?: number
    strokeWidth?: number
    strokeColor?: string
    cursorColor?: string
    smooth?: boolean
    tooltip?: boolean
  }>(),
  {
    width: 100,
    height: 30,
    strokeWidth: 2,
    strokeColor: 'oklch(var(--primary))',
    smooth: false,
    tooltip: false,
  },
)

const DATA_TRANSITION_DURATION = 320
const gradientId = `fa-sparkline-${useId()}`
const sparklineRef = useTemplateRef<SVGSVGElement>('sparklineRef')
const displayedEntries = shallowRef<NormalizedSparklineEntry[]>([])
const tip = reactive({
  show: false,
  content: '',
  top: 0,
  left: 0,
})
let animationFrameId: number | undefined

const resolvedCursorColor = computed(() => props.cursorColor || props.strokeColor)
const fillGradient = computed(() => `url(#${gradientId})`)
const sparklineStyle = computed<CSSProperties>(() => ({
  '--sparkline-stroke': props.strokeColor,
  '--sparkline-cursor': resolvedCursorColor.value,
}))
const tooltipStyle = computed<CSSProperties>(() => ({
  left: `${tip.left}px`,
  top: `${tip.top}px`,
}))

function normalizeEntries(entries: SparklineEntry[]) {
  return entries.map((entry) => {
    if (typeof entry === 'number') {
      return { value: entry }
    }

    return {
      tooltip: entry.tooltip,
      value: entry.value,
    }
  })
}

function stopAnimation() {
  if (animationFrameId !== undefined) {
    cancelAnimationFrame(animationFrameId)
    animationFrameId = undefined
  }
}

function getTooltipContent(datapoint: { tooltip?: string, value?: number }) {
  return datapoint.tooltip ?? `${datapoint.value ?? ''}`
}

function drawSparkline(entries = displayedEntries.value) {
  if (!sparklineRef.value) {
    return
  }

  tip.show = false

  sparkline(sparklineRef.value, entries, {
    smooth: props.smooth,
    ...(props.tooltip
      ? {
          onmousemove: (event: MouseEvent, datapoint: { tooltip?: string, value?: number }) => {
            tip.show = true
            tip.content = getTooltipContent(datapoint)
            tip.top = event.offsetY
            tip.left = event.offsetX + 14
          },
          onmouseout: () => {
            tip.show = false
          },
        }
      : {}),
  })
}

async function renderSparklineAfterNextTick(entries = displayedEntries.value) {
  await nextTick()
  drawSparkline(entries)
}

function easeOutCubic(progress: number) {
  return 1 - (1 - progress) ** 3
}

function animateToEntries(targetEntries: NormalizedSparklineEntry[]) {
  const sourceEntries = displayedEntries.value

  stopAnimation()

  if (sourceEntries.length !== targetEntries.length || sourceEntries.length <= 1) {
    displayedEntries.value = targetEntries
    void renderSparklineAfterNextTick(targetEntries)
    return
  }

  const startEntries = sourceEntries.map(entry => ({ ...entry }))
  const startTime = performance.now()

  const step = (timestamp: number) => {
    const progress = Math.min(1, (timestamp - startTime) / DATA_TRANSITION_DURATION)
    const easedProgress = easeOutCubic(progress)

    displayedEntries.value = targetEntries.map((entry, index) => ({
      ...entry,
      value: Number.parseFloat((startEntries[index].value + (entry.value - startEntries[index].value) * easedProgress).toFixed(2)),
    }))

    drawSparkline(displayedEntries.value)

    if (progress < 1) {
      animationFrameId = requestAnimationFrame(step)
      return
    }

    animationFrameId = undefined
    displayedEntries.value = targetEntries
    drawSparkline(targetEntries)
  }

  animationFrameId = requestAnimationFrame(step)
}

onMounted(() => {
  displayedEntries.value = normalizeEntries(props.value)
  void renderSparklineAfterNextTick()
})

watch(
  () => props.value,
  (value) => {
    animateToEntries(normalizeEntries(value))
  },
  {
    deep: true,
  },
)

watch(
  () => [props.width, props.height, props.strokeWidth, props.smooth, props.tooltip],
  () => {
    stopAnimation()
    displayedEntries.value = normalizeEntries(props.value)
    void renderSparklineAfterNextTick()
  },
)

onBeforeUnmount(() => {
  stopAnimation()
})
</script>

<template>
  <div class="sparkline" :style="sparklineStyle">
    <svg ref="sparklineRef" :width="width" :height="height" :stroke-width="strokeWidth" :stroke="strokeColor" :fill="fillGradient">
      <defs>
        <linearGradient :id="gradientId" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop :stop-color="strokeColor" stop-opacity="0.28" />
          <stop offset="65%" :stop-color="strokeColor" stop-opacity="0.1" />
          <stop offset="100%" :stop-color="strokeColor" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
    <span v-if="tooltip && tip.show" class="sparkline-tooltip" :style="tooltipStyle" role="tooltip">
      {{ tip.content }}
    </span>
  </div>
</template>

<style scoped>
.sparkline {
  position: relative;
  display: inline-flex;

  :deep(.sparkline--cursor) {
    stroke: var(--sparkline-cursor);
  }

  :deep(.sparkline--spot) {
    fill: var(--sparkline-stroke);
    stroke: var(--sparkline-stroke);
  }
}

.sparkline-tooltip {
  position: absolute;
  z-index: 10000;
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  line-height: 1;
  color: oklch(var(--background));
  white-space: nowrap;
  pointer-events: none;
  background: oklch(var(--foreground));
  border-radius: 0.375rem;
  box-shadow: 0 10px 30px rgb(15 23 42 / 18%), 0 2px 8px rgb(15 23 42 / 14%);
  transform: translate3d(0, calc(-50% - 0.125rem), 0);
  animation: sparkline-tooltip-in 160ms cubic-bezier(0.16, 1, 0.3, 1);
}

.sparkline-tooltip::after {
  position: absolute;
  top: 50%;
  left: -0.25rem;
  width: 0.625rem;
  height: 0.625rem;
  content: "";
  background: inherit;
  border-radius: 2px;
  transform: translateY(-50%) rotate(45deg);
}

@keyframes sparkline-tooltip-in {
  from {
    opacity: 0;
    transform: translate3d(0, calc(-50% + 0.25rem), 0) scale(0.96);
  }

  to {
    opacity: 1;
    transform: translate3d(0, calc(-50% - 0.125rem), 0) scale(1);
  }
}
</style>
