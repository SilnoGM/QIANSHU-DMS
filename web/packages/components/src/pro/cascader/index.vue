<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Check, ChevronDown, ChevronLeft, ChevronRight } from '@lucide/vue'
import { computed, nextTick, ref } from 'vue'
import { cn } from '#utils'
import Button from '../../basic/button/index.vue'
import Icon from '../../basic/icon/index.vue'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../basic/popover/popover'

export interface CascaderOption {
  label: string
  value: string | number
  disabled?: boolean
  children?: CascaderOption[]
}

defineOptions({
  name: 'BuiltInCascader',
})

const props = withDefaults(
  defineProps<{
    options: CascaderOption[]
    placeholder?: string
    disabled?: boolean
    clearable?: boolean
    leafOnly?: boolean
    separator?: string
    panelMode?: 'single' | 'multi'
    size?: 'sm' | 'default'
    triggerMode?: 'click' | 'hover'
    columnMaxWidth?: string
    class?: HTMLAttributes['class']
  }>(),
  {
    leafOnly: true,
    separator: ' / ',
    panelMode: 'multi',
    size: 'default',
    triggerMode: 'click',
    columnMaxWidth: '180px',
  },
)

const emit = defineEmits<{
  change: [value: string | number | undefined]
}>()

const value = defineModel<string | number | undefined>()

// ---- 共享状态 ----
const open = ref(false)
const activePath = ref<CascaderOption[]>([])
const isHovered = ref(false)

// ---- single 模式专用状态 ----
const activeDepth = ref(0)
const transitionName = ref('slide-start')

// ---- 共享工具函数 ----
function findPath(
  opts: CascaderOption[],
  val: string | number | undefined,
  path: CascaderOption[] = [],
): CascaderOption[] | null {
  if (val === undefined || val === null) {
    return null
  }
  for (const opt of opts) {
    const currentPath = [...path, opt]
    if (opt.value === val) {
      return currentPath
    }
    if (opt.children?.length) {
      const found = findPath(opt.children, val, currentPath)
      if (found) {
        return found
      }
    }
  }
  return null
}

const displayText = computed(() => {
  const path = findPath(props.options, value.value)
  if (!path) {
    return ''
  }
  return path.map(o => o.label).join(props.separator)
})

const showClear = computed(
  () => props.clearable && value.value !== undefined && !props.disabled && isHovered.value,
)

function isSelected(option: CascaderOption): boolean {
  return option.value === value.value
}

function isInActivePath(option: CascaderOption, colIdx?: number): boolean {
  const idx = colIdx ?? activeDepth.value
  return activePath.value[idx]?.value === option.value
}

function handleClear(e: MouseEvent) {
  e.stopPropagation()
  value.value = undefined
  emit('change', undefined)
  open.value = false
}

function handleOpen(isOpen: boolean) {
  open.value = isOpen
  if (isOpen) {
    const path = findPath(props.options, value.value)
    if (props.panelMode === 'single') {
      if (path && path.length > 1) {
        activePath.value = path.slice(0, -1)
        activeDepth.value = path.length - 1
      }
      else {
        activeDepth.value = 0
        activePath.value = []
      }
    }
    else {
      // multi 模式
      if (path && path.length > 0) {
        const lastNode = path.at(-1)
        activePath.value = lastNode?.children?.length ? path : path.slice(0, -1)
      }
      else {
        activePath.value = []
      }
    }
    scrollActiveIntoView()
  }
  else {
    setTimeout(() => {
      activePath.value = []
      if (props.panelMode === 'single') {
        activeDepth.value = 0
      }
    }, 150)
  }
}

const singlePanelRef = ref<HTMLElement>()
const multiPanelRef = ref<HTMLElement>()

function scrollActiveIntoView() {
  nextTick(() => {
    requestAnimationFrame(() => {
      if (props.panelMode === 'single') {
        const col = singlePanelRef.value?.querySelector<HTMLElement>('[data-scroll-col]')
        const active = col?.querySelector<HTMLElement>('button[data-active]')
        active?.scrollIntoView({ block: 'center' })
      }
      else {
        const cols = multiPanelRef.value?.querySelectorAll<HTMLElement>('[data-scroll-col]')
        cols?.forEach((col) => {
          const active = col.querySelector<HTMLElement>('button[data-active]')
          active?.scrollIntoView({ block: 'center' })
        })
      }
    })
  })
}

