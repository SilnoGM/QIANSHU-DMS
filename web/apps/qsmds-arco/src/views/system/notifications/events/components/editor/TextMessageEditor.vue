<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { insertAtSelection } from '../../message-editor.logic'

const props = defineProps<{
  modelValue: Record<string, unknown>
  channel: 'IN_APP' | 'WECOM'
  disabled?: boolean
  error?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
}>()

const textareaRef = ref<{ $el?: unknown } | null>(null)
const selection = ref({ start: 0, end: 0 })
const hasSelection = ref(false)

const content = computed({
  get() {
    return typeof props.modelValue.content === 'string' ? props.modelValue.content : ''
  },
  set(value: string) {
    emit('update:modelValue', { ...props.modelValue, content: value })
  },
})

function nativeTextarea(): HTMLTextAreaElement | null {
  const root = textareaRef.value?.$el
  if (root instanceof HTMLTextAreaElement) {
    return root
  }
  return root instanceof HTMLElement ? root.querySelector('textarea') : null
}

function rememberSelection(): void {
  const element = nativeTextarea()
  if (element === null) {
    return
  }
  selection.value = { start: element.selectionStart, end: element.selectionEnd }
  hasSelection.value = true
}

function insertVariable(name: string): void {
  if (props.disabled) {
    return
  }
  const token = `{{${name}}}`
  const start = hasSelection.value ? selection.value.start : content.value.length
  const end = hasSelection.value ? selection.value.end : content.value.length
  const inserted = insertAtSelection(content.value, token, start, end)
  content.value = inserted.value
  void nextTick(() => {
    const element = nativeTextarea()
    if (element === null) {
      return
    }
    element.focus()
    element.setSelectionRange(inserted.cursor, inserted.cursor)
    rememberSelection()
  })
}

defineExpose({ insertVariable })
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex flex-wrap gap-2 items-center justify-between">
      <span class="text-sm font-medium">正文</span>
      <span class="text-xs text-muted-foreground tabular-nums">
        {{ content.length }} 字符
      </span>
    </div>
    <FaTextarea
      ref="textareaRef"
      class="flex-1"
      :model-value="content"
      :disabled="disabled"
      :maxlength="channel === 'IN_APP' ? 2000 : 2048"
      input-class="min-h-64 lg:h-full"
      placeholder="输入文本内容，支持 {{变量}} 占位符"
      @update:model-value="value => { content = String(value ?? ''); rememberSelection() }"
      @select="rememberSelection"
      @click="rememberSelection"
      @keyup="rememberSelection"
    />
    <p v-if="error !== undefined" class="text-xs text-destructive m-0">
      {{ error }}
    </p>
    <p v-else class="text-xs text-muted-foreground m-0">
      站内通知最多 2000 字符；企业微信最多 2048 字节。右侧变量可插入到当前光标位置。
    </p>
  </div>
</template>
