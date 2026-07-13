<script setup lang="ts">
import type { HTMLAttributes, StyleValue } from 'vue'
import type { MentionAlign, MentionSide } from './types'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { cn } from '#utils'
import { useMentionContext } from './context'
import { resolveCollisionPadding } from './mention-utils'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<{
  side?: MentionSide
  sideOffset?: number
  align?: MentionAlign
  alignOffset?: number
  collisionPadding?: number | { top?: number, right?: number, bottom?: number, left?: number }
  avoidCollisions?: boolean
  fitViewport?: boolean
  hideWhenDetached?: boolean
  forceMount?: boolean
  trackAnchor?: boolean
  strategy?: 'absolute' | 'fixed'
  class?: HTMLAttributes['class']
  style?: StyleValue
  onEscapeKeyDown?: (event: KeyboardEvent) => void
  onPointerDownOutside?: (event: PointerEvent) => void
}>(), {
  side: 'bottom',
  sideOffset: 4,
  align: 'start',
  alignOffset: 0,
  avoidCollisions: true,
  fitViewport: false,
  hideWhenDetached: false,
  forceMount: false,
  trackAnchor: true,
  strategy: 'fixed',
})

const context = useMentionContext('MentionContent')

const contentRef = shallowRef<HTMLDivElement | null>(null)
const contentStyles = shallowRef<Record<string, string>>({})

const resolvedAlign = computed<MentionAlign>(() => {
  if (context.dir.value !== 'rtl') {
    return props.align
  }

  if (props.align === 'start') {
    return 'end'
  }

  if (props.align === 'end') {
    return 'start'
  }

  return props.align
})

function containsTarget(container: unknown, target: Node) {
  return container instanceof Node && container.contains(target)
}

function updatePosition() {
  const anchor = context.virtualAnchor.value
  const contentElement = contentRef.value

  if (!anchor || !contentElement) {
    return
  }

  const anchorRect = anchor.getBoundingClientRect()
  const contentRect = contentElement.getBoundingClientRect()
  const padding = resolveCollisionPadding(props.collisionPadding)
  let side = props.side

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  if (props.hideWhenDetached) {
    const isDetached = anchorRect.bottom < 0 || anchorRect.top > viewportHeight || anchorRect.right < 0 || anchorRect.left > viewportWidth

    if (isDetached) {
      contentStyles.value = {
        visibility: 'hidden',
      }
      return
    }
  }

  const baseLeftFor = (targetSide: MentionSide) => {
    if (targetSide === 'top' || targetSide === 'bottom') {
      if (resolvedAlign.value === 'center') {
        return anchorRect.left + (anchorRect.width / 2) - (contentRect.width / 2) + props.alignOffset
      }

      if (resolvedAlign.value === 'end') {
        return anchorRect.right - contentRect.width + props.alignOffset
      }

      return anchorRect.left + props.alignOffset
    }

    if (targetSide === 'left') {
      return anchorRect.left - contentRect.width - props.sideOffset
    }

    return anchorRect.right + props.sideOffset
  }

  const baseTopFor = (targetSide: MentionSide) => {
    if (targetSide === 'left' || targetSide === 'right') {
      if (resolvedAlign.value === 'center') {
        return anchorRect.top + (anchorRect.height / 2) - (contentRect.height / 2) + props.alignOffset
      }

      if (resolvedAlign.value === 'end') {
        return anchorRect.bottom - contentRect.height + props.alignOffset
      }

      return anchorRect.top + props.alignOffset
    }

    if (targetSide === 'top') {
      return anchorRect.top - contentRect.height - props.sideOffset
    }

    return anchorRect.bottom + props.sideOffset
  }

  let left = baseLeftFor(side)
  let top = baseTopFor(side)

  if (props.avoidCollisions) {
    if (side === 'bottom' && top + contentRect.height > viewportHeight - padding.bottom && anchorRect.top - contentRect.height - props.sideOffset >= padding.top) {
      side = 'top'
    }
    else if (side === 'top' && top < padding.top && anchorRect.bottom + props.sideOffset + contentRect.height <= viewportHeight - padding.bottom) {
      side = 'bottom'
    }
    else if (side === 'right' && left + contentRect.width > viewportWidth - padding.right && anchorRect.left - contentRect.width - props.sideOffset >= padding.left) {
      side = 'left'
    }
    else if (side === 'left' && left < padding.left && anchorRect.right + props.sideOffset + contentRect.width <= viewportWidth - padding.right) {
      side = 'right'
    }

    left = baseLeftFor(side)
    top = baseTopFor(side)

    left = Math.max(padding.left, Math.min(viewportWidth - contentRect.width - padding.right, left))
    top = Math.max(padding.top, Math.min(viewportHeight - contentRect.height - padding.bottom, top))
  }

  const x = props.strategy === 'absolute' ? left + window.scrollX : left
  const y = props.strategy === 'absolute' ? top + window.scrollY : top

  const styleMap: Record<string, string> = {
    position: props.strategy,
    left: `${x}px`,
    top: `${y}px`,
    minWidth: 'max-content',
  }

  if (props.fitViewport) {
    styleMap.maxWidth = `${viewportWidth - padding.left - padding.right}px`
    styleMap.maxHeight = `${viewportHeight - padding.top - padding.bottom}px`
  }

  if (!context.open.value && props.forceMount) {
    styleMap.visibility = 'hidden'
  }

  if (context.isPasting.value) {
    styleMap.opacity = '0'
    styleMap.pointerEvents = 'none'
  }

  contentStyles.value = styleMap
}

