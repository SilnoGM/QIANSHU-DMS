<script setup lang="ts">
import type { HTMLAttributes, VNode } from 'vue'
import { computed, useId } from 'vue'
import { cn } from '#utils'
import Icon from '../../basic/icon/index.vue'

defineOptions({
  name: 'BuiltInLayoutContainer',
})

const props = withDefaults(
  defineProps<{
    vertical?: boolean
    hideLeftSide?: boolean
    hideRightSide?: boolean
    hideTopSide?: boolean
    hideBottomSide?: boolean
    hideLeftSideToggle?: boolean
    hideRightSideToggle?: boolean
    hideTopSideToggle?: boolean
    hideBottomSideToggle?: boolean
    leftSideWidth?: number | string
    rightSideWidth?: number | string
    topSideHeight?: number | string
    bottomSideHeight?: number | string
    class?: HTMLAttributes['class']
    leftSideClass?: HTMLAttributes['class']
    rightSideClass?: HTMLAttributes['class']
    topSideClass?: HTMLAttributes['class']
    bottomSideClass?: HTMLAttributes['class']
    defaultClass?: HTMLAttributes['class']
  }>(),
  {
    vertical: false,
    hideLeftSide: false,
    hideRightSide: false,
    hideTopSide: false,
    hideBottomSide: false,
    hideLeftSideToggle: false,
    hideRightSideToggle: false,
    hideTopSideToggle: false,
    hideBottomSideToggle: false,
    leftSideWidth: 300,
    rightSideWidth: 300,
    topSideHeight: 200,
    bottomSideHeight: 200,
  },
)

const slots = defineSlots<{
  leftSide?: () => VNode
  rightSide?: () => VNode
  topSide?: () => VNode
  bottomSide?: () => VNode
  default?: () => VNode
}>()

// 边栏是否显示
const enabledLeftSide = computed(() => !props.hideLeftSide && !!slots.leftSide)
const enabledRightSide = computed(() => !props.hideRightSide && !!slots.rightSide)
const enabledTopSide = computed(() => !props.hideTopSide && !!slots.topSide)
const enabledBottomSide = computed(() => !props.hideBottomSide && !!slots.bottomSide)

// 边栏是否折叠
const leftSideVisiable = defineModel<boolean>('leftSideVisiable', { default: true })
const rightSideVisiable = defineModel<boolean>('rightSideVisiable', { default: true })
const topSideVisiable = defineModel<boolean>('topSideVisiable', { default: true })
const bottomSideVisiable = defineModel<boolean>('bottomSideVisiable', { default: true })

const topSideTeleportId = useId()
const bottomSideTeleportId = useId()
</script>

