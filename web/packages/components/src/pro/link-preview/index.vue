<script setup lang="ts">
import type { CSSProperties, HTMLAttributes } from 'vue'
import { computed, reactive, ref, useTemplateRef } from 'vue'
import { cn } from '#utils'

defineOptions({
  name: 'BuiltInLinkPreview',
})

// Combined type that enforces the requirements
const props = withDefaults(defineProps<StaticImageProps | URLPreviewProps>(), {
  width: 200,
  height: 125,
})

interface BaseProps {
  class?: HTMLAttributes['class']
  linkClass?: HTMLAttributes['class']
  width?: number
  height?: number
}

// Props for static image mode
interface StaticImageProps extends BaseProps {
  isStatic: true
  imageSrc: string
  url?: string // optional in static mode
}

// Props for URL preview mode
interface URLPreviewProps extends BaseProps {
  isStatic?: false // optional but must be false if specified
  imageSrc?: string // optional in URL mode
  url: string
}

const isVisible = ref(false)
const isLoading = ref(true)
const hasPopped = ref(false)
const triggerRef = useTemplateRef<HTMLAnchorElement>('triggerRef')

// Generate preview URL
const previewSrc = computed(() => {
  if (props.isStatic) {
    return props.imageSrc
  }
  const params = new URLSearchParams({
    'url': props.url,
    'screenshot': 'true',
    'meta': 'false',
    'embed': 'screenshot.url',
    'colorScheme': 'light',
    'viewport.isMobile': 'true',
    'viewport.deviceScaleFactor': '1',
    'viewport.width': String(props.width * 3),
    'viewport.height': String(props.height * 3),
  })
  return `https://api.microlink.io/?${params.toString()}`
})

// Position tracking
const mousePosition = reactive({
  x: 0,
  y: 0,
})

// Calculate preview position
const previewStyle = computed<CSSProperties>(() => {
  if (!triggerRef.value) {
    return {}
  }

  const offset = 20
  const previewWidth = props.width
  const previewHeight = props.height
  const viewportWidth = window.innerWidth

  let x = mousePosition.x - previewWidth / 2
  x = Math.min(Math.max(0, x), viewportWidth - previewWidth)

  const linkRect = triggerRef.value.getBoundingClientRect()
  const y = linkRect ? linkRect.top - previewHeight - offset : 0

  return {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    width: `${previewWidth}px`,
    height: `${previewHeight}px`,
  }
})

// Image specific styling
const imageStyle = computed<CSSProperties>(() => ({
  width: `${props.width}px`,
  height: `${props.height}px`,
}))

// Pop animation class
const popClass = computed(() => {
  if (!hasPopped.value) {
    return ''
  }
  return 'animate-pop'
})

function handleMouseMove(event: MouseEvent) {
  mousePosition.x = event.clientX
  mousePosition.y = event.clientY
}

function showPreview() {
  isVisible.value = true
  setTimeout(() => {
    hasPopped.value = true
  }, 50)
}

function hidePreview() {
  isVisible.value = false
  hasPopped.value = false
}

function handleImageLoad() {
  isLoading.value = false
}
</script>

<template>
  <div :class="cn('relative inline-block', props.class)">
    <!-- Trigger -->
    <a
      ref="triggerRef"
      :href="url"
      target="_blank"
      :class="cn('text-primary', props.linkClass)"
      @mousemove="handleMouseMove"
      @mouseenter="showPreview"
      @mouseleave="hidePreview"
    >
      <slot />
    </a>
    <!-- Preview -->
    <Teleport to="body">
      <div
        v-if="isVisible"
        class="pointer-events-none z-2050"
        :style="previewStyle"
      >
        <div
          class="rounded-xl shadow-xl overflow-hidden"
          :class="[popClass, { 'transform-gpu': !props.isStatic }]"
        >
          <div class="p-1 border-2 border-transparent rounded-xl bg-white block shadow-lg dark:bg-gray-900">
            <img
              :src="previewSrc"
              :width="width"
              :height="height"
              class="rounded-lg size-full object-cover"
              :style="imageStyle"
              alt="preview"
              @load="handleImageLoad"
            >
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.transform-gpu {
  transform: scale3d(0, 0, 1);
  transform-origin: center bottom;
  backface-visibility: hidden;
  will-change: transform;
}

.animate-pop {
  animation: pop 1000ms ease forwards;
  will-change: transform;
}

@keyframes pop {
  0% {
    transform: scale3d(0.26, 0.26, 1);
  }

  25% {
    transform: scale3d(1.1, 1.1, 1);
  }

  65% {
    transform: scale3d(0.98, 0.98, 1);
  }

  100% {
    transform: scale3d(1, 1, 1);
  }
}
</style>
