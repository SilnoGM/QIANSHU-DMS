<script setup lang="ts">
import { useTemplateRef } from 'vue'

defineOptions({
  name: 'BuiltInGlowyCardWrapper',
})

const props = withDefaults(
  defineProps<{
    hue?: number
    saturation?: number
    lightness?: number
    size?: number
    border?: number
    radius?: number
  }>(),
  {
    hue: 210,
    saturation: 100,
    lightness: 50,
    size: 200,
    border: 2,
    radius: 10,
  },
)

const glowCardWrapper = useTemplateRef<HTMLElement>('glowCardWrapper')
const HIDDEN_POINTER_POSITION = -9999

function setPointerVars(element: HTMLElement, localX: number, localY: number, width: number, height: number) {
  const xPercent = width > 0 ? localX / width : 0
  const yPercent = height > 0 ? localY / height : 0

  element.style.setProperty('--glowy-card-x', localX.toFixed(2))
  element.style.setProperty('--glowy-card-xp', xPercent.toFixed(4))
  element.style.setProperty('--glowy-card-y', localY.toFixed(2))
  element.style.setProperty('--glowy-card-yp', yPercent.toFixed(4))
}

function syncPointer(event: PointerEvent) {
  const element = glowCardWrapper.value
  if (!element) {
    return
  }

  for (const card of element.querySelectorAll<HTMLElement>('[data-glowy-card]')) {
    const rect = card.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top

    setPointerVars(card, localX, localY, rect.width, rect.height)
  }
}

function leaveWrapper() {
  const element = glowCardWrapper.value
  if (!element) {
    return
  }

  for (const card of element.querySelectorAll<HTMLElement>('[data-glowy-card]')) {
    setPointerVars(card, HIDDEN_POINTER_POSITION, HIDDEN_POINTER_POSITION, 1, 1)
  }
}
</script>

<template>
  <main
    ref="glowCardWrapper"
    :style="{
      '--glowy-card-backdrop': 'hsl(0deg 0% 60% / 12%)',
      '--glowy-card-backup-border': 'var(--glowy-card-backdrop)',
      '--glowy-card-hue': props.hue.toString(),
      '--glowy-card-saturation': props.saturation.toString(),
      '--glowy-card-lightness': props.lightness.toString(),
      '--glowy-card-size': props.size.toString(),
      '--glowy-card-border': props.border.toString(),
      '--glowy-card-radius': props.radius.toString(),
    }"
    @pointermove="syncPointer"
    @pointerleave="leaveWrapper"
  >
    <slot />
  </main>
</template>
