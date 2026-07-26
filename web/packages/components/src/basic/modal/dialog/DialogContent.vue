<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'
import type { ComponentPublicInstance, HTMLAttributes } from 'vue'
import { Maximize, Minimize, X } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import {
  DialogClose,
  DialogContent,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { useTemplateRef } from 'vue'
import { cn } from '#utils'
import DialogOverlay from './DialogOverlay.vue'

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<DialogContentProps & {
  modalId: string
  open?: boolean
  zIndex?: number
  maximize?: boolean
  maximizable?: boolean
  closable?: boolean
  overlay?: boolean
  overlayBlur?: boolean
  class?: HTMLAttributes['class']
}>()
const emits = defineEmits<DialogContentEmits & {
  toggleMaximize: [val: boolean]
  animationEnd: []
}>()

const delegatedProps = reactiveOmit(
  props,
  'class',
  'modalId',
  'open',
  'zIndex',
  'maximize',
  'maximizable',
  'closable',
  'overlay',
  'overlayBlur',
)

const forwarded = useForwardPropsEmits(delegatedProps, emits)

function handleMaximize() {
  emits('toggleMaximize', !props.maximize)
}

function handleAnimationEnd(event: AnimationEvent) {
  // 只把面板自身的进出场动画上报给 FaModal，忽略内容区子动画的冒泡事件。
  if (event.target === event.currentTarget) {
    emits('animationEnd')
  }
}

const dialogContentRef = useTemplateRef<ComponentPublicInstance<typeof DialogContent>>('dialogContentRef')

defineExpose({
  el: dialogContentRef,
})
</script>

<template>
  <DialogPortal>
    <DialogOverlay
      v-if="props.overlay"
      :data-modal-id="props.modalId"
      :class="cn('bg-black/50', {
        'backdrop-blur-sm': props.overlayBlur,
      })"
      :style="{
        zIndex: props.zIndex,
      }"
    />
    <DialogContent
      ref="dialogContentRef"
      v-bind="forwarded"
      aria-modal="true"
      :class="
        cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg outline-hidden',
          props.class,
        )"
      :style="{
        zIndex: props.zIndex,
      }"
      @animationend="handleAnimationEnd"
    >
      <slot />
      <div class="flex-center gap-2 inset-e-4 inset-t-4 absolute">
        <button v-if="props.maximizable" class="rounded-xs opacity-70 ring-offset-background transition-opacity right-4 top-4 data-[state=open]:text-muted-foreground focus:outline-hidden data-[state=open]:bg-accent hover:opacity-100 [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 [&_svg]:pointer-events-none disabled:pointer-events-none focus:ring-2 focus:ring-ring focus:ring-offset-2" @click="handleMaximize">
          <Maximize v-if="!props.maximize" />
          <Minimize v-else />
        </button>
        <DialogClose
          v-if="closable"
          class="rounded-xs opacity-70 ring-offset-background transition-opacity right-4 top-4 data-[state=open]:text-muted-foreground focus:outline-hidden data-[state=open]:bg-accent hover:opacity-100 [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 [&_svg]:pointer-events-none disabled:pointer-events-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <X />
          <span class="sr-only">Close</span>
        </DialogClose>
      </div>
    </DialogContent>
  </DialogPortal>
</template>
