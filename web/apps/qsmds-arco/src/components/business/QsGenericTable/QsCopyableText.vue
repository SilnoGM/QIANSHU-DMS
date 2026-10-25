<script setup lang="ts">
import { useQsToast } from '@/components/base/QsToast/useQsToast'

defineOptions({ name: 'QsGenericTableCopyableText' })

const props = defineProps<{
  label: string
  text: string | null | undefined
}>()

type CopyState = 'error' | 'idle' | 'success'

const toast = useQsToast()
const copyState = ref<CopyState>('idle')
let resetTimer: ReturnType<typeof setTimeout> | undefined

const canCopy = computed(() => Boolean(props.text?.trim()))
const tooltipText = computed(() => ({
  error: '复制失败',
  idle: '点击可复制',
  success: '已复制',
})[copyState.value])
const buttonLabel = computed(() => copyState.value === 'idle'
  ? `复制${props.label}`
  : `${props.label}${copyState.value === 'success' ? '复制成功' : '复制失败'}`)
const liveMessage = computed(() => copyState.value === 'idle'
  ? ''
  : `${props.label}${copyState.value === 'success' ? '复制成功' : '复制失败'}`)

function scheduleReset() {
  clearTimeout(resetTimer)
  resetTimer = setTimeout(() => {
    copyState.value = 'idle'
  }, 1_500)
}

async function copyText() {
  if (!canCopy.value || props.text === null || props.text === undefined) {
    return
  }
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is unavailable')
    }
    await navigator.clipboard.writeText(props.text)
    copyState.value = 'success'
    toast.success(`${props.label}已复制`)
  }
  catch {
    // 不把待复制内容或浏览器权限细节写入日志，失败态只向当前用户反馈。
    copyState.value = 'error'
    toast.error(`${props.label}复制失败`)
  }
  scheduleReset()
}

onBeforeUnmount(() => clearTimeout(resetTimer))
</script>

<template>
  <template v-if="canCopy">
    <FaTooltip :text="tooltipText" :delay="300">
      <button
        type="button"
        class="p-0 text-left border-0 bg-transparent max-w-full cursor-pointer truncate [color:inherit] [font:inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        :aria-label="buttonLabel"
        @pointerdown.stop
        @click.stop="copyText"
      >
        {{ text }}
      </button>
    </FaTooltip>
    <span class="sr-only" aria-live="polite">{{ liveMessage }}</span>
  </template>
  <span v-else>—</span>
</template>