let animationFrame = 0
let cleanupPointerDown: (() => void) | null = null
let cleanupKeydown: (() => void) | null = null

function bindDismissHandlers() {
  cleanupPointerDown?.()
  cleanupKeydown?.()

  if (!context.open.value) {
    return
  }

  const onPointerDown = (event: PointerEvent) => {
    const contentElement = contentRef.value
    const inputElement = context.inputRef.value
    const rootElement = context.rootRef.value
    const target = event.target as Node | null

    if (!target) {
      return
    }

    if (
      containsTarget(contentElement, target)
      || containsTarget(inputElement, target)
      || containsTarget(rootElement, target)
    ) {
      return
    }

    props.onPointerDownOutside?.(event)

    if (event.defaultPrevented) {
      return
    }

    context.closeMenu()
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') {
      return
    }

    props.onEscapeKeyDown?.(event)

    if (event.defaultPrevented) {
      return
    }

    context.closeMenu()
  }

  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('keydown', onKeydown)

  cleanupPointerDown = () => document.removeEventListener('pointerdown', onPointerDown)
  cleanupKeydown = () => document.removeEventListener('keydown', onKeydown)
}

function startTracking() {
  cancelAnimationFrame(animationFrame)

  if (!context.open.value || !props.trackAnchor) {
    return
  }

  const frame = () => {
    updatePosition()
    animationFrame = requestAnimationFrame(frame)
  }

  animationFrame = requestAnimationFrame(frame)
}

watch(
  () => context.open.value,
  async (isOpen) => {
    bindDismissHandlers()

    if (isOpen) {
      await nextTick()
      updatePosition()
      startTracking()
      return
    }

    cancelAnimationFrame(animationFrame)
  },
  { immediate: true },
)

watch(
  () => [context.virtualAnchor.value, context.searchTerm.value, context.highlightedId.value],
  () => nextTick(updatePosition),
)

onMounted(() => {
  context.listRef.value = contentRef.value
  nextTick(updatePosition)
  startTracking()
})

onBeforeUnmount(() => {
  cleanupPointerDown?.()
  cleanupKeydown?.()
  cancelAnimationFrame(animationFrame)
  if (context.listRef.value === contentRef.value) {
    context.listRef.value = null
  }
})
</script>

<template>
  <div
    v-if="props.forceMount || context.open.value"
    :id="context.listId"
    ref="contentRef"
    data-slot="mention-content"
    role="listbox"
    aria-orientation="vertical"
    v-bind="$attrs"
    :data-state="context.open.value ? 'open' : 'closed'"
    :dir="context.dir.value"
    :style="[contentStyles, props.style]"
    :class="cn('outline-hidden', props.class)"
  >
    <slot />
  </div>
</template>