// ---- single 模式专用逻辑 ----
const currentColumnOptions = computed(() => {
  if (activeDepth.value === 0) {
    return props.options
  }
  const parent = activePath.value[activeDepth.value - 1]
  return parent?.children ?? []
})

function handleParentClick(option: CascaderOption) {
  if (option.disabled) {
    return
  }
  transitionName.value = 'slide-start'
  activePath.value = [...activePath.value.slice(0, activeDepth.value), option]
  activeDepth.value++
  if (!props.leafOnly) {
    value.value = option.value
    emit('change', option.value)
  }
}

function handleSelect(option: CascaderOption) {
  if (option.disabled) {
    return
  }
  value.value = option.value
  emit('change', option.value)
  open.value = false
}

function handleBack() {
  if (activeDepth.value > 0) {
    transitionName.value = 'slide-end'
    activeDepth.value--
    activePath.value = activePath.value.slice(0, activeDepth.value)
  }
}

// ---- multi 模式专用逻辑 ----
const columns = computed(() => {
  const cols: CascaderOption[][] = [props.options]
  for (const node of activePath.value) {
    if (node.children?.length) {
      cols.push(node.children)
    }
  }
  return cols
})

function handleEnterParent(option: CascaderOption, colIdx: number) {
  if (option.disabled) {
    return
  }
  activePath.value = [...activePath.value.slice(0, colIdx), option]
}

function handleSelectParent(option: CascaderOption, colIdx: number) {
  if (option.disabled) {
    return
  }
  value.value = option.value
  emit('change', option.value)
  activePath.value = [...activePath.value.slice(0, colIdx), option]
}

function handleOptionClick(option: CascaderOption, colIdx: number) {
  if (option.disabled) {
    return
  }
  if (option.children?.length) {
    if (props.triggerMode === 'click') {
      handleEnterParent(option, colIdx)
    }
    if (!props.leafOnly) {
      handleSelectParent(option, colIdx)
    }
  }
  else {
    handleSelect(option)
  }
}

function handleOptionMouseEnter(option: CascaderOption, colIdx: number) {
  if (props.triggerMode !== 'hover' || option.disabled) {
    return
  }
  handleEnterParent(option, colIdx)
}
</script>

