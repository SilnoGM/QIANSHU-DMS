<script setup lang="ts">
import type { PrimitiveProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { Primitive } from 'reka-ui'
import { computed, onBeforeUnmount, shallowRef, useId, watchEffect } from 'vue'
import { cn } from '#utils'
import { useMentionContext } from './context'

interface Props extends PrimitiveProps {
  value: string
  label?: string
  disabled?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  as: 'div',
  disabled: false,
})

const context = useMentionContext('MentionItem')

const itemRef = shallowRef<HTMLElement | null>(null)
const id = useId()

const resolvedLabel = computed(() => props.label ?? props.value)
const isDisabled = computed(() => props.disabled || context.disabled.value)
const isVisible = computed(() => context.isItemVisible(props.value))
const isHighlighted = computed(() => context.highlightedId.value === id)
const isSelected = computed(() => context.value.value.includes(props.value))

watchEffect(() => {
  if (!props.value) {
    throw new Error('`MentionItem` value cannot be an empty string')
  }

  context.upsertItem({
    id,
    ref: itemRef,
    value: props.value,
    label: resolvedLabel.value,
    disabled: isDisabled.value,
  })
})

onBeforeUnmount(() => {
  context.removeItem(id)
})

function handleClick() {
  if (isDisabled.value) {
    return
  }

  const inputElement = context.inputRef.value

  if (!inputElement) {
    return
  }

  const selectionStart = inputElement.selectionStart ?? 0
  const triggerIndex = inputElement.value.lastIndexOf(context.trigger.value, selectionStart)

  if (triggerIndex !== -1) {
    context.addMention(props.value, triggerIndex)
  }
}

function handlePointerDown(event: PointerEvent) {
  if (isDisabled.value) {
    return
  }

  const target = event.target as HTMLElement | null

  if (!target) {
    return
  }

  if (target.hasPointerCapture?.(event.pointerId)) {
    target.releasePointerCapture(event.pointerId)
  }

  if (event.button === 0 && !event.ctrlKey) {
    event.preventDefault()
  }
}

function handlePointerMove() {
  if (isDisabled.value) {
    return
  }

  context.setHighlightedId(id)
}
</script>

<template>
  <Primitive
    :id="id"
    ref="itemRef"
    data-slot="mention-item"
    :as="as"
    :as-child="asChild"
    role="option"
    :aria-selected="isSelected"
    :data-selected="isSelected ? '' : undefined"
    :data-highlighted="isHighlighted ? '' : undefined"
    :data-disabled="isDisabled ? '' : undefined"
    :class="cn(props.class)"
    :style="{ display: isVisible ? undefined : 'none' }"
    @click="handleClick"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
  >
    <slot>{{ resolvedLabel }}</slot>
  </Primitive>
</template>
