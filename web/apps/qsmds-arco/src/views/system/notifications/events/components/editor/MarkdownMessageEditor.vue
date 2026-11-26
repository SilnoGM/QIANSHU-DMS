<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { insertAtSelection } from '../../message-editor.logic'

const props = defineProps<{
  modelValue: Record<string, unknown>
  sendMethod: 'IN_APP' | 'APP' | 'ROBOT'
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

const maxBytes = computed(() => props.sendMethod === 'ROBOT' ? 4_096 : 2_048)
const byteCount = computed(() => new TextEncoder().encode(content.value).length)

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
      <span class="text-sm font-medium">Markdown 内容</span>
      <span
        class="text-xs tabular-nums"
        :class="byteCount > maxBytes ? 'text-destructive' : 'text-muted-foreground'"
      >
        {{ byteCount }} / {{ maxBytes }} 字节
      </span>
    </div>
    <FaTextarea
      ref="textareaRef"
      class="flex-1"
      :model-value="content"
      :disabled="disabled"
      input-class="min-h-64 font-mono text-sm"
      placeholder="支持 Markdown 语法与 {{变量}} 占位符"
      @update:model-value="value => { content = String(value ?? ''); rememberSelection() }"
      @select="rememberSelection"
      @click="rememberSelection"
      @keyup="rememberSelection"
    />
    <p v-if="error !== undefined" class="text-xs text-destructive m-0">
      {{ error }}
    </p>
    <p v-else class="text-xs text-muted-foreground m-0">
      企业微信应用消息最多 2048 字节；群机器人最多 4096 字节。变量按 Markdown 文本插入。
    </p>
  </div>
</template>
