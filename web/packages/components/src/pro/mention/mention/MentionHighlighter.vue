<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { useMentionContext } from './context'

const context = useMentionContext('MentionHighlighter')

const highlighterRef = shallowRef<HTMLDivElement | null>(null)
const inputStyle = shallowRef<CSSStyleDeclaration | null>(null)

const baseStyle: CSSProperties = {
  position: 'absolute',
  top: '0',
  left: '0',
  right: '0',
  bottom: '0',
  color: 'transparent',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  pointerEvents: 'none',
  userSelect: 'none',
  overflow: 'hidden',
  width: '100%',
}

const segments = computed(() => {
  const source = context.inputValue.value
  const items: Array<{ key: string, text: string, tag: boolean }> = []
  let lastIndex = 0

  for (const mention of context.mentions.value) {
    if (mention.start > lastIndex) {
      items.push({
        key: `text-${lastIndex}`,
        text: source.slice(lastIndex, mention.start),
        tag: false,
      })
    }

    items.push({
      key: `mention-${mention.start}`,
      text: source.slice(mention.start, mention.end),
      tag: true,
    })

    lastIndex = mention.end
  }

  if (lastIndex < source.length) {
    items.push({
      key: `text-end-${source.length}`,
      text: source.slice(lastIndex),
      tag: false,
    })
  }

  items.push({
    key: 'space',
    text: '\u00A0',
    tag: false,
  })

  return items
})

const highlighterStyle = computed<CSSProperties>(() => {
  if (!inputStyle.value) {
    return baseStyle
  }

  return {
    ...baseStyle,
    fontStyle: inputStyle.value.fontStyle,
    fontVariant: inputStyle.value.fontVariant,
    fontWeight: inputStyle.value.fontWeight,
    fontSize: inputStyle.value.fontSize,
    lineHeight: inputStyle.value.lineHeight,
    fontFamily: inputStyle.value.fontFamily,
    letterSpacing: inputStyle.value.letterSpacing,
    textTransform: inputStyle.value.textTransform,
    textIndent: inputStyle.value.textIndent,
    padding: inputStyle.value.padding,
    borderWidth: inputStyle.value.borderWidth,
    borderStyle: inputStyle.value.borderStyle,
    borderColor: 'transparent',
    borderRadius: inputStyle.value.borderRadius,
    boxSizing: inputStyle.value.boxSizing as CSSProperties['boxSizing'],
    overflowWrap: inputStyle.value.overflowWrap as CSSProperties['overflowWrap'],
    direction: context.dir.value,
  }
})

let resizeObserver: ResizeObserver | null = null
let mutationObserver: MutationObserver | null = null
let cleanupInput: (() => void) | null = null

function syncInputStyle() {
  const inputElement = context.inputRef.value

  if (!inputElement) {
    inputStyle.value = null
    return
  }

  inputStyle.value = window.getComputedStyle(inputElement)
}

function syncScrollAndSize() {
  const inputElement = context.inputRef.value
  const highlighterElement = highlighterRef.value

  if (!inputElement || !highlighterElement) {
    return
  }

  highlighterElement.scrollTop = inputElement.scrollTop
  highlighterElement.scrollLeft = inputElement.scrollLeft
  highlighterElement.style.height = `${inputElement.offsetHeight}px`
}

function bindToInput() {
  cleanupInput?.()
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()

  const inputElement = context.inputRef.value

  if (!inputElement) {
    return
  }

  const onScroll = () => syncScrollAndSize()
  const onResize = () => {
    syncInputStyle()
    syncScrollAndSize()
  }

  inputElement.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onResize, { passive: true })

  resizeObserver = new ResizeObserver(onResize)
  resizeObserver.observe(inputElement)

  mutationObserver = new MutationObserver((mutations) => {
    if (mutations.some(mutation => mutation.type === 'attributes' && mutation.attributeName === 'class')) {
      onResize()
    }
  })

  mutationObserver.observe(inputElement, {
    attributes: true,
    attributeFilter: ['class'],
  })

  cleanupInput = () => {
    inputElement.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onResize)
  }

  onResize()
}

watch(
  () => context.inputRef.value,
  () => nextTick(bindToInput),
  { immediate: true },
)

watch(
  () => [context.inputValue.value, context.mentions.value.length],
  () => nextTick(syncScrollAndSize),
)

onMounted(() => {
  syncInputStyle()
  nextTick(syncScrollAndSize)
})

onBeforeUnmount(() => {
  cleanupInput?.()
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
})
</script>

<template>
  <div
    v-if="inputStyle"
    ref="highlighterRef"
    data-slot="mention-highlighter"
    aria-hidden="true"
    :dir="context.dir.value"
    :style="highlighterStyle"
  >
    <span
      v-for="segment in segments"
      :key="segment.key"
      :data-tag="segment.tag ? '' : undefined"
      :class="segment.tag ? 'rounded-sm bg-primary text-primary-foreground py-[1px] px-[1px]' : undefined"
    >
      {{ segment.text }}
    </span>
  </div>
</template>
