<script setup lang="ts">
import { onBeforeUnmount } from 'vue'

defineOptions({ name: 'QsHoverPopover' })

const props = withDefaults(defineProps<{
  hover?: boolean
  enterDelay?: number
  leaveDelay?: number
  class?: string
}>(), {
  hover: true,
  enterDelay: 150,
  leaveDelay: 120,
  class: undefined,
})

const open = defineModel<boolean>('open', { default: false })

let enterTimer: number | undefined
let leaveTimer: number | undefined

function clearEnter() {
  if (enterTimer !== undefined) {
    window.clearTimeout(enterTimer)
    enterTimer = undefined
  }
}

function clearLeave() {
  if (leaveTimer !== undefined) {
    window.clearTimeout(leaveTimer)
    leaveTimer = undefined
  }
}

function scheduleOpen() {
  if (!props.hover) {
    return
  }
  clearLeave()
  if (open.value) {
    return
  }
  clearEnter()
  enterTimer = window.setTimeout(() => {
    enterTimer = undefined
    open.value = true
  }, props.enterDelay)
}

function scheduleClose() {
  if (!props.hover) {
    return
  }
  clearEnter()
  clearLeave()
  leaveTimer = window.setTimeout(() => {
    leaveTimer = undefined
    open.value = false
  }, props.leaveDelay)
}

function cancelClose() {
  clearLeave()
}

/** 面板本身也参与悬停保持，否则从触发器移入面板时会先关闭再打开。 */
function handleFocusIn() {
  clearLeave()
  if (props.hover) {
    open.value = true
  }
}

onBeforeUnmount(() => {
  clearEnter()
  clearLeave()
})
</script>

<template>
  <FaPopover v-model:open="open" align="end" side="bottom" :class="props.class">
    <span
      class="inline-flex"
      @mouseenter="scheduleOpen"
      @mouseleave="scheduleClose"
      @focusin="handleFocusIn"
      @focusout="scheduleClose"
    >
      <slot />
    </span>
    <template #panel>
      <div
        @mouseenter="cancelClose"
        @mouseleave="scheduleClose"
        @focusin="cancelClose"
        @focusout="scheduleClose"
      >
        <slot name="panel" />
      </div>
    </template>
  </FaPopover>
</template>
