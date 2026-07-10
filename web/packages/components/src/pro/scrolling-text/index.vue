<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots, watch } from 'vue'
import { cn } from '#utils'

defineOptions({
  name: 'BuiltInScrollingText',
})

const props = withDefaults(
  defineProps<{
    items: string[]
    visibleCount?: number
    duration?: number
    transition?: number
    animation?: 'slide' | 'fade'
    direction?: 'up' | 'down'
    class?: HTMLAttributes['class']
    itemClass?: HTMLAttributes['class']
  }>(),
  {
    visibleCount: 1,
    duration: 3000,
    transition: 500,
    animation: 'slide',
    direction: 'up',
  },
)

const emit = defineEmits<{
  itemClick: [item: string, index: number]
}>()

const startIndex = ref(0)
const isAnimating = ref(false)
const isPaused = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const containerRef = ref<HTMLElement | null>(null)
const firstItemRef = ref<HTMLElement | null>(null)
const measuredItemHeight = ref(0)
let resizeObserver: ResizeObserver | null = null

const slots = useSlots()
const hasItemSlot = computed(() => !!slots.item)

// 有 slot 时用测量高度，否则用容器高度均分
const itemHeight = computed(() => {
  if (hasItemSlot.value && measuredItemHeight.value) {
    return measuredItemHeight.value
  }
  return containerRef.value ? containerRef.value.clientHeight / props.visibleCount : 0
})

// 只有使用 #item slot 时才动态撑开容器高度
const containerStyle = computed(() =>
  hasItemSlot.value && measuredItemHeight.value
    ? { height: `${measuredItemHeight.value * props.visibleCount}px` }
    : {},
)

const renderItems = computed(() => {
  if (!props.items.length) {
    return []
  }
  if (props.direction === 'down') {
    // down 方向：visibleCount 条新条目在顶部，从上方滑入
    return Array.from({ length: props.visibleCount * 2 }, (_, i) => {
      const idx = (startIndex.value - props.visibleCount + i + props.items.length) % props.items.length
      return { text: props.items[idx], originalIndex: idx }
    })
  }
  // up 方向：当前 visibleCount 条 + 下一批 visibleCount 条
  return Array.from({ length: props.visibleCount * 2 }, (_, i) => ({
    text: props.items[(startIndex.value + i) % props.items.length],
    originalIndex: (startIndex.value + i) % props.items.length,
  }))
})

const restingTranslateY = computed(() =>
  props.animation === 'slide' && props.direction === 'down'
    ? -(itemHeight.value * props.visibleCount)
    : 0,
)

const translateY = ref<number | null>(null)

const slideStyle = computed(() => ({
  transform: `translateY(${translateY.value ?? restingTranslateY.value}px)`,
  transition: isAnimating.value ? `transform ${props.transition}ms ease` : 'none',
}))

const fadeStyle = computed(() => ({
  opacity: isAnimating.value ? 0 : 1,
  transition: `opacity ${props.transition}ms ease`,
}))

function step() {
  if (isPaused.value) {
    return
  }

  if (props.animation === 'slide') {
    if (props.direction === 'up') {
      isAnimating.value = true
      translateY.value = -(itemHeight.value * props.visibleCount)

      timer = setTimeout(() => {
        if (isPaused.value) {
          return
        }
        isAnimating.value = false
        startIndex.value = (startIndex.value + props.visibleCount) % props.items.length
        translateY.value = null
        scheduleNext()
      }, props.transition)
    }
    else {
      // down：静止态保持当前条目，动画时从静止位滑到顶部预渲染条目
      isAnimating.value = false
      translateY.value = null
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (isPaused.value) {
            return
          }
          isAnimating.value = true
          translateY.value = 0
          timer = setTimeout(() => {
            if (isPaused.value) {
              return
            }
            isAnimating.value = false
            startIndex.value = (startIndex.value - props.visibleCount + props.items.length) % props.items.length
            translateY.value = null
            scheduleNext()
          }, props.transition)
        })
      })
    }
  }
  else {
    isAnimating.value = true
    timer = setTimeout(() => {
      if (isPaused.value) {
        return
      }
      startIndex.value = props.direction === 'up'
        ? (startIndex.value + props.visibleCount) % props.items.length
        : (startIndex.value - props.visibleCount + props.items.length) % props.items.length
      nextTick(() => {
        isAnimating.value = false
        scheduleNext()
      })
    }, props.transition)
  }
}

function scheduleNext() {
  timer = setTimeout(step, props.duration)
}

// 修复 2：pause 时重置动画状态，避免卡在中间位置
function pause() {
  isPaused.value = true
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  isAnimating.value = false
  translateY.value = null
}

function resume() {
  isPaused.value = false
  if (timer) {
    clearTimeout(timer)
  }
  scheduleNext()
}

// 修复 4：watch items 变化重置 startIndex
watch(() => props.items, () => {
  startIndex.value = 0
  isAnimating.value = false
  translateY.value = null
  if (timer) {
    clearTimeout(timer)
  }
  if (props.items.length > props.visibleCount) {
    scheduleNext()
  }
})

onMounted(() => {
  if (props.items.length > props.visibleCount) {
    scheduleNext()
  }
  // 观察第一个条目高度变化
  resizeObserver = new ResizeObserver((entries) => {
    const height = entries[0]?.contentRect.height
    if (height) {
      measuredItemHeight.value = height
    }
  })
  watch(firstItemRef, (el) => {
    resizeObserver?.disconnect()
    if (el) {
      resizeObserver?.observe(el)
    }
  }, { immediate: true })
})

onBeforeUnmount(() => {
  if (timer) {
    clearTimeout(timer)
  }
  resizeObserver?.disconnect()
})
</script>

<template>
  <!-- 默认高度 h-8（无 slot 时），有 slot 时由条目内容撑开 -->
  <div
    ref="containerRef"
    :class="cn('relative overflow-hidden h-8', props.class)"
    :style="containerStyle"
    @mouseenter="pause"
    @mouseleave="resume"
  >
    <!-- slide 模式 -->
    <div
      v-if="props.animation === 'slide'"
      class="h-full"
      :style="slideStyle"
    >
      <div
        v-for="(item, i) in renderItems"
        :key="`${i}-${item.originalIndex}`"
        :ref="(el) => { if (i === 0) firstItemRef = el as HTMLElement }"
        :class="cn('flex items-center', $attrs.onItemClick ? 'cursor-pointer' : '', props.itemClass as string)"
        :style="hasItemSlot && measuredItemHeight ? { height: `${measuredItemHeight}px` } : { height: `${100 / props.visibleCount}%` }"
        @click="emit('itemClick', item.text, item.originalIndex)"
      >
        <slot name="item" :item="item.text" :index="item.originalIndex">
          {{ item.text }}
        </slot>
      </div>
    </div>

    <!-- fade 模式 -->
    <div
      v-else
      class="h-full"
      :style="fadeStyle"
    >
      <div
        v-for="(item, i) in renderItems.slice(0, props.visibleCount)"
        :key="item.originalIndex"
        :ref="(el) => { if (i === 0) firstItemRef = el as HTMLElement }"
        :class="cn('flex items-center', $attrs.onItemClick ? 'cursor-pointer' : '', props.itemClass as string)"
        :style="hasItemSlot && measuredItemHeight ? { height: `${measuredItemHeight}px` } : { height: `${100 / props.visibleCount}%` }"
        @click="emit('itemClick', item.text, item.originalIndex)"
      >
        <slot name="item" :item="item.text" :index="item.originalIndex">
          {{ item.text }}
        </slot>
      </div>
    </div>
  </div>
</template>
