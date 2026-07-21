<script setup lang="ts">
defineOptions({ name: 'QsGenericTableCopyCellButton' })

const props = withDefaults(defineProps<{
  alwaysVisible?: boolean
  label: string
  text: string
}>(), {
  alwaysVisible: false,
})

type CopyState = 'error' | 'idle' | 'success'

const copyState = ref<CopyState>('idle')
let resetTimer: ReturnType<typeof setTimeout> | undefined

const tooltipText = computed(() => ({
  error: '复制失败',
  idle: `复制${props.label}`,
  success: '已复制',
})[copyState.value])

const buttonLabel = computed(() => copyState.value === 'idle'
  ? `复制${props.label}`
  : `${props.label}${copyState.value === 'success' ? '复制成功' : '复制失败'}`)

const iconName = computed(() => ({
  error: 'i-lucide:triangle-alert',
  idle: 'i-lucide:copy',
  success: 'i-lucide:check',
})[copyState.value])

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
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is unavailable')
    }
    await navigator.clipboard.writeText(props.text)
    copyState.value = 'success'
  }
  catch {
    // 不把待复制内容或浏览器权限细节写入日志，失败态只向当前用户反馈。
    copyState.value = 'error'
  }
  scheduleReset()
}

onBeforeUnmount(() => clearTimeout(resetTimer))
</script>

<template>
  <span class="inline-flex shrink-0 relative">
    <FaTooltip :text="tooltipText" :delay="300">
      <FaButton
        type="button"
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground size-7 transition-opacity"
        :class="[
          alwaysVisible
            ? 'opacity-100'
            : 'opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100',
          copyState === 'success' && 'text-primary',
          copyState === 'error' && 'text-destructive',
        ]"
        :disabled="!text"
        :aria-label="buttonLabel"
        @pointerdown.stop
        @click.stop="copyText"
      >
        <FaIcon :name="iconName" transition class="size-3.5" />
      </FaButton>
    </FaTooltip>
    <span class="sr-only" aria-live="polite">{{ liveMessage }}</span>
  </span>
</template>