<template>
  <Popover :open @update:open="handleOpen">
    <!-- 触发器 -->
    <PopoverTrigger as-child>
      <button
        type="button"
        :data-size="size"
        :disabled
        :class="cn(
          'border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*=text-])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50',
          'flex w-[200px] items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'data-[size=default]:h-9 data-[size=sm]:h-8',
          'select-none',
          props.class,
        )"
        @mouseenter="isHovered = true"
        @mouseleave="isHovered = false"
      >
        <span :class="cn('flex-1 truncate text-start', !displayText && 'text-muted-foreground')">
          {{ displayText || placeholder }}
        </span>
        <Button
          v-if="showClear"
          variant="ghost"
          size="icon"
          type="button"
          class="shrink-0 size-6 -mx-1"
          @click="handleClear"
        >
          <Icon name="i-lucide:x" />
        </Button>
        <ChevronDown
          v-else
          :class="cn('size-4 opacity-50 shrink-0 transition-transform duration-200', open && 'rotate-180')"
        />
      </button>
    </PopoverTrigger>

    <!-- 面板 -->
    <PopoverContent
      align="start"
      :side-offset="4"
      :class="cn('p-0 z-[2000] overflow-hidden', panelMode === 'multi' ? 'w-auto' : 'w-[200px]')"
      @open-auto-focus.prevent
    >
      <!-- single 模式面板：单列 + Transition 滑动 -->
      <template v-if="panelMode === 'single'">
        <div ref="singlePanelRef" class="relative overflow-hidden">
          <Transition :name="transitionName">
            <div :key="activeDepth" data-scroll-col class="p-1 max-h-64 overflow-y-auto">
              <!-- 返回按钮（非根层显示） -->
              <template v-if="activeDepth > 0">
                <button
                  type="button"
                  class="text-sm text-muted-foreground px-2 rounded-sm flex gap-1 h-8 w-full items-center hover:text-accent-foreground hover:bg-accent"
                  @click="handleBack"
                >
                  <ChevronLeft class="shrink-0 size-4 rtl:rotate-180" />
                  <span class="truncate">{{ activePath[activeDepth - 1]?.label }}</span>
                </button>
                <div class="my-1 bg-border h-px" />
              </template>

              <!-- 当前列的选项 -->
              <template v-for="option in currentColumnOptions" :key="option.value">
                <button
                  type="button"
                  :data-active="(isSelected(option) || isInActivePath(option)) ? '' : undefined"
                  :disabled="option.disabled"
                  :class="cn(
                    'relative flex h-8 w-full items-center rounded-sm px-2 text-sm',
                    'hover:bg-accent hover:text-accent-foreground',
                    'disabled:pointer-events-none disabled:opacity-50',
                    isSelected(option) && 'text-primary font-medium',
                    isInActivePath(option) && !isSelected(option) && 'bg-accent/50',
                    (option.children?.length || isSelected(option)) && 'pe-6',
                  )"
                  @click="option.children?.length
                    ? handleParentClick(option)
                    : handleSelect(option)"
                >
                  <span class="truncate">{{ option.label }}</span>
                  <ChevronRight
                    v-if="option.children?.length"
                    class="opacity-50 shrink-0 size-4 end-1.5 absolute rtl:rotate-180"
                  />
                  <Check
                    v-else-if="isSelected(option)"
                    class="shrink-0 size-4 end-1.5 absolute"
                  />
                </button>
              </template>
            </div>
          </Transition>
        </div>
      </template>

      <!-- multi 模式面板：多列并排 -->
      <template v-else>
        <div ref="multiPanelRef" class="flex">
          <div
            v-for="(col, colIdx) in columns"
            :key="colIdx"
            data-scroll-col
            class="p-1 border-e shrink-0 max-h-64 overflow-y-auto last:border-e-0"
            :style="{ maxWidth: columnMaxWidth, minWidth: '80px' }"
          >
            <button
              v-for="opt in col"
              :key="opt.value"
              type="button"
              :data-active="(isSelected(opt) || isInActivePath(opt, colIdx)) ? '' : undefined"
              :disabled="opt.disabled"
              :class="cn(
                'relative flex h-8 w-full cursor-default items-center gap-2 rounded-sm px-2 text-sm outline-none select-none',
                'hover:bg-accent hover:text-accent-foreground',
                'disabled:pointer-events-none disabled:opacity-50',
                isSelected(opt) && 'font-medium text-primary',
                isInActivePath(opt, colIdx) && !isSelected(opt) && 'bg-accent',
                opt.children?.length && 'pe-6',
                isSelected(opt) && !opt.children?.length && 'pe-6',
              )"
              @mouseenter="handleOptionMouseEnter(opt, colIdx)"
              @click="handleOptionClick(opt, colIdx)"
            >
              <span class="text-start flex-1 truncate">{{ opt.label }}</span>
              <ChevronRight v-if="opt.children?.length" class="opacity-50 shrink-0 size-4 end-1.5 absolute rtl:rotate-180" />
              <Check v-else-if="isSelected(opt)" class="shrink-0 size-4 end-1.5 absolute" />
            </button>
          </div>
        </div>
      </template>
    </PopoverContent>
  </Popover>
</template>

<style scoped>
/* 离开的列绝对定位（不影响容器高度），进入的列保持文档流（撑开容器） */
.slide-start-leave-active,
.slide-end-leave-active {
  position: absolute;
  inset: 0;
  transition: transform 200ms ease-in-out;
}

.slide-start-enter-active,
.slide-end-enter-active {
  transition: transform 200ms ease-in-out;
}

/* 向 start 方向滑：进入下一级，新列从 end 侧滑入，旧列向 start 侧滑出 */
.slide-start-enter-from {
  transform: translateX(100%);

  [dir="rtl"] & {
    transform: translateX(-100%);
  }
}

.slide-start-leave-to {
  transform: translateX(-100%);

  [dir="rtl"] & {
    transform: translateX(100%);
  }
}

/* 向 end 方向滑：返回上一级，新列从 start 侧滑入，旧列向 end 侧滑出 */
.slide-end-enter-from {
  transform: translateX(-100%);

  [dir="rtl"] & {
    transform: translateX(100%);
  }
}

.slide-end-leave-to {
  transform: translateX(100%);

  [dir="rtl"] & {
    transform: translateX(-100%);
  }
}
</style>