<template>
  <div
    :class="cn('relative w-full h-200 flex', {
      'flex-col': vertical,
    }, props.class)"
  >
    <div :id="topSideTeleportId" class="contents empty:hidden" />
    <div :class="vertical ? 'flex flex-1' : 'contents'">
      <div
        v-if="enabledLeftSide"
        v-show="leftSideVisiable"
        :class="cn('h-full flex-none overflow-auto border border-e-0 bg-background p-4 transition-background-color-300', {
          'rounded-s-lg': !vertical,
          'rounded-ss-lg': vertical && (!enabledTopSide || !topSideVisiable),
          'rounded-es-lg': vertical && (!enabledBottomSide || !bottomSideVisiable),
        }, props.leftSideClass)"
        :style="{
          width: typeof leftSideWidth === 'number' ? `${leftSideWidth}px` : leftSideWidth,
        }"
      >
        <slot name="leftSide" />
      </div>
      <div class="flex flex-1 flex-col">
        <Teleport :to="`#${topSideTeleportId}`" defer :disabled="!vertical">
          <div
            v-if="enabledTopSide"
            v-show="topSideVisiable"
            :class="cn('w-full border border-b-0 bg-background p-4 transition-background-color-300', {
              'rounded-t-lg': vertical,
              'rounded-ss-lg': !vertical && (!enabledLeftSide || !leftSideVisiable),
              'rounded-se-lg': !vertical && (!enabledRightSide || !rightSideVisiable),
            }, props.topSideClass)" :style="{
              height: typeof topSideHeight === 'number' ? `${topSideHeight}px` : topSideHeight,
            }"
          >
            <slot name="topSide" />
          </div>
        </Teleport>
        <div class="flex flex-1 h-full w-full relative">
          <div v-if="enabledLeftSide && !hideLeftSideToggle" class="group border-l border-t rounded-1/2 bg-background flex-center size-6 cursor-pointer top-1/2 absolute z-1 -translate-y-1/2 -rotate-45 -left-3" @click="leftSideVisiable = !leftSideVisiable">
            <Icon :name="leftSideVisiable ? 'i-ep:caret-left' : 'i-ep:caret-right'" class="op-30 rotate-45 transition-opacity group-hover-op-100" />
          </div>
          <div v-if="enabledRightSide && !hideRightSideToggle" class="group border-b border-r rounded-1/2 bg-background flex-center size-6 cursor-pointer top-1/2 absolute z-1 -translate-y-1/2 -rotate-45 -right-3" @click="rightSideVisiable = !rightSideVisiable">
            <Icon :name="rightSideVisiable ? 'i-ep:caret-right' : 'i-ep:caret-left'" class="op-30 rotate-45 transition-opacity group-hover-op-100" />
          </div>
          <div v-if="enabledTopSide && !hideTopSideToggle" class="group border-l border-t rounded-1/2 bg-background flex-center size-6 cursor-pointer rotate-45 left-1/2 absolute z-1 -translate-x-1/2 -top-3" @click="topSideVisiable = !topSideVisiable">
            <Icon :name="topSideVisiable ? 'i-ep:caret-top' : 'i-ep:caret-bottom'" class="op-30 transition-opacity group-hover-op-100 -rotate-45" />
          </div>
          <div v-if="enabledBottomSide && !hideBottomSideToggle" class="group border-b border-r rounded-1/2 bg-background flex-center size-6 cursor-pointer rotate-45 left-1/2 absolute z-1 -translate-x-1/2 -bottom-3" @click="bottomSideVisiable = !bottomSideVisiable">
            <Icon :name="bottomSideVisiable ? 'i-ep:caret-bottom' : 'i-ep:caret-top'" class="op-30 transition-opacity group-hover-op-100 -rotate-45" />
          </div>
          <div
            :class="cn('absolute inset-0 h-full w-full overflow-auto border bg-background p-4 transition-background-color-300', {
              'rounded-ss-lg': ((!enabledTopSide || !topSideVisiable) && (!enabledLeftSide || !leftSideVisiable)),
              'rounded-se-lg': ((!enabledTopSide || !topSideVisiable) && (!enabledRightSide || !rightSideVisiable)),
              'rounded-es-lg': ((!enabledBottomSide || !bottomSideVisiable) && (!enabledLeftSide || !leftSideVisiable)),
              'rounded-ee-lg': ((!enabledBottomSide || !bottomSideVisiable) && (!enabledRightSide || !rightSideVisiable)),
            }, props.defaultClass)"
          >
            <slot name="default" />
          </div>
        </div>
        <Teleport :to="`#${bottomSideTeleportId}`" defer :disabled="!vertical">
          <div
            v-if="enabledBottomSide"
            v-show="bottomSideVisiable"
            :class="cn('w-full border border-t-0 bg-background p-4 transition-background-color-300', {
              'rounded-b-lg': vertical,
              'rounded-es-lg': !vertical && (!enabledLeftSide || !leftSideVisiable),
              'rounded-ee-lg': !vertical && (!enabledRightSide || !rightSideVisiable),
            }, props.bottomSideClass)"
            :style="{
              height: typeof bottomSideHeight === 'number' ? `${bottomSideHeight}px` : bottomSideHeight,
            }"
          >
            <slot name="bottomSide" />
          </div>
        </Teleport>
      </div>
      <div
        v-if="enabledRightSide"
        v-show="rightSideVisiable"
        :class="cn('h-full flex-none overflow-auto border border-s-0 bg-background p-4 transition-background-color-300', {
          'rounded-e-lg': !vertical,
          'rounded-se-lg': vertical && (!enabledTopSide || !topSideVisiable),
          'rounded-ee-lg': vertical && (!enabledBottomSide || !bottomSideVisiable),
        }, props.rightSideClass)"
        :style="{
          width: typeof rightSideWidth === 'number' ? `${rightSideWidth}px` : rightSideWidth,
        }"
      >
        <slot name="rightSide" />
      </div>
    </div>
    <div :id="bottomSideTeleportId" class="contents empty:hidden" />
  </div>
</template>
